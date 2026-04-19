#!/usr/bin/env python3
"""
Generate today's Hitter Fantasy Score projections as a static JSON file
the frontend can read directly — no backend needed at runtime.

Intended to be called by the daily GH Actions `refresh-data.yml`
workflow right after `generate_data.py`. Writes to
  frontend/public/data/fantasy/projections_today.json
so the frontend `fetchFantasyProjections()` can load it via the same
static-fetch pattern as every other page of the app.

Reuses the same `app.services.fantasy.project_slate` function that the
(local-dev-only) FastAPI endpoint serves — single source of truth for
the projection math.

Usage:
    python scripts/generate_fantasy_projections.py [--date YYYY-MM-DD]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from datetime import date as date_cls
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.services import fantasy, mlb_api  # noqa: E402


OUT_DIR = ROOT / "frontend" / "public" / "data" / "fantasy"
LOG_DIR = ROOT / "backend" / "app" / "data" / "pp_line_log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("generate_fantasy")


def _confidence_tier_from_z(z: float | None) -> str | None:
    """Match the frontend's tier mapping exactly."""
    if z is None:
        return None
    if z < 0:
        return "FADE"
    if z < 0.3:
        return "LOW"
    if z < 0.8:
        return "MED"
    return "HIGH"


def _append_pp_line_log(payload: dict) -> None:
    """Append one JSONL record per projection with PP line to the day's
    log file. Captures raw PP lines + our model state at this moment so
    we can later join against actual game outcomes and compute real
    hit rates per tier/stat/line. Called once per snapshot (site regen
    runs 2x/day; each call adds a new dated row per player)."""
    captured_at = datetime.now(timezone.utc).isoformat()
    game_date = payload.get("date")
    if not game_date:
        return

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / f"{game_date}.jsonl"

    written = 0
    # Prefer the full untrimmed slate when present — the logger wants
    # EVERY player with a PP line, not just the site's top-30 display.
    slate = payload.get("_all_projections") or payload.get("projections") or []
    with log_path.open("a") as f:
        for proj in slate:
            pp = proj.get("prizepicks") or {}
            # Skip rows with no PP lines — nothing to log against.
            if not pp or all(v is None for v in pp.values()):
                continue
            record = {
                "captured_at": captured_at,
                "game_date": game_date,
                "weights_version": payload.get("weights_version"),
                "player_id": proj.get("player_id"),
                "name": proj.get("name"),
                "team_abbr": proj.get("team_abbr"),
                "opp_abbr": proj.get("opp_abbr"),
                "opp_pitcher": (proj.get("opp_pitcher") or {}).get("fullName"),
                "projected_efp": proj.get("efp"),
                "tier": proj.get("tier"),
                "pa": proj.get("pa"),
                "pa_source": proj.get("pa_source"),
                "bat_side": proj.get("bat_side"),
                "stdev_efp": proj.get("stdev_efp"),
                "mean_efp": proj.get("mean_efp"),
                "stats_games": proj.get("stats_games"),
                "edge_fantasy": proj.get("edge_fantasy"),
                "edge_z": proj.get("edge_z"),
                "confidence_tier": _confidence_tier_from_z(proj.get("edge_z")),
                # Raw PP lines for all stats — even if we don't bet them
                # today, having the historical time series lets us back-
                # test calibration per-stat later.
                "pp_lines": {k: v for k, v in pp.items() if v is not None},
                # Model internals snapshotted so we can retroactively
                # verify what the model said this day (handy if we fit
                # new weights and want to know "what would V1.5 have
                # projected for Judge on 2026-04-18").
                "multipliers": proj.get("multipliers"),
                "rates": proj.get("rates"),
            }
            f.write(json.dumps(record) + "\n")
            written += 1

    logger.info("pp_line_log: appended %d records → %s", written, log_path.name)


async def generate(date_iso: str | None) -> None:
    target = date_iso or date_cls.today().isoformat()
    logger.info("Building projections for %s", target)

    payload = await fantasy.project_slate(date_iso=target)

    payload["generated_at"] = datetime.now(timezone.utc).isoformat()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "projections_today.json"
    # Strip the untrimmed slate before writing the site JSON (it's only
    # for the logger downstream; shipping 400 rows to every browser
    # would bloat the payload for zero UI benefit).
    site_payload = {k: v for k, v in payload.items() if k != "_all_projections"}
    out_path.write_text(json.dumps(site_payload, indent=2) + "\n")

    logger.info(
        "Wrote %s — %d candidates scored, top %d saved (calibrated=%s, R²=%s)",
        out_path,
        payload.get("projection_count", 0),
        len(payload.get("projections", [])),
        payload.get("calibrated"),
        (payload.get("metrics") or {}).get("r2"),
    )

    # Append a snapshot row per projection (with PP lines) to the dated
    # JSONL log. This builds the real-money calibration dataset over time
    # — every snapshot at 6 AM / 3 PM ET across the season gets logged.
    try:
        _append_pp_line_log(payload)
    except Exception as e:
        logger.warning("pp_line_log: append failed (%s) — continuing", e)

    await mlb_api.close_client()


def main():
    p = argparse.ArgumentParser(description="Generate today's fantasy projections JSON.")
    p.add_argument("--date", default=None, help="Target date YYYY-MM-DD (default today).")
    args = p.parse_args()
    asyncio.run(generate(args.date))


if __name__ == "__main__":
    main()
