"""Orchestrator: run independent sources in parallel processes.

Savant, FanGraphs, MLB StatsAPI, and retrosheet.org are distinct servers
with independent rate limits, so running their pullers in separate
processes is the biggest end-to-end speedup. Lahman + Chadwick are tiny
and run sequentially first so the rest can use the local cache.

Usage:
    python -m scripts.baseball_db.pull_all
    python -m scripts.baseball_db.pull_all --only statcast mlb_api
    python -m scripts.baseball_db.pull_all --serial   # debug mode
"""

from __future__ import annotations

import argparse
import multiprocessing as mp
import traceback
from datetime import datetime

from . import (
    build_duckdb,
    pull_chadwick,
    pull_fangraphs,
    pull_lahman,
    pull_mlb_api,
    pull_retrosheet,
    pull_statcast,
)
from .paths import logs

# Sources that should run sequentially BEFORE the parallel wave.
SETUP_SOURCES = {
    "chadwick": pull_chadwick.pull_all,
    "lahman": pull_lahman.pull_all,
}

def _pull_retrosheet_all() -> None:
    pull_retrosheet.pull_events()
    pull_retrosheet.pull_gamelogs()


# Long-running sources; each talks to a different server.
PARALLEL_SOURCES = {
    "statcast": pull_statcast.pull_all,
    "fangraphs": pull_fangraphs.pull_all,
    "mlb_api": pull_mlb_api.pull_all,
    "retrosheet": _pull_retrosheet_all,
}

ALL_SOURCES = {**SETUP_SOURCES, **PARALLEL_SOURCES}


def _run_one(name: str, fn) -> None:
    try:
        fn()
    except Exception:
        print(f"[{name}] FAILED:\n{traceback.format_exc()}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="+", choices=list(ALL_SOURCES.keys()))
    ap.add_argument("--skip-duckdb", action="store_true")
    ap.add_argument("--serial", action="store_true", help="Run everything sequentially")
    args = ap.parse_args()

    targets = args.only or list(ALL_SOURCES.keys())
    log_file = logs() / f"pull_all_{datetime.now():%Y%m%d_%H%M%S}.log"
    print(f"Log: {log_file}")

    setup = [n for n in targets if n in SETUP_SOURCES]
    parallel = [n for n in targets if n in PARALLEL_SOURCES]

    # Setup wave: tiny pulls, sequential so Lahman cache is warm first.
    for name in setup:
        print(f"\n=== {name} ===")
        _run_one(name, ALL_SOURCES[name])

    # Parallel wave: separate processes, one per source.
    if args.serial:
        for name in parallel:
            print(f"\n=== {name} (serial) ===")
            _run_one(name, ALL_SOURCES[name])
    elif parallel:
        print(f"\n=== parallel: {', '.join(parallel)} ===")
        ctx = mp.get_context("spawn")
        procs = [
            ctx.Process(target=_run_one, args=(name, ALL_SOURCES[name]), name=name)
            for name in parallel
        ]
        for p in procs:
            p.start()
        for p in procs:
            p.join()

    if not args.skip_duckdb:
        print("\n=== build_duckdb ===")
        try:
            path = build_duckdb.build()
            print(f"DuckDB: {path}")
        except Exception:
            print(traceback.format_exc())


if __name__ == "__main__":
    main()
