#!/usr/bin/env python3
"""
Build per-player EFP-stdev cache from a backtest CSV.

The model ranking works fine but tells us nothing about CONFIDENCE. A
player projected at 11.0 with a 3-pt stdev is a much safer pick than
one projected at 11.0 with an 8-pt stdev. Edge-z ranking uses:

    edge_z = (projected_efp - pp_line) / stdev_efp

which is how many stdevs of headroom our projection has above the line
— the product-relevant confidence signal.

Usage:
    python scripts/build_player_efp_stats.py backend/app/data/backtest_20250915.csv

Output: backend/app/data/player_efp_stats_<season>.json
  { "<player_id>": {"n": 14, "mean": 6.8, "stdev": 4.2}, ... }
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import statistics
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger("stats")


def main(csv_path: Path) -> None:
    if not csv_path.exists():
        raise SystemExit(f"CSV not found: {csv_path}")

    # Derive season from end-date in CSV name if possible.
    name = csv_path.stem  # e.g. "backtest_20250915"
    season = None
    parts = name.split("_")
    if len(parts) >= 2 and len(parts[-1]) == 8:
        try:
            season = int(parts[-1][:4])
        except ValueError:
            pass
    if season is None:
        raise SystemExit(f"Can't derive season from {csv_path.stem}")

    by_pid: dict[int, list[float]] = defaultdict(list)
    with csv_path.open() as f:
        for r in csv.DictReader(f):
            try:
                pid = int(r["player_id"])
                actual = float(r["actual_efp"])
            except (KeyError, TypeError, ValueError):
                continue
            by_pid[pid].append(actual)

    out: dict[str, dict] = {}
    for pid, vals in by_pid.items():
        n = len(vals)
        if n < 5:
            # Too few games to estimate variance meaningfully — skip.
            continue
        mean = statistics.fmean(vals)
        # pstdev (population) is appropriate here; sample stdev would
        # over-penalize small samples.
        stdev = statistics.pstdev(vals)
        out[str(pid)] = {
            "n": n,
            "mean": round(mean, 3),
            "stdev": round(stdev, 3),
        }

    # Slate-wide defaults for players not in the cache (call-ups / fallback).
    all_actuals = [v for vals in by_pid.values() for v in vals]
    slate_mean = round(statistics.fmean(all_actuals), 3)
    slate_stdev = round(statistics.pstdev(all_actuals), 3)
    out["_defaults"] = {"mean": slate_mean, "stdev": slate_stdev}

    dest = ROOT / "backend" / "app" / "data" / f"player_efp_stats_{season}.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("w") as f:
        json.dump(out, f, indent=2)

    logger.info("Wrote %d players (+ defaults) → %s", len(out) - 1, dest.name)
    logger.info("Slate defaults: mean=%.2f  stdev=%.2f  (n=%d)",
                slate_mean, slate_stdev, len(all_actuals))

    # Distribution summary for sanity-check
    stdevs = [v["stdev"] for k, v in out.items() if k != "_defaults"]
    means = [v["mean"] for k, v in out.items() if k != "_defaults"]
    if stdevs:
        logger.info("stdev range: %.2f (p10) / %.2f (p50) / %.2f (p90)",
                    statistics.quantiles(stdevs, n=10)[0],
                    statistics.median(stdevs),
                    statistics.quantiles(stdevs, n=10)[-1])
        logger.info("mean  range: %.2f (p10) / %.2f (p50) / %.2f (p90)",
                    statistics.quantiles(means, n=10)[0],
                    statistics.median(means),
                    statistics.quantiles(means, n=10)[-1])


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("csv", type=Path, help="Backtest CSV (e.g. backtest_20250915.csv)")
    args = ap.parse_args()
    main(args.csv)
