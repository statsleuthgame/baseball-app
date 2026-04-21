"""Pull the full Lahman database (1871-present season-level stats).

Downloads the Lahman zip once via pybaseball's helper, then reads every
table it exposes and writes Parquet. This avoids per-table network
round-trips.
"""

from __future__ import annotations

import inspect

import pandas as pd
from pybaseball import lahman

from .paths import raw

SKIP = {"download_lahman"}


def pull_all() -> None:
    # Warm pybaseball's local Lahman cache in one shot.
    if hasattr(lahman, "download_lahman"):
        try:
            lahman.download_lahman()
        except Exception as exc:
            print(f"lahman download warning: {exc}")

    out = raw("lahman")
    for name, fn in inspect.getmembers(lahman, inspect.isfunction):
        if name in SKIP or name.startswith("_"):
            continue
        sig = inspect.signature(fn)
        required = [p for p in sig.parameters.values() if p.default is inspect.Parameter.empty]
        if required:
            continue
        try:
            df = fn()
        except Exception as exc:
            print(f"lahman {name}: skipped ({exc})")
            continue
        if not isinstance(df, pd.DataFrame) or df.empty:
            continue
        df.to_parquet(out / f"{name}.parquet", index=False)
        print(f"lahman {name}: {len(df):,} rows")


if __name__ == "__main__":
    pull_all()
