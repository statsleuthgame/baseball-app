"""Pull the full Lahman database (1871-present season-level stats).

Dumps every table pybaseball.lahman exposes as Parquet.
"""

from __future__ import annotations

import inspect

import pandas as pd
from pybaseball import lahman

from .paths import raw

# Tables are exposed as zero-arg functions on pybaseball.lahman.
# We introspect to avoid hard-coding and to pick up new tables.
SKIP = {"download_lahman"}


def pull_all() -> None:
    out = raw("lahman")
    for name, fn in inspect.getmembers(lahman, inspect.isfunction):
        if name in SKIP or name.startswith("_"):
            continue
        # Only take functions that produce DataFrames with no required args.
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
