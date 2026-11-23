"""On-screen text in videos (for templates made from someone else's edit).

RapidOCR (PP-OCR detection + recognition, ONNX on the CPU; the models ship inside the wheel) reads the frames at the
times asked for. For each text line it reports the box (0..1 of the upright frame), the text, the confidence and a
guess at the look: the text colour and, when the text sits on a solid box (the TikTok "background" style), that box's
colour. Frames that look the same as the last one read reuse its result, so static titles cost one OCR pass.
"""

from __future__ import annotations

import threading
from typing import Any, Callable

import numpy as np

from .vision import _fit, _rotation, _upright

_engine: Any = None
_engine_lock = threading.Lock()


def engine() -> Any:
    global _engine
    with _engine_lock:
        if _engine is None:
            from rapidocr_onnxruntime import RapidOCR

            _engine = RapidOCR()
    return _engine


def _hex(c: np.ndarray) -> str:
    r, g, b = (int(max(0, min(255, round(float(v))))) for v in c[:3])
    return f"#{r:02x}{g:02x}{b:02x}"


def _two_means(px: np.ndarray, iters: int = 8) -> tuple[np.ndarray, np.ndarray]:
    """Split pixels (N×3) into two colour clusters; returns (centres 2×3, labels N)."""
    lum = px @ np.array([0.299, 0.587, 0.114])
    c = np.stack([px[lum <= np.percentile(lum, 20)].mean(0), px[lum >= np.percentile(lum, 80)].mean(0)])
    labels = np.zeros(len(px), np.int64)
    for _ in range(iters):
        d = ((px[:, None, :] - c[None, :, :]) ** 2).sum(-1)
        labels = d.argmin(1)
        for k in (0, 1):
            if (labels == k).any():
                c[k] = px[labels == k].mean(0)
    return c, labels


def _k_means(px: np.ndarray, k: int, iters: int = 10) -> tuple[np.ndarray, np.ndarray]:
    """k colour clusters, seeded across the luminance range; returns (centres k×3, labels N)."""
    lum = px @ np.array([0.299, 0.587, 0.114])
    order = np.argsort(lum)
    c = np.stack([px[order[min(len(px) - 1, int((i + 0.5) / k * len(px)))]] for i in range(k)]).astype(np.float64)
    labels = np.zeros(len(px), np.int64)
    for _ in range(iters):
        labels = ((px[:, None, :] - c[None, :, :]) ** 2).sum(-1).argmin(1)
        for j in range(k):
            if (labels == j).any():
                c[j] = px[labels == j].mean(0)
    return c, labels


def _letter_colour(box: np.ndarray, ring: np.ndarray) -> np.ndarray:
    """The letters' colour: of three colour clusters in the line's box, the one that is much commoner inside the box
    than in its top and bottom edge (where the backdrop shows between the letters), and most unlike the backdrop.
    Two clusters would average white letters with part of a busy picture; this keeps them apart."""
    c, labels = _k_means(box, 3)
    ring_lab = ((ring[:, None, :] - c[None, :, :]) ** 2).sum(-1).argmin(1)
    box_share = np.bincount(labels, minlength=3) / len(box)
    ring_share = np.bincount(ring_lab, minlength=3) / max(1, len(ring))
    backdrop = c[int(ring_share.argmax())]
    best, best_score = int(box_share.argmax()), -1.0
    for j in range(3):
        if box_share[j] < 0.05:
            continue
        score = (box_share[j] / (ring_share[j] + 0.05)) * float(np.linalg.norm(c[j] - backdrop))
        if score > best_score:
            best, best_score = j, score
    return c[best]


def text_look(rgb: np.ndarray, x0: int, y0: int, x1: int, y1: int) -> dict[str, Any]:
    """Guess the text colour and a solid backdrop colour (or None) for the line in box (pixel coords)."""
    h, w = rgb.shape[:2]
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(w, x1), min(h, y1)
    if x1 - x0 < 4 or y1 - y0 < 4:
        return {"color": "#ffffff", "background": None}
    box = rgb[y0:y1, x0:x1].reshape(-1, 3).astype(np.float64)
    if len(box) > 6000:
        box = box[np.linspace(0, len(box) - 1, 6000).astype(np.int64)]
    centres, labels = _two_means(box)
    # the cluster that owns the box's outer ring is the backdrop; the other one is the letters
    bh, bw = y1 - y0, x1 - x0
    ring = np.concatenate([rgb[y0:y0 + max(1, bh // 8), x0:x1].reshape(-1, 3), rgb[y1 - max(1, bh // 8):y1, x0:x1].reshape(-1, 3)]).astype(np.float64)
    ring_lab = ((ring[:, None, :] - centres[None, :, :]) ** 2).sum(-1).argmin(1)
    back = int(np.bincount(ring_lab, minlength=2).argmax())
    text_rgb = _letter_colour(box, ring)
    look: dict[str, Any] = {"color": _hex(text_rgb), "background": None}
    # a solid box: the ring is one flat colour that differs from the picture a line-height outside the text (boxes hug
    # the text by a fraction of the font size above and below, so that far out is the video behind it)
    pad = max(3, int(bh * 0.9))
    parts = []
    for yy in (y0 - pad, y1 + pad):
        if 0 <= yy < h:
            parts.append(rgb[yy:yy + 3, x0:x1].reshape(-1, 3))
    outside = np.concatenate(parts).astype(np.float64) if parts else np.zeros((0, 3))
    # (letters poke into the ring, so judge flatness on the backdrop cluster's own pixels)
    back_px = ring[ring_lab == back]
    flat = len(back_px) > 0.7 * len(ring) and back_px.std(0).mean() < 14
    if flat and len(outside) > 20 and np.linalg.norm(back_px.mean(0) - np.median(outside, 0)) > 45:
        look["background"] = _hex(back_px.mean(0))
    return look


def _tiny(rgb: np.ndarray) -> np.ndarray:
    h, w = rgb.shape[:2]
    ys = np.linspace(0, h - 1, 36).astype(np.int64)
    xs = np.linspace(0, w - 1, 64).astype(np.int64)
    return rgb[ys][:, xs].astype(np.float32)


def read_text(src: str, times: list[float], max_side: int, min_score: float, progress: Callable[[float], None], cancelled: Callable[[], bool]) -> dict[str, Any]:
    """OCR the frames nearest to `times` (source seconds, ascending). Boxes are [x0, y0, x1, y1], 0..1 of the upright
    frame."""
    import av

    eng = engine()
    wanted = sorted(t for t in times if t >= 0)
    samples: list[dict[str, Any]] = []
    size = (0, 0)
    inp = av.open(src)
    try:
        vs = inp.streams.video[0]
        vs.thread_type = "AUTO"
        i = 0
        last_tiny: np.ndarray | None = None
        last_items: list[dict[str, Any]] = []
        for frame in inp.decode(vs):
            if i >= len(wanted):
                break
            if cancelled():
                raise RuntimeError("Cancelled")
            t = float(frame.pts * vs.time_base) if frame.pts is not None else wanted[i]
            if t + 1e-3 < wanted[i]:
                continue
            rot = _rotation(frame)
            cw, ch = _fit(frame.width, frame.height, max_side)
            rgb = _upright(frame.to_ndarray(format="rgb24", width=cw, height=ch), rot)
            fh, fw = rgb.shape[:2]
            size = (fw, fh)
            tiny = _tiny(rgb)
            if last_tiny is not None and float(np.abs(tiny - last_tiny).mean()) < 1.5:
                items = last_items
            else:
                result, _ = eng(rgb)
                items = []
                for quad, text, score in result or []:
                    if float(score) < min_score or not str(text).strip():
                        continue
                    q = np.array(quad, np.float64)
                    x0, y0 = q.min(0)
                    x1, y1 = q.max(0)
                    items.append({
                        "text": str(text).strip(),
                        "score": round(float(score), 3),
                        "box": [round(x0 / fw, 4), round(y0 / fh, 4), round(x1 / fw, 4), round(y1 / fh, 4)],
                        **text_look(rgb, int(x0), int(y0), int(np.ceil(x1)), int(np.ceil(y1))),
                    })
                last_tiny, last_items = tiny, items
            # one frame can answer several requested times that fall before the next frame
            while i < len(wanted) and wanted[i] <= t + 1e-3:
                samples.append({"t": round(wanted[i], 3), "items": items})
                i += 1
            progress(min(0.99, i / max(1, len(wanted))))
        return {"width": size[0], "height": size[1], "samples": samples}
    finally:
        inp.close()
