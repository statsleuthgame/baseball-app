"""Build a DuckDB database with views over every Parquet source.

Creates `derived/duckdb/main.duckdb` with one view per source/table that
globs the underlying Parquet. Queries go through DuckDB; the Parquet files
stay as the source of truth on the drive.
"""

from __future__ import annotations

from pathlib import Path

import duckdb

from .paths import db_root, derived, raw


VIEWS: list[tuple[str, str]] = [
    # (view_name, parquet_glob)
    ("statcast", "statcast/year=*/month=*.parquet"),
    ("fangraphs_batting", "fangraphs/batting/year=*.parquet"),
    ("fangraphs_pitching", "fangraphs/pitching/year=*.parquet"),
    ("chadwick", "chadwick/people.parquet"),
    ("retrosheet_events", "retrosheet/events/year=*.parquet"),
    ("retrosheet_gamelogs", "retrosheet/gamelogs/all.parquet"),
    ("mlb_boxscores", "mlb_api/boxscores/year=*.parquet"),
    ("mlb_plays", "mlb_api/plays/year=*.parquet"),
]

DERIVED_VIEWS: list[tuple[str, str]] = [
    ("adv_batting_per_game", "advanced/batting_per_game/year=*.parquet"),
    ("adv_pitching_per_game", "advanced/pitching_per_game/year=*.parquet"),
    ("adv_batting_pitchtype", "advanced/batting_pitchtype_per_game/year=*.parquet"),
    ("adv_pitching_pitchtype", "advanced/pitching_pitchtype_per_game/year=*.parquet"),
    ("adv_league_rates", "advanced/league_rates/all.parquet"),
]


def _lahman_views(con: duckdb.DuckDBPyConnection) -> None:
    lahman_dir = raw("lahman")
    for f in lahman_dir.glob("*.parquet"):
        # Skip macOS AppleDouble junk files (._Foo.parquet).
        if f.name.startswith("._"):
            continue
        # Lowercase + quoted so mixed-case filenames (e.g. BattingPost.parquet)
        # don't get parsed as `schema.table` identifiers.
        name = f"lahman_{f.stem.lower()}"
        try:
            con.execute(
                f'CREATE OR REPLACE VIEW "{name}" AS '
                f"SELECT * FROM read_parquet('{f.as_posix()}')"
            )
        except duckdb.Error as exc:
            print(f"skip view {name}: {exc}")


def build() -> Path:
    db_path = derived("duckdb") / "main.duckdb"
    con = duckdb.connect(db_path.as_posix())
    raw_root = db_root() / "raw"

    for name, glob in VIEWS:
        pattern = (raw_root / glob).as_posix()
        try:
            con.execute(
                f"CREATE OR REPLACE VIEW {name} AS "
                f"SELECT * FROM read_parquet('{pattern}', union_by_name=true, hive_partitioning=1)"
            )
        except duckdb.Error as exc:
            print(f"skip view {name}: {exc}")

    derived_root = db_root() / "derived"
    for name, glob in DERIVED_VIEWS:
        pattern = (derived_root / glob).as_posix()
        try:
            con.execute(
                f"CREATE OR REPLACE VIEW {name} AS "
                f"SELECT * FROM read_parquet('{pattern}', union_by_name=true, hive_partitioning=1)"
            )
        except duckdb.Error as exc:
            print(f"skip view {name}: {exc}")

    _lahman_views(con)
    con.close()
    return db_path


if __name__ == "__main__":
    path = build()
    print(f"DuckDB ready: {path}")
