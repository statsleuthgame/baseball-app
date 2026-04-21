"""Orchestrator: run every pull in the recommended order, then build DuckDB.

Each source is independent and idempotent. Failures in one source are
logged but do not abort the rest.

Usage:
    python -m scripts.baseball_db.pull_all               # run everything
    python -m scripts.baseball_db.pull_all --only statcast lahman
"""

from __future__ import annotations

import argparse
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

SOURCES = {
    "chadwick": pull_chadwick.pull_all,
    "lahman": pull_lahman.pull_all,
    "statcast": pull_statcast.pull_all,
    "fangraphs": pull_fangraphs.pull_all,
    "retrosheet": lambda: (pull_retrosheet.pull_events(), pull_retrosheet.pull_gamelogs()),
    "mlb_api": pull_mlb_api.pull_all,
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--only",
        nargs="+",
        choices=list(SOURCES.keys()),
        help="Run only the named sources",
    )
    ap.add_argument("--skip-duckdb", action="store_true")
    args = ap.parse_args()

    targets = args.only or list(SOURCES.keys())
    log_file = logs() / f"pull_all_{datetime.now():%Y%m%d_%H%M%S}.log"

    with log_file.open("w") as log:
        for name in targets:
            log.write(f"\n=== {name} @ {datetime.now().isoformat()} ===\n")
            log.flush()
            print(f"\n=== {name} ===")
            try:
                SOURCES[name]()
            except Exception:
                tb = traceback.format_exc()
                log.write(tb)
                print(tb)

        if not args.skip_duckdb:
            log.write(f"\n=== duckdb @ {datetime.now().isoformat()} ===\n")
            try:
                path = build_duckdb.build()
                log.write(f"built {path}\n")
                print(f"DuckDB: {path}")
            except Exception:
                log.write(traceback.format_exc())
                print(traceback.format_exc())

    print(f"\nLog: {log_file}")


if __name__ == "__main__":
    main()
