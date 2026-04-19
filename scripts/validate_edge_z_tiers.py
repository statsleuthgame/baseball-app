#!/usr/bin/env python3
"""
Empirically validate the edge_z → confidence-tier → hit-rate mapping by
re-projecting the backtest CSV under the currently-shipped weights,
computing edge_z per row against proxy PP lines, and bucketing actual
outcomes by tier.

The backtest CSV doesn't have historical PP lines (PrizePicks doesn't
publish past-game lines), so we use several proxies:
  - flat lines at 5.5 / 6.5 / 7.5 / 8.5 (typical PP hitter range)
  - relative line = 70% of calibrated projected (approximates PP
    setting lines below median expected with a vig)

Hit = actual_efp > line. Reported as the fraction of projections at
each tier that actually cleared the line.

Usage:
    python scripts/validate_edge_z_tiers.py backend/app/data/backtest_20250915.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.services.fantasy import load_weights, load_league_rates  # noqa: E402
from app.services.player_stats import get_player_stats  # noqa: E402
from app.data.park_factors import get_hr_hand_adj  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("validate")


def _estimate_season_pa(game_date: str) -> int:
    """Estimate a full-time starter's season PA count as of game_date.
    Regular MLB season starts roughly 3/28 (day 0). Assume ~3.6 PAs/day
    averaged over all calendar days (accounts for off-days, rest days,
    typical lineup depth). Used only when CSV lacks a persisted
    season_pa column — for better precision, add that column to the
    backtest writer."""
    if not game_date:
        return 300  # mid-season default — keep shrinkage modest
    try:
        from datetime import date
        y = int(game_date[:4])
        opening = date(y, 3, 28)
        target = date(int(game_date[:4]), int(game_date[5:7]), int(game_date[8:10]))
        days = max(0, (target - opening).days)
        est = int(days * 3.6)
        # Clamp: minimum 10 (below which shrinkage floor dominates),
        # max 700 (late-season full-time starter).
        return max(10, min(700, est))
    except Exception:
        return 300


def reproject_row(r: dict, w: dict, lg: dict) -> float:
    """Recompute projected EFP for a row under current weights. Mirrors
    eval_weights in backtest_fantasy.py but standalone. Applies Bayesian
    small-sample shrinkage (matching fantasy.py) when the weights have
    `rate_regression_prior_pa` > 0."""
    PP = {"single": 3.0, "double": 5.0, "triple": 8.0, "home_run": 10.0,
          "walk": 2.0, "run": 2.0, "rbi": 2.0, "sb": 5.0}

    def f(k, d=0.0):
        v = r.get(k, "")
        if v in ("", None):
            return d
        try:
            return float(v)
        except (TypeError, ValueError):
            return d

    def i(k, d=0):
        v = r.get(k, "")
        if v in ("", None):
            return d
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return d

    pa = i("pa", 0)
    park_hr = f("park_hr", 100) / 100.0
    park_runs = f("park_runs", 100) / 100.0

    # Bayesian small-sample shrinkage toward league means. Pulled from
    # fantasy.py; requires an estimate of season-to-date PA for the row.
    prior_pa = float(w.get("rate_regression_prior_pa", 0.0))
    season_pa_est = _estimate_season_pa(r.get("date", ""))
    lg_per_pa = (lg or {}).get("per_pa") or {}
    def shrink(observed: float, key_lg: str, lg_default: float) -> float:
        league_rate = float(lg_per_pa.get(key_lg, lg_default))
        if prior_pa <= 0 or season_pa_est <= 0:
            return observed
        return (season_pa_est * observed + prior_pa * league_rate) / (season_pa_est + prior_pa)
    def shrink_scalar(observed: float, league_rate: float) -> float:
        if prior_pa <= 0 or season_pa_est <= 0:
            return observed
        return (season_pa_est * observed + prior_pa * league_rate) / (season_pa_est + prior_pa)

    # Pitcher quality (H/BF, HR/BF with tunable exponents, capped + shrunk)
    lg_h_bf = float((lg.get("pitcher_per_bf") or {}).get("hits_allowed", 0.222))
    lg_hr_bf = float((lg.get("pitcher_per_bf") or {}).get("home_runs_allowed", 0.029))
    p_h = f("pitcher_h_per_bf")
    p_hr = f("pitcher_hr_per_bf")
    p_bf = i("pitcher_bf")
    hits_mult = 1.0
    hr_mult = 1.0
    if p_h > 0 and p_hr > 0 and p_bf > 0:
        h_exp = float(w.get("pitcher_hits_exp", 0.6))
        hr_exp = float(w.get("pitcher_hr_exp", 0.35))
        raw_h = (p_h / lg_h_bf) ** h_exp if h_exp > 0 else 1.0
        raw_hr = (p_hr / lg_hr_bf) ** hr_exp if hr_exp > 0 else 1.0
        trust = min(1.0, p_bf / 60)
        hits_mult = max(0.70, min(1.30, 1.0 + trust * (raw_h - 1.0)))
        hr_mult = max(0.65, min(1.35, 1.0 + trust * (raw_hr - 1.0)))

    # Pitcher GB HR suppression
    lg_stx = (lg.get("statcast") or {})
    lg_gb = float(lg_stx.get("pitcher_gb_pct", 0.430))
    p_gb = f("pitcher_gb_pct")
    p_stx_bf = i("pitcher_stx_bf")
    gb_hr_exp = float(w.get("pitcher_gb_hr_exp", 0.0))
    gb_hr_mult = 1.0
    if gb_hr_exp > 0 and p_gb > 0 and p_stx_bf > 0:
        raw = (lg_gb / p_gb) ** gb_hr_exp
        trust = min(1.0, p_stx_bf / 80)
        gb_hr_mult = max(0.75, min(1.25, 1.0 + trust * (raw - 1.0)))

    # Pitcher BB boost on batter walks
    lg_p_bb = float((lg.get("pitcher_per_bf") or {}).get("walks_allowed", 0.085))
    p_bb = f("pitcher_bb_pct_stx")
    p_bb_exp = float(w.get("pitcher_bb_exp", 0.0))
    pitcher_bb_mult = 1.0
    if p_bb_exp > 0 and p_bb > 0 and p_stx_bf > 0:
        raw = (p_bb / lg_p_bb) ** p_bb_exp
        trust = min(1.0, p_stx_bf / 80)
        pitcher_bb_mult = max(0.75, min(1.25, 1.0 + trust * (raw - 1.0)))

    # K damper
    lg_bk = float(lg_stx.get("batter_k_pct", 0.225))
    lg_pk = float(lg_stx.get("pitcher_k_pct", 0.225))
    b_k = f("batter_k_pct")
    p_k = f("pitcher_k_pct_stx")
    b_stx_pa = i("batter_stx_pa")
    b_k_exp = float(w.get("batter_k_exp", 0.0))
    p_k_exp = float(w.get("pitcher_k_exp", 0.0))
    k_damper = 1.0
    if (b_k_exp > 0 or p_k_exp > 0) and (b_k > 0 or p_k > 0):
        br = (b_k / lg_bk) if b_k > 0 else 1.0
        pr = (p_k / lg_pk) if p_k > 0 else 1.0
        b_trust = min(1.0, b_stx_pa / 100) if b_k > 0 else 0.0
        p_trust = min(1.0, p_stx_bf / 80) if p_k > 0 else 0.0
        dev = (br * pr) - 1.0
        eff = (b_k_exp * b_trust) + (p_k_exp * p_trust)
        k_damper = max(0.85, min(1.15, 1.0 - eff * dev * 0.15))

    # Lineup context
    lg_xwoba = float(lg_stx.get("batter_xwoba", 0.318))
    lg_obp = float(lg.get("obp", 0.314))
    ondeck = f("ondeck_xwoba")
    preceding = f("preceding_obp")
    ondeck_r_exp = float(w.get("ondeck_r_exp", 0.0))
    preceding_rbi_exp = float(w.get("preceding_rbi_exp", 0.0))
    ondeck_r_mult = 1.0
    preceding_rbi_mult = 1.0
    if ondeck_r_exp > 0 and ondeck > 0:
        raw = (ondeck / lg_xwoba) ** ondeck_r_exp
        ondeck_r_mult = max(0.85, min(1.15, raw))
    if preceding_rbi_exp > 0 and preceding > 0:
        raw = (preceding / lg_obp) ** preceding_rbi_exp
        preceding_rbi_mult = max(0.85, min(1.15, raw))

    # Park hand
    park_hand_scale = float(w.get("park_hand_scale", 0.0))
    park_hand_mult = 1.0
    if park_hand_scale > 0:
        raw_adj = get_hr_hand_adj(i("venue_id"), (r.get("bat_side") or "").strip() or None)
        park_hand_mult = 1.0 + park_hand_scale * (raw_adj - 1.0)

    # Final rates — apply shrinkage (matches fantasy.py production math)
    singles = shrink(f("rates_season_singles"), "singles", 0.144)
    hr = shrink(f("rates_season_hr"), "home_runs", 0.033)
    bb_hbp = shrink(f("rates_season_bb_hbp"), "bb_hbp", 0.096)
    obp = shrink_scalar(f("rates_season_obp"), float(lg.get("obp", 0.314)))
    slg = shrink_scalar(f("rates_season_slg"), float(lg.get("slg", 0.399)))
    sb_per_g = f("rates_season_sb_per_g")  # SB is per-game not per-PA; no shrinkage

    r_per_pa = obp * float(w.get("r_per_pa_coef", 0.9)) * ondeck_r_mult * k_damper
    rbi_per_pa = slg * float(w.get("rbi_per_pa_coef", 0.36)) * preceding_rbi_mult * k_damper
    s_rate = singles * park_runs * hits_mult * k_damper
    hr_rate = hr * park_hr * hr_mult * gb_hr_mult * k_damper * park_hand_mult
    bb_rate = bb_hbp * pitcher_bb_mult * k_damper

    efp = pa * (
        PP["single"] * s_rate
        + PP["home_run"] * hr_rate
        + PP["walk"] * bb_rate
        + PP["run"] * r_per_pa
        + PP["rbi"] * rbi_per_pa
    ) + PP["sb"] * sb_per_g

    cal = float(w.get("calibration_scale", 1.0))
    if cal > 0 and cal != 1.0:
        efp *= cal
    return efp


def main(csv_path: Path) -> None:
    w = load_weights()
    lg = load_league_rates()
    season = int(csv_path.stem.split("_")[-1][:4])

    # Read rows and re-project under current weights.
    rows: list[dict] = []
    with csv_path.open() as f:
        for r in csv.DictReader(f):
            try:
                actual = float(r["actual_efp"])
                pid = int(r["player_id"])
            except (TypeError, ValueError, KeyError):
                continue
            projected = reproject_row(r, w, lg)
            stats = get_player_stats(pid, season)
            rows.append({
                "projected": projected,
                "actual": actual,
                "stdev": stats["stdev"],
            })
    logger.info(f"Re-projected {len(rows)} rows under current weights")

    # Quick sanity check: overall projected vs actual
    proj_avg = sum(r["projected"] for r in rows) / len(rows)
    act_avg = sum(r["actual"] for r in rows) / len(rows)
    logger.info(f"Overall projected avg: {proj_avg:.2f}  actual avg: {act_avg:.2f}")

    # Build tier buckets for several line proxies.
    def bucket_z(z: float) -> str:
        if z is None:
            return "no_line"
        if z < 0:
            return "FADE"
        if z < 0.3:
            return "LOW"
        if z < 0.8:
            return "MED"
        return "HIGH"

    def eval_line(line_fn, label: str):
        buckets: dict[str, dict] = defaultdict(lambda: {"n": 0, "hits": 0})
        for r in rows:
            proj = r["projected"]
            sd = r["stdev"]
            line = line_fn(r)
            if line is None or sd <= 0:
                continue
            z = (proj - line) / sd
            tier = bucket_z(z)
            buckets[tier]["n"] += 1
            if r["actual"] > line:
                buckets[tier]["hits"] += 1

        logger.info(f"\n— {label} —")
        logger.info(f"{'Tier':<6} {'n':>6} {'hit_rate':>10}")
        for tier in ("HIGH", "MED", "LOW", "FADE"):
            b = buckets.get(tier) or {"n": 0, "hits": 0}
            if b["n"] > 0:
                rate = b["hits"] / b["n"] * 100
                logger.info(f"{tier:<6} {b['n']:>6} {rate:>9.1f}%")

    # Flat PP-line proxies
    for line in (5.5, 6.5, 7.5, 8.5):
        eval_line(lambda r, _L=line: _L, f"flat PP line = {line}")

    # Relative proxy: line = 70% of projected (ROUGH approximation of
    # how PrizePicks sets lines below median projection with vig)
    eval_line(
        lambda r: r["projected"] * 0.70,
        "relative line = 70% of projected",
    )

    # Calibration sanity: with 0.876 baked in, projected avg should be
    # much closer to actual avg than it was pre-calibration
    logger.info(
        f"\nCalibration check: projected avg {proj_avg:.2f} vs actual avg {act_avg:.2f} "
        f"(ratio {act_avg/proj_avg:.3f} — 1.0 = perfectly calibrated)"
    )


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("csv", type=Path)
    args = ap.parse_args()
    main(args.csv)
