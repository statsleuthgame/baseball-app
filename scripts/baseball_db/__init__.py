"""Baseball DB loader package.

Writes raw source data (Statcast, Lahman, Chadwick, FanGraphs, MLB API,
Retrosheet) to an external drive partitioned by source/year, then builds
a DuckDB view layer over the Parquet for ad-hoc SQL analysis.

Drive path is resolved by `scripts.baseball_db.paths.db_root()`.
"""
