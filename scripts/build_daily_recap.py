#!/usr/bin/env python3
"""
Build a public-facing daily recap summarizing how yesterday's picks did
against their PrizePicks fantasy-score lines.

Reads:
  - backend/app/data/pp_line_log/<date>_resolved.jsonl
    (created by resolve_pp_lines.py)

Writes:
  - frontend/public/data/fantasy/yesterday_recap.json
    { recap_date, generated_at,
      totals: { high_conf: {n, wins, hit_rate},
                med_conf: {...}, low_conf: {...}, fade: {...},
                overall: {n, wins, hit_rate} },
      top_hit:   {name, team, line, actual, edge_z, tier},
      biggest_miss: {name, team, line, actual, edge_z, tier},
      sample_picks: [up to 10 rows with per-pick result]
    }

Usage:
  python scripts/build_daily_recap.py 2026-04-18
  python scripts/build_daily_recap.py   # defaults to yesterday

Also builds a season rollup across all resolved days:
  - frontend/public/data/fantasy/season_recap.json
    Running record per confidence tier since the first resolved day.
"""

from __future__ import annotations

import argparse
import json
import logging
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = ROOT / "backend" / "app" / "data" / "pp_line_log"
OUT_DIR = ROOT / "frontend" / "public" / "data" / "fantasy"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger("recap")


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


def _read_resolved(path: Path) -> list[dict]:
    out: list[dict] = []
    with path.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def _summarize_day(records: list[dict], game_date: str) -> dict:
    """Bucket resolved records by confidence tier, grade each against the
    fantasy-score line, return totals + standout picks."""
    buckets: dict[str, dict] = defaultdict(lambda: {"n": 0, "wins": 0, "picks": []})
    overall = {"n": 0, "wins": 0}
    # For standout picks we need rows that HAVE a fantasy result graded.
    graded: list[dict] = []

    for r in records:
        if not r.get("played"):
            continue
        results = r.get("results") or {}
        fan_result = results.get("fantasy")
        if not fan_result:
            continue  # no fantasy line was offered or resolution missing
        tier = _tier(r.get("edge_z"))
        if tier is None:
            continue  # no edge_z — not surfaced as a confidence pick
        # We score "wins" as: OVER bet won for positive-tier picks, UNDER
        # bet won for FADE picks. So the model's actual directional call hit.
        grade = fan_result.get("grade")
        if tier == "FADE":
            won = (grade == "under")
        else:
            won = (grade == "over")
        buckets[tier]["n"] += 1
        if won:
            buckets[tier]["wins"] += 1
        buckets[tier]["picks"].append({
            "name": r.get("name"),
            "team": r.get("team_abbr"),
            "opp": r.get("opp_abbr"),
            "projected": r.get("projected_efp"),
            "line": fan_result.get("line"),
            "actual": fan_result.get("actual"),
            "edge_z": r.get("edge_z"),
            "tier": tier,
            "won": won,
            "grade": grade,
        })
        overall["n"] += 1
        if won:
            overall["wins"] += 1
        graded.append({**buckets[tier]["picks"][-1]})

    def _rate(b):
        return round(b["wins"] / b["n"], 3) if b["n"] else None

    # Standout picks from the "we bet OVER" universe (HIGH + MED + LOW):
    # biggest win = highest actual_efp among hits
    # biggest miss = biggest actual-vs-line shortfall among losses (negative)
    over_bets = [p for p in graded if p["tier"] in ("HIGH", "MED", "LOW")]
    hits = [p for p in over_bets if p["won"]]
    misses = [p for p in over_bets if not p["won"]]
    top_hit = max(hits, key=lambda p: (p["actual"] or 0)) if hits else None
    biggest_miss = (
        min(misses, key=lambda p: ((p["actual"] or 0) - (p["line"] or 0)))
        if misses else None
    )

    # Sort sample picks best-to-worst for the UI summary
    sample = sorted(over_bets, key=lambda p: (p["edge_z"] or 0), reverse=True)[:10]

    return {
        "recap_date": game_date,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "totals": {
            "high_conf": {
                "n": buckets["HIGH"]["n"],
                "wins": buckets["HIGH"]["wins"],
                "hit_rate": _rate(buckets["HIGH"]),
            },
            "med_conf": {
                "n": buckets["MED"]["n"],
                "wins": buckets["MED"]["wins"],
                "hit_rate": _rate(buckets["MED"]),
            },
            "low_conf": {
                "n": buckets["LOW"]["n"],
                "wins": buckets["LOW"]["wins"],
                "hit_rate": _rate(buckets["LOW"]),
            },
            "fade": {
                "n": buckets["FADE"]["n"],
                "wins": buckets["FADE"]["wins"],
                "hit_rate": _rate(buckets["FADE"]),
            },
            "overall": {
                "n": overall["n"],
                "wins": overall["wins"],
                "hit_rate": _rate(overall),
            },
        },
        "top_hit": top_hit,
        "biggest_miss": biggest_miss,
        "sample_picks": sample,
    }


def _build_season_rollup() -> dict:
    """Running record across every resolved day, grouped by tier."""
    totals: dict[str, dict] = defaultdict(lambda: {"n": 0, "wins": 0})
    days: list[dict] = []
    season_start: str | None = None
    season_end: str | None = None

    for path in sorted(LOG_DIR.glob("*_resolved.jsonl")):
        dt = path.stem.replace("_resolved", "")
        if season_start is None:
            season_start = dt
        season_end = dt
        records = _read_resolved(path)
        day_summary = _summarize_day(records, dt)
        day_totals = day_summary["totals"]
        days.append({
            "date": dt,
            "overall": day_totals["overall"],
            "high_conf": day_totals["high_conf"],
            "med_conf": day_totals["med_conf"],
        })
        for key in ("high_conf", "med_conf", "low_conf", "fade", "overall"):
            t = day_totals.get(key) or {}
            totals[key]["n"] += int(t.get("n") or 0)
            totals[key]["wins"] += int(t.get("wins") or 0)

    def _rate(b):
        return round(b["wins"] / b["n"], 3) if b["n"] else None

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "days_resolved": len(days),
        "first_date": season_start,
        "last_date": season_end,
        "totals": {
            key: {"n": v["n"], "wins": v["wins"], "hit_rate": _rate(v)}
            for key, v in totals.items()
        },
        "days": days,
    }


def main(target: str | None) -> None:
    if target is None:
        target = (date.today() - timedelta(days=1)).isoformat()

    resolved_path = LOG_DIR / f"{target}_resolved.jsonl"
    if not resolved_path.exists():
        logger.warning("No resolved log for %s — did resolve_pp_lines.py run?", target)
        return

    records = _read_resolved(resolved_path)
    if not records:
        logger.warning("Resolved log for %s is empty.", target)
        return

    # Daily recap
    day_summary = _summarize_day(records, target)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "yesterday_recap.json"
    out_path.write_text(json.dumps(day_summary, indent=2) + "\n")
    totals = day_summary["totals"]
    overall = totals.get("overall") or {}
    logger.info(
        "yesterday_recap: %s → %d total picks, %d wins (%.1f%%). HIGH %d/%d, MED %d/%d",
        target, overall.get("n") or 0, overall.get("wins") or 0,
        (overall.get("hit_rate") or 0) * 100,
        totals["high_conf"]["wins"], totals["high_conf"]["n"],
        totals["med_conf"]["wins"], totals["med_conf"]["n"],
    )

    # Season rollup
    season = _build_season_rollup()
    season_path = OUT_DIR / "season_recap.json"
    season_path.write_text(json.dumps(season, indent=2) + "\n")
    logger.info(
        "season_recap: %d days resolved, overall %s wins / %s picks (%.1f%%)",
        season["days_resolved"],
        season["totals"]["overall"]["wins"],
        season["totals"]["overall"]["n"],
        (season["totals"]["overall"]["hit_rate"] or 0) * 100,
    )


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("date", nargs="?", default=None,
                    help="YYYY-MM-DD to recap (defaults to yesterday)")
    args = ap.parse_args()
    main(args.date)
