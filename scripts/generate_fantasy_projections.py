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

from app.services import fantasy, mlb_api, parlays as parlay_service, prizepicks  # noqa: E402


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
    hit rates per tier/stat/line.

    Now also captures demon/goblin variants (via fetch_all_variants)
    alongside the standard line. Demon/goblin fields unlock analysis
    of PP's promo-line structure for the reboot-strategy work."""
    captured_at = datetime.now(timezone.utc).isoformat()
    game_date = payload.get("date")
    if not game_date:
        return

    # Fetch all-variants snapshot once per call. Cached for 10min so if
    # generate runs multiple times within an hour we don't re-hit PP.
    #
    # Note: project_slate already runs inside an asyncio loop, so calling
    # asyncio.run() directly here fails with "asyncio.run() cannot be
    # called from a running event loop". Run in a dedicated thread with
    # its own loop to avoid the conflict.
    try:
        import concurrent.futures
        def _runner():
            return asyncio.run(prizepicks.fetch_all_variants())
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            all_variants = ex.submit(_runner).result(timeout=60)
    except Exception as e:
        logger.warning("fetch_all_variants failed (%s) — logging standard only", e)
        all_variants = {}

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
            # Cross-reference to variant record by normalized player name.
            # prizepicks._normalize_name is the same function used to key
            # fetch_all_variants output.
            norm_name = prizepicks._normalize_name(proj.get("name") or "")
            variants_bucket = all_variants.get(norm_name) or {}
            # Only the stat-key entries (not the _name/_team meta keys).
            pp_lines_all = {
                k: v for k, v in variants_bucket.items()
                if k not in ("_name", "_team") and isinstance(v, list)
            }
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
                # All variants (standard + demon + goblin) per stat —
                # enables reboot-strategy analysis and Demon-line studies.
                "pp_lines_all": pp_lines_all,
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


TOP_LOCK_COUNT = 10


def _maybe_write_daily_lock(payload: dict) -> None:
    """Write frontend/public/data/fantasy/todays_picks_lock.json with the
    top-N confidence picks for today. Only overwrites when the date
    changes (i.e. once per day, on the first cron run that sees
    confidence badges). The frontend renders this as a locked "Today's
    Picks Tracker" that persists through games and stays visible when
    Final."""
    game_date = payload.get("date")
    if not game_date:
        return

    # Reuse the quality-filtered best_bets list from the payload. This
    # guarantees the Tracker and the "Current Best Bets" section use
    # IDENTICAL selection criteria (PP line floor, min logged games,
    # positive edge, sorted by edge_z). No duplicated filter logic.
    best_bets = payload.get("best_bets") or []
    if not best_bets:
        logger.info("daily_picks_lock: no quality best_bets yet — no lock written")
        return

    top_picks = best_bets[:TOP_LOCK_COUNT]

    lock_path = OUT_DIR / "todays_picks_lock.json"
    # Preserve the existing lock if it's for the same date.
    if lock_path.exists():
        try:
            prior = json.loads(lock_path.read_text())
            if prior.get("game_date") == game_date:
                logger.info("daily_picks_lock: already locked for %s — preserving",
                            game_date)
                return
        except Exception:
            pass  # malformed → we'll overwrite it

    # Strip fields the tracker UI doesn't need (multipliers, rates, etc.)
    # Keep just what renders in the tracker card.
    def trim(p: dict) -> dict:
        return {
            "player_id": p.get("player_id"),
            "name": p.get("name"),
            "position": p.get("position"),
            "bat_side": p.get("bat_side"),
            "team_id": p.get("team_id"),
            "team_abbr": p.get("team_abbr"),
            "opp_abbr": p.get("opp_abbr"),
            "opp_pitcher": p.get("opp_pitcher"),
            "pa": p.get("pa"),
            "pa_source": p.get("pa_source"),
            "efp": p.get("efp"),
            "tier": p.get("tier"),
            "stdev_efp": p.get("stdev_efp"),
            "mean_efp": p.get("mean_efp"),
            "stats_games": p.get("stats_games"),
            "prizepicks": p.get("prizepicks"),
            "edge_fantasy": p.get("edge_fantasy"),
            "edge_z": p.get("edge_z"),
        }

    trimmed_picks = [trim(p) for p in top_picks]
    lock = {
        "game_date": game_date,
        "locked_at": payload.get("generated_at") or datetime.now(timezone.utc).isoformat(),
        "weights_version": payload.get("weights_version"),
        "count": len(top_picks),
        "picks": trimmed_picks,
    }
    lock_path.write_text(json.dumps(lock, indent=2) + "\n")
    logger.info("daily_picks_lock: wrote %d locked picks → %s", len(top_picks), lock_path.name)

    # Generate the 4 parlay ideas off the SAME locked set so the Edge
    # page's "Parlay Ideas" button has something to show for the day.
    # Runs inside the lock branch so it only fires when we actually
    # wrote a new lock — same cadence as the picks themselves.
    _write_parlays(game_date, trimmed_picks, payload)


def _write_parlays(game_date: str, picks: list[dict], payload: dict) -> None:
    """Compute EV-optimized parlays from today's locked picks and write
    frontend/public/data/fantasy/todays_parlays.json. Pure math (no LLM,
    no extra API calls) — see backend/app/services/parlays.py.

    Silent on failure: parlays are a nice-to-have; if math blows up we
    don't want to fail the whole projections run. The UI falls back to
    'no parlay ideas yet' on an empty/missing file.
    """
    try:
        ideas = parlay_service.build_parlays(picks)
    except Exception as e:
        logger.warning("parlays: build failed (%s) — skipping", e)
        return

    parlay_path = OUT_DIR / "todays_parlays.json"
    out = {
        "game_date": game_date,
        "generated_at": payload.get("generated_at") or datetime.now(timezone.utc).isoformat(),
        "weights_version": payload.get("weights_version"),
        "source_pick_count": len(picks),
        "parlays": ideas,
    }
    parlay_path.write_text(json.dumps(out, indent=2) + "\n")
    logger.info("parlays: wrote %d parlay ideas → %s", len(ideas), parlay_path.name)


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

    # Resilience guard: if PrizePicks returned an empty feed this run
    # (network flake, block, maintenance window, Cloudflare reject) but
    # the existing JSON on disk has PP matches for the same date,
    # preserve the existing file rather than overwriting with a
    # line-less version. This prevents the live site from going "empty
    # best bets" when PP just happens to be down at cron time.
    def _pp_match_count(doc: dict) -> int:
        return sum(
            1 for p in (doc.get("projections") or [])
            if p.get("prizepicks")
        )
    new_pp_count = _pp_match_count(site_payload)
    if new_pp_count == 0 and out_path.exists():
        try:
            prior = json.loads(out_path.read_text())
            prior_pp_count = _pp_match_count(prior)
            if prior.get("date") == site_payload.get("date") and prior_pp_count > 0:
                logger.warning(
                    "projections_today: new run has 0 PP matches but existing "
                    "file has %d — preserving existing file (PP likely down).",
                    prior_pp_count,
                )
                await mlb_api.close_client()
                return
        except Exception:
            pass  # malformed existing → overwrite is fine

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

    # Lock today's confidence picks once we have any. This freezes the
    # picks the user saw this morning so the UI can show their live
    # in-game + final scores all day, even if subsequent crons shuffle
    # the order. Only writes if:
    #   1. We have ≥1 pick with a confidence badge (edge_z populated), AND
    #   2. The existing lock file is for a different date (previous day).
    try:
        _maybe_write_daily_lock(payload)
    except Exception as e:
        logger.warning("daily_picks_lock: write failed (%s) — continuing", e)

    await mlb_api.close_client()


def main():
    p = argparse.ArgumentParser(description="Generate today's fantasy projections JSON.")
    p.add_argument("--date", default=None, help="Target date YYYY-MM-DD (default today).")
    args = p.parse_args()
    asyncio.run(generate(args.date))


if __name__ == "__main__":
    main()
