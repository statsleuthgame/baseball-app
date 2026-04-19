#!/usr/bin/env python3
"""
Past-N-day performance report: re-project every row in the 2026 backtest
CSV under currently-shipped weights (including shrinkage + calibration
+ topK-fit exponents), filter to the last N days, and show per-day top-6
picks + hit rates.

Answers the question: "If I'd been using this system over the last 10
days, how would my picks have done?"

Usage:
    python scripts/past_10_day_report.py
    python scripts/past_10_day_report.py --days 10
    python scripts/past_10_day_report.py --days 10 --k 6 --line 7.5
"""

from __future__ import annotations

import argparse
import csv
import logging
import statistics
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

# Reuse the reprojection logic (keeps us in sync with production math)
sys.path.insert(0, str(ROOT / "scripts"))
from validate_edge_z_tiers import reproject_row  # noqa: E402
from app.services.fantasy import load_weights, load_league_rates  # noqa: E402
from app.services.player_stats import get_player_stats  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("past_n")


def main(csv_path: Path, days: int, k: int, line: float) -> None:
    w = load_weights()
    lg = load_league_rates()
    season = int(csv_path.stem.split("_")[-1][:4])

    # Load rows, re-project under current weights.
    by_date: dict[str, list[dict]] = defaultdict(list)
    with csv_path.open() as f:
        for r in csv.DictReader(f):
            try:
                actual = float(r["actual_efp"])
                pid = int(r["player_id"])
            except (TypeError, ValueError, KeyError):
                continue
            projected = reproject_row(r, w, lg)
            stats = get_player_stats(pid, season)
            by_date[r["date"]].append({
                "pid": pid,
                "name": r.get("player_name", ""),
                "team": r.get("team_abbr", ""),
                "opp": "",  # not stored in CSV
                "projected": projected,
                "actual": actual,
                "stdev": stats["stdev"],
            })

    # Filter to last N days.
    dates = sorted(by_date.keys())[-days:]
    if not dates:
        logger.info("No dates found in CSV; nothing to analyze.")
        return

    total_picks = 0
    total_actual = 0.0
    total_projected = 0.0
    total_hits_7 = total_hits_5 = total_hits_10 = 0
    slate_medians = []

    print(f"\n=== PAST {len(dates)} DAYS TOP-{k} PICKS (current shipped weights) ===\n")
    for date in dates:
        rows = by_date[date]
        rows.sort(key=lambda r: r["projected"], reverse=True)
        top_k = rows[:k]
        # Daily metrics
        proj_avg = statistics.fmean(r["projected"] for r in top_k)
        act_avg = statistics.fmean(r["actual"] for r in top_k)
        slate_all = [r["actual"] for r in rows]
        slate_median = statistics.median(slate_all) if slate_all else 0
        slate_medians.append(slate_median)
        hits_over_5 = sum(1 for r in top_k if r["actual"] > 5.5)
        hits_over_7 = sum(1 for r in top_k if r["actual"] > line)
        hits_over_10 = sum(1 for r in top_k if r["actual"] > 10.0)
        total_picks += k
        total_projected += sum(r["projected"] for r in top_k)
        total_actual += sum(r["actual"] for r in top_k)
        total_hits_5 += hits_over_5
        total_hits_7 += hits_over_7
        total_hits_10 += hits_over_10

        # Per-day table
        print(f"--- {date} ({len(rows)} batters, slate median {slate_median:.1f}) ---")
        print(f"{'rank':<5}{'name':<25}{'team':<5}{'proj':>6}{'actual':>8}{'>5.5':>6}{'>'+str(line):>6}{'>10':>6}")
        for i, r in enumerate(top_k, 1):
            def g(t):
                return "✓" if r["actual"] > t else "✗"
            print(f"{i:<5}{r['name'][:24]:<25}{r['team']:<5}{r['projected']:>6.2f}{r['actual']:>8.1f}"
                  f"{g(5.5):>6}{g(line):>6}{g(10.0):>6}")
        print(f"      Day top-{k}: proj avg {proj_avg:.2f}  actual avg {act_avg:.2f}  "
              f"hit rates  >5.5: {hits_over_5}/{k}  >{line}: {hits_over_7}/{k}  >10: {hits_over_10}/{k}\n")

    # Rollup
    print(f"=== ROLLUP — {len(dates)} days ===")
    print(f"  Total top-{k} picks:          {total_picks}")
    print(f"  Avg projected:               {total_projected/total_picks:.2f}")
    print(f"  Avg actual:                  {total_actual/total_picks:.2f}")
    print(f"  Avg slate median:            {statistics.fmean(slate_medians):.2f}")
    print(f"  Hit rate > 5.5:              {total_hits_5}/{total_picks} = {total_hits_5/total_picks*100:.1f}%")
    print(f"  Hit rate > {line}:              {total_hits_7}/{total_picks} = {total_hits_7/total_picks*100:.1f}%")
    print(f"  Hit rate > 10.0:             {total_hits_10}/{total_picks} = {total_hits_10/total_picks*100:.1f}%")
    lift = (total_actual/total_picks) / statistics.fmean(slate_medians) * 100
    print(f"  Model top-{k} vs slate median: {lift:.0f}% of slate-median performance ({(lift-100):+.0f}% lift)")

    # Parlay break-even context
    print(f"\n=== PARLAY BREAK-EVEN REFERENCE ===")
    print(f"  2-leg +200 needs 57.7% per leg  — your rate at {line}: "
          f"{'✓ PROFITABLE' if total_hits_7/total_picks >= 0.577 else '✗ below'}")
    print(f"  3-leg +490 needs 55.4% per leg  — your rate at {line}: "
          f"{'✓ PROFITABLE' if total_hits_7/total_picks >= 0.554 else '✗ below'}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", type=Path,
                    default=ROOT / "backend" / "app" / "data" / "backtest_20260418.csv")
    ap.add_argument("--days", type=int, default=10)
    ap.add_argument("--k", type=int, default=6)
    ap.add_argument("--line", type=float, default=7.5)
    args = ap.parse_args()
    main(args.csv, args.days, args.k, args.line)
