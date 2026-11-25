"""Download every local AI model the e2e suite uses into one folder, the way the app does (same catalogue, same pinned
SHA-256 sums), so CI can cache them once and share them between test shards and platforms.

Usage: uv run --no-project --with faster-whisper==1.2.1 python .github/scripts/fetch-models.py <models dir>
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "sidecar"))

from framevane_sidecar.models import MODELS, Catalog  # noqa: E402


def main() -> None:
    catalog = Catalog(sys.argv[1])
    for model_id in MODELS:
        if catalog.ready(model_id):
            print(f"{model_id}: already here")
            continue
        print(f"{model_id}: downloading", flush=True)
        catalog.install(model_id, progress=lambda _p: None, cancelled=lambda: False)
        if not catalog.ready(model_id):
            raise SystemExit(f"{model_id}: still missing after the download")
        print(f"{model_id}: ready", flush=True)


if __name__ == "__main__":
    main()
