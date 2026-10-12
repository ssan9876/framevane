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
from typing import Any

from mcp.server.mcpserver import Context, MCPServer


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


def main() -> None:
    log(f"starting (models in {MODELS_DIR})")
    mcp.run("stdio")


if __name__ == "__main__":
    main()
