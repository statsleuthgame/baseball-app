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
]


def _lahman_views(con: duckdb.DuckDBPyConnection) -> None:
    lahman_dir = raw("lahman")
    for f in lahman_dir.glob("*.parquet"):
        name = f"lahman_{f.stem}"
        con.execute(
            f"CREATE OR REPLACE VIEW {name} AS SELECT * FROM read_parquet('{f.as_posix()}')"
        )


def build() -> Path:
    db_path = derived("duckdb") / "main.duckdb"
    con = duckdb.connect(db_path.as_posix())
    raw_root = db_root() / "raw"

    for name, glob in VIEWS:
        pattern = (raw_root / glob).as_posix()
        # read_parquet handles globs; wrap in try-except views are conditional
        # on files existing for Statcast/FG etc.
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
