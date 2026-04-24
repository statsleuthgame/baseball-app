"""Resolve the baseball-db root.

Default is the local copy at ~/Desktop/baseball-db. Override with env
var BASEBALL_DB_ROOT (or EDGE_DB_ROOT — accepted for parity with the
Edge project) to point elsewhere (e.g. tests or a different drive).
"""

from __future__ import annotations

import os
from pathlib import Path

DEFAULT_ROOT = Path.home() / "Desktop" / "baseball-db"


def db_root(require_exists: bool = True) -> Path:
    override = os.environ.get("BASEBALL_DB_ROOT") or os.environ.get("EDGE_DB_ROOT")
    root = Path(override) if override else DEFAULT_ROOT
    if require_exists and not root.exists():
        raise FileNotFoundError(
            f"Baseball DB root not found at {root}. "
            "Set BASEBALL_DB_ROOT to override."
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
