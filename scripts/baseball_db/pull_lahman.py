"""Pull the full Lahman database (1871-2019 season-level stats).

Pybaseball's bundled Lahman URL is dead. We pull the baseballdatabank
zip directly from cdalzell/Lahman's source-data mirror on GitHub (the
most reliable public mirror of the canonical CSVs) and dump each CSV
to Parquet.

Lahman only tracks through ~2019 — modern-era season stats are derived
from Statcast/MLB API in the app's pipeline, so this is purely
historical.
"""

from __future__ import annotations

import io
import zipfile

import httpx
import pandas as pd

from .paths import raw

LAHMAN_ZIP_URL = (
    "https://raw.githubusercontent.com/cdalzell/Lahman/master/"
    "source-data/baseballdatabank-master.zip"
)


def pull_all() -> None:
    out = raw("lahman")
    print("lahman: downloading zip...")
    resp = httpx.get(LAHMAN_ZIP_URL, timeout=60, follow_redirects=True)
    resp.raise_for_status()

    count = 0
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        for name in zf.namelist():
            if not name.lower().endswith(".csv") or "/core/" not in name:
                continue
            table = name.rsplit("/", 1)[-1].removesuffix(".csv")
            with zf.open(name) as f:
                df = pd.read_csv(f, low_memory=False)
            if df.empty:
                continue
            df.to_parquet(out / f"{table}.parquet", index=False)
            count += 1
            print(f"lahman {table}: {len(df):,} rows")
    print(f"lahman: {count} tables written")


if __name__ == "__main__":
    pull_all()
