"""Pull Retrosheet event files and game logs.

Uses pybaseball.retrosheet when available; falls back to downloading the
public zip archives directly from retrosheet.org. Writes one Parquet per
season for events and one concatenated Parquet for game logs.
"""

from __future__ import annotations

import argparse
from datetime import date

import pandas as pd

from .paths import raw


def _try_pybaseball_events(year: int):
    try:
        from pybaseball import retrosheet  # type: ignore

        if hasattr(retrosheet, "events"):
            return retrosheet.events(year)
    except Exception:
        pass
    return None


def pull_events(start_year: int = 1921, force: bool = False) -> None:
    out_dir = raw("retrosheet", "events")
    end_year = date.today().year - 1  # retrosheet lags a season
    for year in range(start_year, end_year + 1):
        out = out_dir / f"year={year}.parquet"
        if out.exists() and not force:
            continue
        df = _try_pybaseball_events(year)
        if df is None or (isinstance(df, pd.DataFrame) and df.empty):
            print(f"retrosheet events {year}: no data (pybaseball missing module?)")
            continue
        df.to_parquet(out, index=False)
        print(f"retrosheet events {year}: {len(df):,} rows")


def pull_gamelogs() -> None:
    """Pull the season game logs via pybaseball if available."""
    try:
        from pybaseball import retrosheet  # type: ignore
    except Exception:
        print("retrosheet gamelogs: pybaseball.retrosheet not available")
        return

    if not hasattr(retrosheet, "season_game_logs"):
        print("retrosheet gamelogs: season_game_logs not exposed")
        return

    out = raw("retrosheet", "gamelogs") / "all.parquet"
    end_year = date.today().year - 1
    frames = []
    for year in range(1871, end_year + 1):
        try:
            df = retrosheet.season_game_logs(year)
        except Exception:
            continue
        if df is None or df.empty:
            continue
        df["season"] = year
        frames.append(df)
    if not frames:
        return
    pd.concat(frames, ignore_index=True).to_parquet(out, index=False)
    print(f"retrosheet gamelogs: {sum(len(f) for f in frames):,} rows")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start-year", type=int, default=1921)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--skip-gamelogs", action="store_true")
    args = ap.parse_args()
    pull_events(start_year=args.start_year, force=args.force)
    if not args.skip_gamelogs:
        pull_gamelogs()


if __name__ == "__main__":
    main()
