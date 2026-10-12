"""The local model catalogue: what each model is for, its licence, where it lives, and download/remove.

Files are fetched over HTTPS and checked against pinned SHA-256 sums, so a changed or tampered file is refused.
Whisper comes from the Hugging Face hub through faster-whisper (its own revision pinning).
"""

from __future__ import annotations

import hashlib
import shutil
import urllib.request
from pathlib import Path
from typing import Any, Callable

GH = "https://github.com/"

MODELS: dict[str, dict[str, Any]] = {
    "whisper": {
        "name": "Speech to text (Whisper large-v3 turbo)",
        "purpose": "Captions, transcripts, silence and filler cuts",
        "license": "MIT",
        "size": 1_620_000_000,
        "hf": ("large-v3-turbo", "models--mobiuslabsgmbh--faster-whisper-large-v3-turbo"),
    },
    "kokoro": {
        "name": "Natural voices (Kokoro v1.0)",
        "purpose": "Text to speech",
        "license": "Apache-2.0",
        "dir": "kokoro",
        "files": {
            "kokoro-v1.0.int8.onnx": (GH + "thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx", "6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb", 92_361_271),
            "voices-v1.0.bin": (GH + "thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin", "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d", 28_214_398),
        },
    },
    "rvm": {
        "name": "Video background removal (Robust Video Matting)",
        "purpose": "Remove background on video, auto reframe",
        "license": "GPL-3.0 (fine for your own use; review before distributing the app)",
        "dir": "rvm",
        "files": {
            "rvm_mobilenetv3_fp32.onnx": (GH + "PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx", "88d4531297118f595bf2fd60f6f566aec2e559393802d1f436c380f0cbbd2828", 14_975_696),
        },
    },
    "birefnet": {
        "name": "Photo background removal (BiRefNet lite)",
        "purpose": "Remove background on photos",
        "license": "MIT",
        "dir": "birefnet",
        "files": {
            # the official BiRefNet lite weights as ONNX, from rembg's model releases
            "BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx": (GH + "danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx", "5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333", 224_005_088),
        },
    },
}


class Catalog:
    def __init__(self, root: str) -> None:
        self.root = Path(root)

    def spec(self, model_id: str) -> dict[str, Any]:
        if model_id not in MODELS:
            raise ValueError(f"Unknown model {model_id}. Known: {', '.join(MODELS)}")
        return MODELS[model_id]

    def file(self, model_id: str, name: str | None = None) -> Path:
        spec = self.spec(model_id)
        return self.root / spec["dir"] / (name or next(iter(spec["files"])))

    def _hf_dir(self, spec: dict[str, Any]) -> Path:
        return self.root / spec["hf"][1]

    def ready(self, model_id: str) -> bool:
        spec = self.spec(model_id)
        if "hf" in spec:
            return any(self._hf_dir(spec).glob("snapshots/*/model.bin"))
        return all((self.root / spec["dir"] / f).is_file() for f in spec["files"])

    def status(self, model_id: str) -> dict[str, Any]:
        spec = self.spec(model_id)
        where = self._hf_dir(spec) if "hf" in spec else self.root / spec["dir"]
        on_disk = sum(p.stat().st_size for p in where.rglob("*") if p.is_file()) if where.exists() else 0
        return {"id": model_id, "name": spec["name"], "purpose": spec["purpose"], "license": spec["license"], "sizeBytes": spec.get("size") or sum(f[2] for f in spec["files"].values()), "ready": self.ready(model_id), "onDiskBytes": on_disk}

    def install(self, model_id: str, progress: Callable[[float], None], cancelled: Callable[[], bool]) -> None:
        spec = self.spec(model_id)
        if "hf" in spec:
            from faster_whisper import download_model

            progress(0.05)
            download_model(spec["hf"][0], cache_dir=str(self.root))
            return
        d = self.root / spec["dir"]
        d.mkdir(parents=True, exist_ok=True)
        files = spec["files"]
        total = sum(f[2] for f in files.values())
        done = 0
        for name, (url, sha, size) in files.items():
            dest = d / name
            if dest.is_file():
                done += size
                continue
            tmp = dest.with_suffix(dest.suffix + ".part")
            h = hashlib.sha256()
            try:
                with urllib.request.urlopen(url, timeout=60) as r, open(tmp, "wb") as f:
                    while chunk := r.read(1 << 20):
                        if cancelled():
                            raise RuntimeError("Download cancelled")
                        f.write(chunk)
                        h.update(chunk)
                        done += len(chunk)
                        progress(min(0.99, done / total))
                if h.hexdigest() != sha:
                    raise RuntimeError(f"{name} failed its checksum check; the download was discarded")
                tmp.replace(dest)
            finally:
                tmp.unlink(missing_ok=True)

    def remove(self, model_id: str) -> None:
        spec = self.spec(model_id)
        target = self._hf_dir(spec) if "hf" in spec else self.root / spec["dir"]
        if target.exists():
            shutil.rmtree(target)
