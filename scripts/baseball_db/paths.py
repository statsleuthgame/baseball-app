"""Resolve the baseball-db root on the external drive.

Override with env var BASEBALL_DB_ROOT to point elsewhere (e.g. tests or a
different drive). Default is /Volumes/TESLADRIVE/baseball-db.
"""

from __future__ import annotations

import os
from pathlib import Path

DEFAULT_ROOT = Path("/Volumes/TESLADRIVE/baseball-db")


def db_root(require_exists: bool = True) -> Path:
    root = Path(os.environ.get("BASEBALL_DB_ROOT", str(DEFAULT_ROOT)))
    if require_exists and not root.exists():
        raise FileNotFoundError(
            f"Baseball DB root not found at {root}. "
            "Plug in the external drive or set BASEBALL_DB_ROOT."
        )
    return root


def raw(*parts: str) -> Path:
    p = db_root() / "raw" / Path(*parts)
    p.mkdir(parents=True, exist_ok=True)
    return p


def derived(*parts: str) -> Path:
    p = db_root() / "derived" / Path(*parts)
    p.mkdir(parents=True, exist_ok=True)
    return p


def cache(*parts: str) -> Path:
    p = db_root() / "cache" / Path(*parts)
    p.mkdir(parents=True, exist_ok=True)
    return p


def logs() -> Path:
    p = db_root() / "logs"
    p.mkdir(parents=True, exist_ok=True)
    return p
