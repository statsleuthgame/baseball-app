#!/usr/bin/env python3
"""
Rebuild player_efp_stats_<season>.json from all resolved PP-line logs
for a season. Called nightly by resolve_pp_lines.py after each day's
resolution, so the stats cache grows as real 2026 games accumulate.

Falls back to a backtest-derived cache (built by build_player_efp_stats.py)
until we have enough logged games (≥5 per player) to stand on its own.

The merge logic: if a player has ≥5 resolved-log games, use those
(current-season reality). Otherwise fall back to backtest stats. That
way early-season projections still have a stdev floor while real data
accumulates.

Usage:
    python scripts/update_player_stats_from_logs.py 2026
    python scripts/update_player_stats_from_logs.py        # defaults current year
"""

from __future__ import annotations

import argparse
import json
import logging
import statistics
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "backend" / "app" / "data"
LOG_DIR = DATA_DIR / "pp_line_log"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger("update_stats")


def main(season: int) -> None:
    # 1. Collect actual fantasy EFPs per player across all resolved logs
    #    for the season.
    by_pid: dict[int, list[float]] = defaultdict(list)
    log_files = sorted(LOG_DIR.glob(f"{season}-*_resolved.jsonl"))
    if not log_files:
        logger.info("No resolved logs for %d yet — nothing to update.", season)
        return
    for path in log_files:
        with path.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not rec.get("played"):
                    continue
                pid = rec.get("player_id")
                actuals = rec.get("actuals") or {}
                efp = actuals.get("fantasy")
                if pid and efp is not None:
                    by_pid[pid].append(float(efp))

    logger.info("Aggregated %d games across %d players from %d log files",
                sum(len(v) for v in by_pid.values()), len(by_pid), len(log_files))

    # 2. Load existing cache (from backtest or prior build) as fallback.
    out_path = DATA_DIR / f"player_efp_stats_{season}.json"
    existing: dict = {}
    if out_path.exists():
        try:
            with out_path.open() as f:
                existing = json.load(f)
        except Exception:
            existing = {}

    # 3. For each player with ≥5 logged games, use log-derived stats.
    #    For others, keep existing (backtest-derived) entries.
    out: dict = {}
    log_derived = 0
    for pid, vals in by_pid.items():
        if len(vals) < 5:
            # Fall back to backtest if available; otherwise skip.
            if str(pid) in existing:
                out[str(pid)] = existing[str(pid)]
            continue
        mean = round(statistics.fmean(vals), 3)
        stdev = round(statistics.pstdev(vals), 3)
        out[str(pid)] = {"n": len(vals), "mean": mean, "stdev": stdev, "source": "log"}
        log_derived += 1

    # Also preserve backtest entries for players we haven't logged yet.
    carry_forward = 0
    for pid_str, data in existing.items():
        if pid_str == "_defaults":
            continue
        if pid_str not in out:
            data["source"] = data.get("source", "backtest")
            out[pid_str] = data
            carry_forward += 1

    # 4. Rebuild slate defaults — prefer logged actuals, fall back to
    #    backtest defaults if logs are still sparse.
    all_logged = [v for vals in by_pid.values() for v in vals]
    if len(all_logged) >= 200:
        default_mean = round(statistics.fmean(all_logged), 3)
        default_stdev = round(statistics.pstdev(all_logged), 3)
        out["_defaults"] = {"mean": default_mean, "stdev": default_stdev, "source": "log"}
    elif "_defaults" in existing:
        out["_defaults"] = existing["_defaults"]
    else:
        # Last-resort hardcoded defaults.
        out["_defaults"] = {"mean": 6.5, "stdev": 7.0, "source": "fallback"}

    # 5. Write.
    out_path.write_text(json.dumps(out, indent=2) + "\n")
    logger.info("Wrote %s: %d players (%d log-derived, %d backtest-carryover)",
                out_path.name, len(out) - 1, log_derived, carry_forward)
    logger.info("Default slate stdev: %.2f (source: %s)",
                out["_defaults"]["stdev"], out["_defaults"].get("source"))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("season", nargs="?", type=int, default=None)
    args = ap.parse_args()
    main(args.season or date.today().year)
