"""Pull Statcast pitch-level data year-by-year into Parquet.

Partitioned as raw/statcast/year=YYYY/month=MM.parquet. pybaseball fetches
day-by-day internally, so we parallelize across months with a small thread
pool (Savant tolerates 4-6 concurrent clients).
"""

from __future__ import annotations

import argparse
import calendar
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date

from pybaseball import statcast

from .paths import raw

STATCAST_FIRST_YEAR = 2015
MONTHS = list(range(3, 11))  # regular season Mar-Oct; skip off-season noise
WORKERS = 5


def _month_range(year: int, month: int) -> tuple[str, str]:
    last = calendar.monthrange(year, month)[1]
    return f"{year}-{month:02d}-01", f"{year}-{month:02d}-{last:02d}"


def pull_month(year: int, month: int, force: bool = False) -> tuple[int, int, int]:
    out_dir = raw("statcast", f"year={year}")
    out_file = out_dir / f"month={month:02d}.parquet"
    if out_file.exists() and not force:
        return year, month, -1  # skipped

    start, end = _month_range(year, month)
    if date.fromisoformat(start) > date.today():
        return year, month, 0
    if date.fromisoformat(end) > date.today():
        end = date.today().isoformat()

    df = statcast(start_dt=start, end_dt=end, verbose=False)
    if df is None or df.empty:
        return year, month, 0
    df.to_parquet(out_file, index=False)
    return year, month, len(df)


def pull_all(start_year: int = STATCAST_FIRST_YEAR, force: bool = False) -> None:
    end_year = date.today().year
    jobs = [(y, m) for y in range(start_year, end_year + 1) for m in MONTHS]

    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futures = {ex.submit(pull_month, y, m, force): (y, m) for y, m in jobs}
        for f in as_completed(futures):
            y, m = futures[f]
            try:
                _, _, n = f.result()
            except Exception as exc:
                print(f"statcast {y}-{m:02d}: ERROR {exc}")
                continue
            tag = "skip" if n < 0 else f"{n:,} rows"
            print(f"statcast {y}-{m:02d}: {tag}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start-year", type=int, default=STATCAST_FIRST_YEAR)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    pull_all(start_year=args.start_year, force=args.force)


if __name__ == "__main__":
    main()
