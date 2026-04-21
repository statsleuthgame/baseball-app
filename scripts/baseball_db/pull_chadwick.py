"""Pull the Chadwick player register (MLBAM / FanGraphs / Retrosheet ID map)."""

from __future__ import annotations

from pybaseball import chadwick_register

from .paths import raw


def pull_all() -> None:
    df = chadwick_register(save=False)
    df.to_parquet(raw("chadwick") / "people.parquet", index=False)
    print(f"chadwick: {len(df):,} rows")


if __name__ == "__main__":
    pull_all()
