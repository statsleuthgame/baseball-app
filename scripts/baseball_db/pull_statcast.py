"""Pull Statcast pitch-level data year-by-year into Parquet.

Partitioned as raw/statcast/year=YYYY/month=MM.parquet. Idempotent: skips
months that already exist unless --force is passed.
"""

from __future__ import annotations

import argparse
import calendar
from datetime import date, timedelta

import pandas as pd
from pybaseball import statcast

from .paths import raw

# Statcast tracking begins in 2015. Regular season roughly Mar-Oct, but we
# query Feb-Nov to catch spring training noise and postseason.
STATCAST_FIRST_YEAR = 2015
MONTHS = list(range(2, 12))


def _month_range(year: int, month: int) -> tuple[str, str]:
    last = calendar.monthrange(year, month)[1]
    return f"{year}-{month:02d}-01", f"{year}-{month:02d}-{last:02d}"


def pull_month(year: int, month: int, force: bool = False) -> int:
    out_dir = raw("statcast", f"year={year}")
    out_file = out_dir / f"month={month:02d}.parquet"
    if out_file.exists() and not force:
        return 0

    start, end = _month_range(year, month)
    if date.fromisoformat(end) > date.today():
        end = date.today().isoformat()
        if date.fromisoformat(start) > date.today():
            return 0

    df = statcast(start_dt=start, end_dt=end, verbose=False)
    if df is None or df.empty:
        return 0

    df.to_parquet(out_file, index=False)
    return len(df)


def pull_all(start_year: int = STATCAST_FIRST_YEAR, force: bool = False) -> None:
    end_year = date.today().year
    for year in range(start_year, end_year + 1):
        for month in MONTHS:
            n = pull_month(year, month, force=force)
            print(f"statcast {year}-{month:02d}: {n:,} rows")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start-year", type=int, default=STATCAST_FIRST_YEAR)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    pull_all(start_year=args.start_year, force=args.force)


if __name__ == "__main__":
    main()
