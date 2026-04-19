#!/usr/bin/env python3
"""
Aggregate all resolved PP-line logs into product-relevant hit-rate
tables. The answer to "is my model actually beating PrizePicks?" — grounded in
REAL logged PP lines, not proxies.

Reads `backend/app/data/pp_line_log/*_resolved.jsonl` (produced by
resolve_pp_lines.py) and emits:

  1. Hit rate per confidence tier (HIGH / MED / LOW / FADE) against the
     PrizePicks `fantasy` stat line — the main daily-best-bets metric.
  2. Hit rate per confidence tier per STAT (hits, HR, RBI, etc.) to
     surface which stats the model calibrates on best.
  3. Daily summary: how many HIGH CONF picks per day on average,
     what happens when you bet them.
  4. Over/Under model calibration check: average edge_z for winning vs
     losing picks — should be positive for winners.

Usage:
    python scripts/analyze_pp_history.py
    python scripts/analyze_pp_history.py --since 2026-04-01
    python scripts/analyze_pp_history.py --stat hits   # focus on one stat
"""

from __future__ import annotations

import argparse
import json
import logging
import statistics
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = ROOT / "backend" / "app" / "data" / "pp_line_log"

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("analyze_pp")


def _tier(z: float | None) -> str | None:
    if z is None:
        return None
    if z < 0:
        return "FADE"
    if z < 0.3:
        return "LOW"
    if z < 0.8:
        return "MED"
    return "HIGH"


def _pct(n: int, d: int) -> str:
    if d == 0:
        return "—"
    return f"{n/d*100:5.1f}% ({n}/{d})"


def load_resolved(since: str | None, until: str | None) -> list[dict]:
    if not LOG_DIR.exists():
        return []
    out: list[dict] = []
    for p in sorted(LOG_DIR.glob("*_resolved.jsonl")):
        dt = p.stem.replace("_resolved", "")
        if since and dt < since:
            continue
        if until and dt > until:
            continue
        with p.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default=None, help="YYYY-MM-DD inclusive")
    ap.add_argument("--until", default=None, help="YYYY-MM-DD inclusive")
    ap.add_argument("--stat", default="fantasy",
                    help="PP stat to focus on for the main table (default: fantasy)")
    args = ap.parse_args()

    records = load_resolved(args.since, args.until)
    if not records:
        logger.info("No resolved logs found in %s", LOG_DIR)
        logger.info("Once resolve_pp_lines.py has written files, re-run this.")
        return

    played = [r for r in records if r.get("played")]
    dates = sorted({r["game_date"] for r in records})
    logger.info("\n=== PP-line history: %d records across %d days (%s → %s) ===",
                len(records), len(dates), dates[0], dates[-1])
    logger.info("    Players with actuals: %d (%.0f%%)\n",
                len(played), len(played) / len(records) * 100 if records else 0)

    # ----- Table 1: tier × result for the focus stat -----
    stat = args.stat
    logger.info(f"=== Hit rate by confidence tier — stat: {stat} ===")
    logger.info(f"{'tier':<6} {'bets over':>12} {'bets under':>12} {'over-hit rate':>18}")
    tier_rows: dict[str, dict] = defaultdict(lambda: {"over_wins": 0, "over_bets": 0,
                                                      "under_wins": 0, "under_bets": 0})
    for r in played:
        tier = _tier(r.get("edge_z"))
        if tier is None:
            continue
        res = (r.get("results") or {}).get(stat)
        if not res:
            continue
        grade = res.get("grade")
        # For confidence tiers (HIGH/MED/LOW), we'd bet OVER. For FADE we
        # might bet UNDER. Track both.
        if tier in ("HIGH", "MED", "LOW"):
            tier_rows[tier]["over_bets"] += 1
            if grade == "over":
                tier_rows[tier]["over_wins"] += 1
        else:  # FADE
            tier_rows[tier]["under_bets"] += 1
            if grade == "under":
                tier_rows[tier]["under_wins"] += 1

    for tier in ("HIGH", "MED", "LOW", "FADE"):
        row = tier_rows.get(tier) or {"over_bets": 0, "over_wins": 0, "under_bets": 0, "under_wins": 0}
        o_hit = _pct(row["over_wins"], row["over_bets"])
        u_hit = _pct(row["under_wins"], row["under_bets"])
        if tier == "FADE":
            logger.info(f"{tier:<6} {'-':>12} {row['under_bets']:>12} {u_hit:>18} (under)")
        else:
            logger.info(f"{tier:<6} {row['over_bets']:>12} {'-':>12} {o_hit:>18}")

    # ----- Table 2: by daily slate — how many HIGH CONF picks? -----
    logger.info(f"\n=== Daily slate shape ===")
    by_day: dict[str, dict] = defaultdict(lambda: {"high": 0, "med": 0, "low": 0,
                                                    "fade": 0, "total": 0})
    for r in played:
        tier = _tier(r.get("edge_z"))
        d = r["game_date"]
        by_day[d]["total"] += 1
        if tier == "HIGH":
            by_day[d]["high"] += 1
        elif tier == "MED":
            by_day[d]["med"] += 1
        elif tier == "LOW":
            by_day[d]["low"] += 1
        elif tier == "FADE":
            by_day[d]["fade"] += 1
    high_counts = [v["high"] for v in by_day.values()]
    med_counts = [v["med"] for v in by_day.values()]
    if high_counts:
        logger.info(f"  Avg picks per day — HIGH: {statistics.fmean(high_counts):.1f}, "
                    f"MED: {statistics.fmean(med_counts):.1f}")
        logger.info(f"  HIGH range: {min(high_counts)} / {max(high_counts)}")

    # ----- Table 3: calibration — edge_z of winners vs losers -----
    logger.info(f"\n=== Edge-z calibration check (stat: {stat}) ===")
    winners_z: list[float] = []
    losers_z: list[float] = []
    for r in played:
        z = r.get("edge_z")
        res = (r.get("results") or {}).get(stat)
        if z is None or not res:
            continue
        tier = _tier(z)
        if tier == "FADE":
            # Convert: "betting under, under wins" = winner
            if res.get("grade") == "under":
                winners_z.append(z)
            elif res.get("grade") == "over":
                losers_z.append(z)
        else:
            if res.get("grade") == "over":
                winners_z.append(z)
            elif res.get("grade") == "under":
                losers_z.append(z)
    if winners_z and losers_z:
        logger.info(f"  Winners: n={len(winners_z):>4}  avg edge_z={statistics.fmean(winners_z):+.3f}σ")
        logger.info(f"  Losers:  n={len(losers_z):>4}  avg edge_z={statistics.fmean(losers_z):+.3f}σ")
        logger.info(f"  Gap:     {statistics.fmean(winners_z) - statistics.fmean(losers_z):+.3f}σ"
                    f"  (positive = model separates winners from losers)")

    # ----- Table 4: per-stat rollup for HIGH+MED picks -----
    all_stats = set()
    for r in played:
        all_stats.update((r.get("results") or {}).keys())
    if all_stats:
        logger.info(f"\n=== Per-stat hit rate for HIGH+MED picks ===")
        logger.info(f"{'stat':<15} {'over-bets':>10} {'over-hit':>12} {'under-bets':>12} {'under-hit':>12}")
        for stat_name in sorted(all_stats):
            ow = ob = uw = ub = 0
            for r in played:
                tier = _tier(r.get("edge_z"))
                res = (r.get("results") or {}).get(stat_name)
                if not res:
                    continue
                if tier in ("HIGH", "MED"):
                    ob += 1
                    if res.get("grade") == "over":
                        ow += 1
                elif tier == "FADE":
                    ub += 1
                    if res.get("grade") == "under":
                        uw += 1
            if ob == 0 and ub == 0:
                continue
            logger.info(f"{stat_name:<15} {ob:>10} {_pct(ow, ob):>12} {ub:>12} {_pct(uw, ub):>12}")


if __name__ == "__main__":
    main()
