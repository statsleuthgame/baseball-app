#!/usr/bin/env python3
"""
Join actual game outcomes to a day's PP-line log file.

For each record in `backend/app/data/pp_line_log/YYYY-MM-DD.jsonl`:
  1. Look up the player's actual hitting line from today's MLB boxscores
  2. Compute per-stat actual values (hits, HR, walks, total bases, etc.)
  3. For every PP line present in the record, compute over/under result
  4. Write enriched record to `YYYY-MM-DD_resolved.jsonl`

Run after all games for the date are final. Safe to re-run — output is
overwritten idempotently.

Usage:
    python scripts/resolve_pp_lines.py 2026-04-18
    python scripts/resolve_pp_lines.py  # defaults to yesterday (local tz)

Intended to run as a nightly GH Actions job at ~3 AM UTC so all late
West-coast games are final before resolution.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.services.actual_efp import (  # noqa: E402
    extract_batter_lines,
    fetch_boxscore,
    score_from_stat,
)

LOG_DIR = ROOT / "backend" / "app" / "data" / "pp_line_log"
MLB_API_BASE = "https://statsapi.mlb.com/api/v1"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger("resolve_pp")


# ---------------------------------------------------------------------------
# Per-stat actuals — mirror the PrizePicks stat categories we track
# ---------------------------------------------------------------------------


def _stat_actuals(stat: dict) -> dict:
    """Compute every stat we might have a PP line against, from a
    batter's raw MLB boxscore stat row."""
    def i(k: str) -> int:
        v = stat.get(k)
        if v is None or v == "":
            return 0
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0

    hits = i("hits")
    doubles = i("doubles")
    triples = i("triples")
    hr = i("homeRuns")
    singles = max(0, hits - doubles - triples - hr)
    total_bases = singles + 2 * doubles + 3 * triples + 4 * hr
    runs = i("runs")
    rbi = i("rbi")
    bb = i("baseOnBalls")
    hbp = i("hitByPitch")
    sb = i("stolenBases")
    ks = i("strikeOuts")
    return {
        "fantasy": round(score_from_stat(stat), 2),
        "hits": hits,
        "singles": singles,
        "doubles": doubles,
        "triples": triples,
        "home_runs": hr,
        "runs": runs,
        "rbis": rbi,
        "walks": bb,
        "hbp": hbp,
        "stolen_bases": sb,
        "strikeouts": ks,
        "total_bases": total_bases,
        "hrr": hits + runs + rbi,  # PrizePicks "Hits + Runs + RBIs" stat
    }


def _grade(line: float | None, actual: float | None) -> str | None:
    """Return 'over' / 'under' / 'push' / None."""
    if line is None or actual is None:
        return None
    if actual > line:
        return "over"
    if actual < line:
        return "under"
    return "push"


# ---------------------------------------------------------------------------
# Schedule fetch
# ---------------------------------------------------------------------------


async def fetch_games_on_date(client: httpx.AsyncClient, iso: str) -> list[dict]:
    resp = await client.get(
        "/schedule",
        params={"sportId": 1, "date": iso, "gameType": "R"},
    )
    resp.raise_for_status()
    out: list[dict] = []
    for d in resp.json().get("dates", []):
        for g in d.get("games", []):
            out.append(g)
    return out


# ---------------------------------------------------------------------------
# Resolver
# ---------------------------------------------------------------------------


async def resolve(game_date: str) -> None:
    raw_path = LOG_DIR / f"{game_date}.jsonl"
    out_path = LOG_DIR / f"{game_date}_resolved.jsonl"

    if not raw_path.exists():
        logger.warning("No log file for %s; nothing to resolve.", game_date)
        return

    # Read raw log. Multiple snapshots per player are possible (6 AM + 3 PM
    # captures) — dedupe by keeping the LATEST snapshot per (game_date,
    # player_id) so resolved rows reflect what the user saw closest to
    # first pitch.
    latest_by_pid: dict[int, dict] = {}
    total_raw = 0
    with raw_path.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            total_raw += 1
            pid = rec.get("player_id")
            if not pid:
                continue
            prev = latest_by_pid.get(pid)
            if prev is None or rec.get("captured_at", "") > prev.get("captured_at", ""):
                latest_by_pid[pid] = rec
    logger.info("Read %d raw records → %d unique players (deduped by latest snapshot)",
                total_raw, len(latest_by_pid))

    if not latest_by_pid:
        logger.info("Nothing to resolve for %s", game_date)
        return

    # Fetch all boxscores for the date in parallel.
    async with httpx.AsyncClient(base_url=MLB_API_BASE, timeout=30) as client:
        games = await fetch_games_on_date(client, game_date)
        finals = [
            g for g in games
            if (g.get("status") or {}).get("detailedState") in ("Final", "Game Over")
        ]
        if not finals:
            logger.warning("No finalized games on %s; skipping resolution. (Re-run later.)",
                           game_date)
            return
        logger.info("Fetching %d boxscores", len(finals))
        tasks = [fetch_boxscore(client, g["gamePk"]) for g in finals]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    # Build player_id → actual-stat map.
    actuals_by_pid: dict[int, dict] = {}
    for res in results:
        if isinstance(res, Exception):
            continue
        for row in extract_batter_lines(res):
            pid = row.get("player_id")
            if not pid:
                continue
            actuals_by_pid[pid] = _stat_actuals(row.get("stat") or {})
    logger.info("Resolved stats for %d players", len(actuals_by_pid))

    # Write resolved rows. Records with no matching boxscore (scratched,
    # call-ups with no PA) get actuals=None but are kept in the file so
    # we can distinguish "DNP" from "no log".
    resolved_count = 0
    with out_path.open("w") as f:
        for pid, rec in latest_by_pid.items():
            actuals = actuals_by_pid.get(pid)
            rec_out = dict(rec)
            rec_out["resolved_at"] = datetime.now(timezone.utc).isoformat()
            rec_out["actuals"] = actuals
            # Grade every PP line we had against the actual outcome.
            results_map: dict[str, dict] = {}
            pp_lines = rec.get("pp_lines") or {}
            if actuals:
                for stat, line in pp_lines.items():
                    actual_val = actuals.get(stat)
                    grade = _grade(line, actual_val)
                    if grade is not None:
                        results_map[stat] = {
                            "line": line,
                            "actual": actual_val,
                            "grade": grade,
                            "diff": round((actual_val - line), 3)
                                if actual_val is not None else None,
                        }
            rec_out["results"] = results_map
            rec_out["played"] = actuals is not None
            f.write(json.dumps(rec_out) + "\n")
            resolved_count += 1
    logger.info("Wrote %d resolved records → %s", resolved_count, out_path.name)

    # Refresh the per-player EFP stats cache so tomorrow's projections
    # see today's outcome. Idempotent; rewrites the entire JSON file.
    try:
        season = int(game_date.split("-")[0])
        from subprocess import run
        script = Path(__file__).parent / "update_player_stats_from_logs.py"
        logger.info("Refreshing player_efp_stats cache for %d...", season)
        run([sys.executable, str(script), str(season)], check=True)
    except Exception as e:
        logger.warning("player_efp_stats update failed: %s", e)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("date", nargs="?", default=None,
                   help="YYYY-MM-DD (default: yesterday local)")
    args = p.parse_args()
    target = args.date or (date.today() - timedelta(days=1)).isoformat()
    asyncio.run(resolve(target))


if __name__ == "__main__":
    main()
