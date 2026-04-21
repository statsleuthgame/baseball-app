"""Pull FanGraphs leaderboards (batting + pitching) year-by-year."""

from __future__ import annotations

import argparse
from datetime import date

from pybaseball import batting_stats, pitching_stats

from .paths import raw

FANGRAPHS_FIRST_YEAR = 1871  # FG has partial historical; safe floor


def pull_all(start_year: int = 2000, force: bool = False) -> None:
    end_year = date.today().year
    bat_dir = raw("fangraphs", "batting")
    pit_dir = raw("fangraphs", "pitching")

    for year in range(start_year, end_year + 1):
        for kind, fn, out_dir in (
            ("batting", batting_stats, bat_dir),
            ("pitching", pitching_stats, pit_dir),
        ):
            out = out_dir / f"year={year}.parquet"
            if out.exists() and not force:
                continue
            try:
                # qual=0 pulls every player, not just qualified.
                df = fn(year, qual=0)
            except Exception as exc:
                print(f"fangraphs {kind} {year}: skipped ({exc})")
                continue
            if df is None or df.empty:
                continue
            df.to_parquet(out, index=False)
            print(f"fangraphs {kind} {year}: {len(df):,} rows")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start-year", type=int, default=2000)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    pull_all(start_year=args.start_year, force=args.force)


if __name__ == "__main__":
    main()
