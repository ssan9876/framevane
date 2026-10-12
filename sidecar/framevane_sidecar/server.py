"""framevane local AI sidecar: an MCP server over stdio.

The editor's agents call these tools exactly like any third-party MCP server. Tools take file paths, write any
outputs under the cache dir the editor passes, and report progress. stdout is the MCP channel: log to stderr only.
"""

from __future__ import annotations

import asyncio
import os
import site
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable

from mcp.server.mcpserver import Context, MCPServer

from .models import Catalog
from . import vision


def log(*a: Any) -> None:
    print("[sidecar]", *a, file=sys.stderr, flush=True)


def _add_cuda_dll_dirs() -> list[str]:
    """pip's nvidia-cublas/cudnn wheels ship DLLs that Windows won't find on its own."""
    added: list[str] = []
    if sys.platform != "win32":
        return added
    for base in site.getsitepackages() + [site.getusersitepackages()]:
        for sub in ("nvidia/cublas/bin", "nvidia/cudnn/bin", "nvidia/cuda_runtime/bin"):
            p = Path(base) / sub
            if p.is_dir():
                os.add_dll_directory(str(p))
                os.environ["PATH"] = str(p) + os.pathsep + os.environ.get("PATH", "")
                added.append(str(p))
    return added


CUDA_DIRS = _add_cuda_dll_dirs()
MODELS_DIR = os.environ.get("FRAMEVANE_MODELS_DIR") or str(Path.home() / ".cache" / "framevane-models")

mcp = MCPServer(
    "framevane-local-ai",
    instructions="Local AI tools for the framevane video editor. Paths are absolute. Long tools report progress.",
)

_models: dict[tuple[str, str, str], Any] = {}
_gpu_lock = threading.Lock()  # one GPU model runs at a time (8 GB card)
catalog = Catalog(MODELS_DIR)


async def _threaded(ctx: Context, work: Callable[[Callable[[float], None], Callable[[], bool]], Any], message: str) -> Any:
    """Run blocking work on a thread, reporting progress; a cancelled request stops the work at its next check."""
    state: dict[str, Any] = {"progress": 0.0, "done": False, "error": None, "result": None, "cancel": False}

    def run() -> None:
        try:
            state["result"] = work(lambda p: state.__setitem__("progress", p), lambda: state["cancel"])
        except Exception as e:
            state["error"] = e
        finally:
            state["done"] = True

    threading.Thread(target=run, daemon=True).start()
    started = time.monotonic()
    try:
        while not state["done"]:
            await asyncio.sleep(0.4)
            await ctx.report_progress(state["progress"], 1.0, f"{message} ({int(time.monotonic() - started)} s)")
    except BaseException:
        state["cancel"] = True
        raise
    if state["error"] is not None:
        raise state["error"]
    return state["result"]


def _need(model_id: str) -> Path:
    if not catalog.ready(model_id):
        raise RuntimeError(f"MODEL_MISSING:{model_id}: the {catalog.spec(model_id)['name']} model isn't downloaded yet")
    return catalog.file(model_id)


def _whisper(model: str):
    from faster_whisper import WhisperModel

    attempts = [("cuda", "float16"), ("cpu", "int8")] if os.environ.get("FRAMEVANE_FORCE_CPU") != "1" else [("cpu", "int8")]
    last: Exception | None = None
    for device, compute in attempts:
        key = (model, device, compute)
        if key in _models:
            return _models[key], device
        try:
            m = WhisperModel(model, device=device, compute_type=compute, download_root=MODELS_DIR)
            _models[key] = m
            log(f"loaded whisper {model} on {device}/{compute}")
            return m, device
        except Exception as e:  # CUDA missing/out of memory -> fall back to CPU
            last = e
            log(f"whisper {model} on {device} failed: {e}")
    raise RuntimeError(f"Could not load Whisper model {model}: {last}")


@mcp.tool()
def health() -> dict:
    """Report what this sidecar can run: Python version, CUDA availability and where models are cached."""
    info: dict[str, Any] = {"python": sys.version.split()[0], "models_dir": MODELS_DIR, "cuda_dll_dirs": CUDA_DIRS}
    try:
        import ctranslate2

        info["cuda_devices"] = ctranslate2.get_cuda_device_count()
        info["ctranslate2"] = ctranslate2.__version__
    except Exception as e:
        info["cuda_error"] = str(e)
    try:
        import onnxruntime

        info["onnx_providers"] = onnxruntime.get_available_providers()
    except Exception as e:
        info["onnx_error"] = str(e)
    return info


@mcp.tool()
async def transcribe(path: str, ctx: Context, language: str | None = None, model: str = "large-v3-turbo") -> dict:
    """Transcribe speech in an audio or video file with word-level timestamps (seconds, source time).

    Returns {language, duration, device, words: [{text, start, end, probability}], segments: [{text, start, end}]}.
    """
    if not Path(path).is_file():
        raise ValueError(f"File not found: {path}")
    state = {"progress": 0.0, "done": False, "error": None, "result": None}

    def work() -> None:
        try:
            with _gpu_lock:
                m, device = _whisper(model)
                segments, info = m.transcribe(
                    path,
                    language=language,
                    word_timestamps=True,
                    vad_filter=True,
                    vad_parameters={"min_silence_duration_ms": 300},
                    condition_on_previous_text=False,
                    # nudges Whisper toward punctuated, capitalized text (better caption lines)
                    initial_prompt="Hello, and welcome. Let's get started.",
                )
                words: list[dict] = []
                segs: list[dict] = []
                duration = max(info.duration, 0.001)
                for s in segments:
                    segs.append({"text": s.text.strip(), "start": round(s.start, 3), "end": round(s.end, 3)})
                    for w in s.words or []:
                        words.append({"text": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3), "probability": round(w.probability, 3)})
                    state["progress"] = min(0.99, s.end / duration)
                state["result"] = {"language": info.language, "duration": round(info.duration, 3), "device": device, "model": model, "words": words, "segments": segs}
        except Exception as e:
            state["error"] = e
        finally:
            state["done"] = True

    t = threading.Thread(target=work, daemon=True)
    t.start()
    started = time.monotonic()
    while not state["done"]:
        await asyncio.sleep(0.5)
        await ctx.report_progress(state["progress"], 1.0, f"Transcribing ({int(time.monotonic() - started)} s)")
    if state["error"] is not None:
        raise state["error"]  # type: ignore[misc]
    await ctx.report_progress(1.0, 1.0, "Done")
    return state["result"]  # type: ignore[return-value]


# ───────────────────────── text to speech (Kokoro v1.0, Apache-2.0) ─────────────────────────

KOKORO_DIR = Path(MODELS_DIR) / "kokoro"
_kokoro: Any = None
_kokoro_lock = threading.Lock()


def _kokoro_ready() -> bool:
    return catalog.ready("kokoro")


@mcp.tool()
def tts_status() -> dict:
    """Whether the natural (Kokoro) voices are downloaded."""
    return {"ready": _kokoro_ready(), "dir": str(KOKORO_DIR)}


@mcp.tool()
async def tts_install(ctx: Context) -> dict:
    """Download the Kokoro voice model (~120 MB) into the models folder. Safe to call again."""
    await _threaded(ctx, lambda progress, cancelled: catalog.install("kokoro", progress, cancelled), "Downloading natural voices")
    return {"ready": _kokoro_ready()}


@mcp.tool()
async def tts(text: str, voice: str, out: str, ctx: Context, speed: float = 1.0) -> dict:
    """Speak text with a Kokoro voice (e.g. af_heart, am_michael, bf_emma) into a 24 kHz mono WAV at `out`."""
    import wave

    import numpy as np

    if not _kokoro_ready():
        raise RuntimeError("The natural voices aren't downloaded yet")
    if not text.strip():
        raise ValueError("No text")
    speed = max(0.5, min(2.0, speed))
    lang = "en-gb" if voice.startswith("b") else "en-us"
    state: dict[str, Any] = {"done": False, "error": None}

    def work() -> None:
        global _kokoro
        try:
            with _kokoro_lock:
                if _kokoro is None:
                    from kokoro_onnx import Kokoro

                    _kokoro = Kokoro(str(KOKORO_DIR / "kokoro-v1.0.int8.onnx"), str(KOKORO_DIR / "voices-v1.0.bin"))
                samples, rate = _kokoro.create(text, voice=voice, speed=speed, lang=lang)
            pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
            tmp = out + ".part"
            with wave.open(tmp, "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(int(rate))
                w.writeframes(pcm)
            os.replace(tmp, out)
            state["seconds"] = round(len(samples) / rate, 3)
        except Exception as e:
            state["error"] = e
        finally:
            state["done"] = True

    threading.Thread(target=work, daemon=True).start()
    started = time.monotonic()
    while not state["done"]:
        await asyncio.sleep(0.3)
        await ctx.report_progress(0.5, 1.0, f"Speaking ({int(time.monotonic() - started)} s)")
    if state["error"] is not None:
        raise state["error"]  # type: ignore[misc]
    return {"path": out, "seconds": state["seconds"]}


# ───────────────────────── models, background removal, subject tracking ─────────────────────────


@mcp.tool()
def models_status() -> list[dict]:
    """Every local model: what it is for, licence, download size, whether it is on this computer."""
    return [catalog.status(m) for m in ("whisper", "kokoro", "rvm", "birefnet")]


@mcp.tool()
async def model_install(model_id: str, ctx: Context) -> dict:
    """Download a model (checksum-verified). Safe to call again."""
    await _threaded(ctx, lambda progress, cancelled: catalog.install(model_id, progress, cancelled), f"Downloading {catalog.spec(model_id)['name']}")
    return catalog.status(model_id)


@mcp.tool()
def model_remove(model_id: str) -> dict:
    """Delete a downloaded model to free disk space (it downloads again when needed)."""
    vision._sessions.clear()
    catalog.remove(model_id)
    return catalog.status(model_id)


@mcp.tool()
async def matte_video(path: str, out: str, ctx: Context) -> dict:
    """Separate people from the background in a video. Writes a grayscale matte video (white = keep) with the
    source's timestamps to `out` (.mp4)."""
    model = _need("rvm")

    def work(progress: Callable[[float], None], cancelled: Callable[[], bool]) -> dict:
        with _gpu_lock:
            return vision.matte_video(model, path, out, progress, cancelled)

    return await _threaded(ctx, work, "Removing background")


@mcp.tool()
async def matte_image(path: str, out: str, ctx: Context) -> dict:
    """Separate the subject from the background in a photo. Writes a grayscale matte PNG (white = keep) to `out`."""
    model = _need("birefnet")
    return await _threaded(ctx, lambda progress, cancelled: vision.matte_image(model, path, out), "Removing background")


@mcp.tool()
async def track_subject(path: str, ctx: Context, start: float = 0.0, end: float = 1e9, fps: float = 5.0) -> dict:
    """Where the person is in a video over time: samples {t, x, y, area} (source seconds; x/y 0..1, null when nobody
    is in frame), for reframing."""
    model = _need("rvm")

    def work(progress: Callable[[float], None], cancelled: Callable[[], bool]) -> dict:
        with _gpu_lock:
            return vision.track_subject(model, path, start, end, fps, progress, cancelled)

    return await _threaded(ctx, work, "Finding the subject")


def main() -> None:
    log(f"starting (models in {MODELS_DIR})")
    mcp.run("stdio")


if __name__ == "__main__":
    main()
