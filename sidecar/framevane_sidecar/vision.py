"""Background removal and subject tracking.

Video: Robust Video Matting (recurrent, so mattes are stable frame to frame) on the GPU through DirectML, CPU if that
fails. The result is a grayscale matte video with the source's own timestamps, which the editor uses as alpha (the
original file is never changed). Photos: BiRefNet lite on the CPU (its graph hangs DirectML on some drivers).
Subject tracking reuses the video matte model at low resolution: the person mask gives where the subject is.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Callable

import numpy as np

_sessions: dict[tuple[str, bool], Any] = {}


def session(model_path: Path, gpu: bool = True):
    """A cached ONNX Runtime session: DirectML first (any Windows GPU), CPU as the fallback."""
    import onnxruntime as ort

    gpu = gpu and os.environ.get("FRAMEVANE_FORCE_CPU") != "1" and "DmlExecutionProvider" in ort.get_available_providers()
    key = (str(model_path), gpu)
    if key not in _sessions:
        providers = ["DmlExecutionProvider", "CPUExecutionProvider"] if gpu else ["CPUExecutionProvider"]
        _sessions[key] = ort.InferenceSession(str(model_path), providers=providers)
    return _sessions[key]


def _device(s: Any) -> str:
    return "gpu" if "DmlExecutionProvider" in s.get_providers() else "cpu"


def _rotation(frame: Any) -> int:
    """Clockwise display rotation of a decoded frame (phone video), 0/90/180/270."""
    r = int(getattr(frame, "rotation", 0) or 0)
    return (-r) % 360  # PyAV reports the display-matrix angle counterclockwise


def _upright(rgb: np.ndarray, rot: int) -> np.ndarray:
    return np.ascontiguousarray(np.rot90(rgb, k=-(rot // 90))) if rot else rgb


class Rvm:
    """One recurrent pass over consecutive frames."""

    def __init__(self, model_path: Path, gpu: bool = True) -> None:
        self.model_path = model_path
        self.s = session(model_path, gpu)
        self.rec = [np.zeros([1, 1, 1, 1], np.float32)] * 4
        self.device = _device(self.s)

    def alpha(self, rgb: np.ndarray) -> np.ndarray:
        h, w = rgb.shape[:2]
        ratio = np.array([min(1.0, 512 / max(h, w))], np.float32)
        src = (rgb.astype(np.float32) / 255).transpose(2, 0, 1)[None]
        try:
            _fgr, pha, *self.rec = self.s.run(None, {"src": src, "r1i": self.rec[0], "r2i": self.rec[1], "r3i": self.rec[2], "r4i": self.rec[3], "downsample_ratio": ratio})
        except Exception:
            if self.device == "cpu":
                raise
            # the GPU path failed mid-run (driver reset, out of memory): carry on on the CPU
            self.s = session(self.model_path, gpu=False)
            self.device = "cpu"
            _fgr, pha, *self.rec = self.s.run(None, {"src": src, "r1i": self.rec[0], "r2i": self.rec[1], "r3i": self.rec[2], "r4i": self.rec[3], "downsample_ratio": ratio})
        return pha[0, 0]


def _fit(w: int, h: int, cap: int) -> tuple[int, int]:
    k = min(1.0, cap / max(w, h))
    return max(2, int(round(w * k / 2)) * 2), max(2, int(round(h * k / 2)) * 2)


def matte_video(model: Path, src: str, out: str, progress: Callable[[float], None], cancelled: Callable[[], bool]) -> dict[str, Any]:
    import av

    rvm = Rvm(model)
    inp = av.open(src)
    try:
        vs = inp.streams.video[0]
        vs.thread_type = "AUTO"
        duration = float(vs.duration * vs.time_base) if vs.duration else float(inp.duration or 0) / 1e6
        rate = float(vs.average_rate or 30)
        expected = max(1, int(duration * rate))
        tmp = out + ".part.mp4"
        o = av.open(tmp, "w")
        os_ = None
        n = 0
        size = (0, 0)
        for frame in inp.decode(vs):
            if cancelled():
                raise RuntimeError("Cancelled")
            rot = _rotation(frame)
            w, h = (frame.height, frame.width) if rot in (90, 270) else (frame.width, frame.height)
            if os_ is None:
                size = _fit(w, h, 1920)
                os_ = o.add_stream("libx264", rate=vs.average_rate or 30)
                os_.width, os_.height = size
                os_.pix_fmt = "yuv420p"
                os_.time_base = vs.time_base
                os_.codec_context.time_base = vs.time_base
                os_.codec_context.gop_size = 30
                os_.options = {"crf": "17", "preset": "veryfast"}
            cw, ch = _fit(frame.width, frame.height, 1920)
            rgb = _upright(frame.to_ndarray(format="rgb24", width=cw, height=ch), rot)
            a = rvm.alpha(rgb)
            gray = (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)
            if gray.shape[1] != size[0] or gray.shape[0] != size[1]:
                gray = np.asarray(av.VideoFrame.from_ndarray(gray, format="gray").reformat(width=size[0], height=size[1]).to_ndarray())
            of = av.VideoFrame.from_ndarray(gray, format="gray").reformat(format="yuv420p")
            of.pts = frame.pts
            of.time_base = vs.time_base
            for p in os_.encode(of):
                o.mux(p)
            n += 1
            if n % 10 == 0:
                progress(min(0.99, n / expected))
        if os_ is None:
            raise RuntimeError("No video frames found")
        for p in os_.encode():
            o.mux(p)
        o.close()
        os.replace(tmp, out)
        return {"path": out, "frames": n, "width": size[0], "height": size[1], "device": rvm.device}
    finally:
        inp.close()
        Path(out + ".part.mp4").unlink(missing_ok=True)


def matte_image(model: Path, src: str, out: str) -> dict[str, Any]:
    from PIL import Image, ImageOps

    im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
    w, h = im.size
    x = (np.asarray(im.resize((1024, 1024), Image.BILINEAR), np.float32) / 255 - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    s = session(model, gpu=False)
    logits = s.run(None, {s.get_inputs()[0].name: x.transpose(2, 0, 1)[None].astype(np.float32)})[0][0, 0]
    m = 1 / (1 + np.exp(-logits))
    ow, oh = _fit(w, h, 4096) if max(w, h) > 4096 else (w, h)
    matte = Image.fromarray((np.clip(m, 0, 1) * 255 + 0.5).astype(np.uint8), "L").resize((ow, oh), Image.BILINEAR)
    tmp = out + ".part.png"
    matte.save(tmp, "PNG")
    os.replace(tmp, out)
    return {"path": out, "width": ow, "height": oh, "device": "cpu", "coverage": round(float(m.mean()), 4)}


def _main_subject(a: np.ndarray) -> tuple[int, int]:
    """Columns of the main person when several are in shot: the one whose head is highest in frame (nearest the
    camera, usually the speaker). People standing side by side touch in the matte, so heads separate them better."""
    mask = a > 0.5
    h, w = mask.shape
    if not mask.any():
        return 0, w
    top = np.where(mask.any(axis=0), mask.argmax(axis=0), h)
    peak = int(np.argmin(top))
    near = top <= top[peak] + 0.12 * h
    x0 = peak
    while x0 > 0 and near[x0 - 1]:
        x0 -= 1
    x1 = peak + 1
    while x1 < w and near[x1]:
        x1 += 1
    return x0, x1


def track_subject(model: Path, src: str, start: float, end: float, fps: float, progress: Callable[[float], None], cancelled: Callable[[], bool]) -> dict[str, Any]:
    """Where the person is, `fps` times a second between start and end (source seconds): normalized centre x, a head-ish
    y (upper part of the body), and the share of the frame they cover. x/y are None where nobody is found."""
    import av

    rvm = Rvm(model)
    inp = av.open(src)
    samples: list[dict[str, Any]] = []
    try:
        vs = inp.streams.video[0]
        vs.thread_type = "AUTO"
        if start > 0.5:
            inp.seek(int(max(0.0, start - 1.0) / vs.time_base), stream=vs)
        step = 1.0 / max(0.5, fps)
        nxt = start
        span = max(0.01, end - start)
        for frame in inp.decode(vs):
            if cancelled():
                raise RuntimeError("Cancelled")
            t = float(frame.pts * vs.time_base) if frame.pts is not None else nxt
            if t + 1e-3 < nxt:
                continue
            if t > end + step:
                break
            rot = _rotation(frame)
            cw, ch = _fit(frame.width, frame.height, 384)
            rgb = _upright(frame.to_ndarray(format="rgb24", width=cw, height=ch), rot)
            a = rvm.alpha(rgb)
            area = float(a.mean())
            sample: dict[str, Any] = {"t": round(t, 3), "x": None, "y": None, "area": round(area, 4)}
            if area > 0.003:
                x0, x1 = _main_subject(a)
                cols = a[:, x0:x1].sum(axis=0)
                x = (x0 + float((cols * np.arange(cols.size)).sum() / max(cols.sum(), 1e-6))) / a.shape[1]
                rows = np.nonzero(a[:, x0:x1].max(axis=1) > 0.5)[0]
                y = float(rows[0] + 0.3 * (rows[-1] - rows[0])) / a.shape[0] if rows.size else 0.4
                sample["x"], sample["y"] = round(x, 4), round(y, 4)
            samples.append(sample)
            nxt = t + step
            progress(min(0.99, (t - start) / span))
        return {"samples": samples, "device": rvm.device}
    finally:
        inp.close()
