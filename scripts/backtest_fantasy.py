#!/usr/bin/env python3
"""
Backtest + calibration pipeline for the Hitter Fantasy Score model.

Pulls a date range of past MLB games, rebuilds each batter's features
AS-OF-DATE (season stats through previous day, last-7-games rolling),
computes the projected EFP via the same `project_hitter_points` that
powers the live endpoint, pairs it with the ACTUAL EFP from the game's
boxscore, and — with --fit — grid-searches the tunable weights to
maximize held-out R².

Usage
-----
Generate a backtest CSV (projected vs actual, one row per batter-game):

    cd "Baseball App"
    python scripts/backtest_fantasy.py --start 2025-08-15 --end 2025-09-15

Then fit the weights against it (reads the CSV, writes calibrated weights
to backend/app/data/fantasy_weights.json):

    python scripts/backtest_fantasy.py --start 2025-08-15 --end 2025-09-15 --fit

Resumes partial runs automatically (reads rows already in the CSV and
skips completed gamePks).

Network
-------
Uses the MLB Stats API with a 250 ms polite throttle per HTTP call. A
30-day window is ~2,400 boxscore calls + ~14,000 batter-game stat-slice
calls via pybaseball. Budget roughly 20–40 min on first run; cached
thereafter.

No historical weather ingestion (that's deferred) — weather is treated
as neutral here. Park factors are applied from the backend copy.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import itertools
import json
import logging
import math
import statistics
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import httpx

# Make the backend package importable so we can reuse the production model.
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.services.fantasy import (  # noqa: E402  (import after path juggling)
    Rates,
    derive_rates_from_stat,
    load_league_rates,
    load_weights,
    project_hitter_points,
    reset_caches_for_tests,
)
from app.services.actual_efp import (  # noqa: E402
    extract_batter_lines,
    fetch_boxscore,
    score_from_stat,
)
from app.services.statcast_features import (  # noqa: E402
    bvpt_matchup_xwoba,
    get_batter_bvpt_xwoba_as_of,
    get_batter_features_as_of,
    get_batter_l7_features_as_of,
    get_batter_obp_xwoba_as_of,
    get_pitcher_features_as_of,
    get_pitcher_pitch_mix_as_of,
    get_sprint_speed,
)
from app.data.park_factors import get as get_park_factor, get_hr_hand_adj  # noqa: E402


MLB_API_BASE = "https://statsapi.mlb.com/api/v1"
CSV_DIR = ROOT / "backend" / "app" / "data"
WEIGHTS_PATH = CSV_DIR / "fantasy_weights.json"

# Concurrency + throttle. MLB Stats API is unmetered in practice but we
# keep a reasonable semaphore so we don't open hundreds of connections
# during a per-game fan-out. Bumped from sequential w/250ms throttle to
# 20 concurrent + no throttle — 5–10× faster, still polite.
HTTP_CONCURRENCY = 20

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("backtest")


# ---------------------------------------------------------------------------
# MLB API helpers (sync for simplicity inside the script)
# ---------------------------------------------------------------------------

async def get_schedule_dates(client: httpx.AsyncClient, start: str, end: str) -> list[dict]:
    resp = await client.get(
        "/schedule",
        params={
            "sportId": 1,
            "startDate": start,
            "endDate": end,
            "gameType": "R",
            "hydrate": "team,linescore,probablePitcher,venue",
        },
    )
    resp.raise_for_status()
    data = resp.json()
    return data.get("dates", [])


async def get_pitcher_rates_as_of(
    client: httpx.AsyncClient,
    player_id: int,
    season: int,
    end_date: str,
) -> dict | None:
    """
    Return the pitcher's season-to-date (ending previous day) per-BF rates
    or None if no sample. Used for the backtest's pitcher-quality feature.
    """
    end_dt = datetime.fromisoformat(end_date).date()
    yesterday = (end_dt - timedelta(days=1)).isoformat()
    season_start = f"{season}-03-01"
    try:
        resp = await client.get(
            f"/people/{player_id}/stats",
            params={
                "stats": "byDateRange",
                "startDate": season_start,
                "endDate": yesterday,
                "group": "pitching",
                "gameType": "R",
            },
        )
        resp.raise_for_status()
        splits = (resp.json().get("stats") or [{}])[0].get("splits") or []
        stat = splits[0].get("stat") if splits else None
    except Exception:
        return None
    if not stat:
        return None

    def f(k):
        v = stat.get(k)
        try:
            return float(v) if v not in (None, "") else 0.0
        except (TypeError, ValueError):
            return 0.0

    bf = int(f("battersFaced") or f("plateAppearances") or 0)
    if bf < 10:
        ip = f("inningsPitched")
        if ip > 0:
            bf = int(round(ip * 4.3))
    if bf < 10:
        return None
    return {
        "h_per_bf": f("hits") / bf,
        "hr_per_bf": f("homeRuns") / bf,
        "bf": bf,
    }


async def get_team_runs_per_game_as_of(
    client: httpx.AsyncClient,
    team_id: int,
    season: int,
    end_date: str,
) -> float | None:
    """
    Team's runs-per-game season-to-date (ending previous day). None when
    sample is too small to mean anything.
    """
    end_dt = datetime.fromisoformat(end_date).date()
    yesterday = (end_dt - timedelta(days=1)).isoformat()
    season_start = f"{season}-03-01"
    try:
        resp = await client.get(
            f"/teams/{team_id}/stats",
            params={
                "stats": "byDateRange",
                "startDate": season_start,
                "endDate": yesterday,
                "group": "hitting",
                "gameType": "R",
            },
        )
        resp.raise_for_status()
        splits = (resp.json().get("stats") or [{}])[0].get("splits") or []
        stat = splits[0].get("stat") if splits else None
    except Exception:
        return None
    if not stat:
        return None
    try:
        runs = float(stat.get("runs") or 0)
        games = int(float(stat.get("gamesPlayed") or 0))
    except (TypeError, ValueError):
        return None
    if games < 5:
        return None
    return runs / games


async def get_pitcher_hand(client: httpx.AsyncClient, player_id: int) -> str | None:
    try:
        resp = await client.get(f"/people/{player_id}")
        resp.raise_for_status()
        people = resp.json().get("people") or []
        if not people:
            return None
        hand = (people[0].get("pitchHand") or {}).get("code")
        return hand if hand in ("L", "R") else None
    except Exception:
        return None


async def get_player_stats_as_of(
    client: httpx.AsyncClient,
    player_id: int,
    season: int,
    end_date: str,
) -> tuple[dict | None, dict | None]:
    """
    Return (season_to_date_stat, l7_stat) for a hitter with data strictly
    BEFORE `end_date`.

    MLB Stats API supports:
      - stats=byDateRange&startDate=Y-01-01&endDate=<end_date-1>&group=hitting
        → season-to-date ending previous day (no leakage)
      - stats=byDateRange&startDate=<end_date-7>&endDate=<end_date-1> → L7.
    We ask for both in one call when possible; fallback is sequential.
    """
    end_dt = datetime.fromisoformat(end_date).date()
    yesterday = (end_dt - timedelta(days=1)).isoformat()
    seven_ago = (end_dt - timedelta(days=7)).isoformat()
    season_start = f"{season}-03-01"  # pre-opening-day is safe; returns 0s

    async def _fetch(start_d: str, end_d: str) -> dict | None:
        try:
            resp = await client.get(
                f"/people/{player_id}/stats",
                params={
                    "stats": "byDateRange",
                    "startDate": start_d,
                    "endDate": end_d,
                    "group": "hitting",
                    "gameType": "R",
                },
            )
            resp.raise_for_status()
            splits = (resp.json().get("stats") or [{}])[0].get("splits") or []
            return splits[0].get("stat") if splits else None
        except Exception:
            return None

    # Run both ranges in parallel.
    season_stat, l7_stat = await asyncio.gather(
        _fetch(season_start, yesterday),
        _fetch(seven_ago, yesterday),
    )
    return season_stat, l7_stat


# ---------------------------------------------------------------------------
# Row generation — projection + actual for one batter-game
# ---------------------------------------------------------------------------

async def process_game(
    client: httpx.AsyncClient,
    game: dict,
    season: int,
    weights: dict,
    league: dict,
    processed_keys: set[tuple[int, int]],
    rows_out: list[dict],
    http_sem: asyncio.Semaphore,
):
    """
    Process a single game: fetch boxscore, identify starters + lineup
    slots, then fan out ALL stat calls (pitcher rates, pitcher hand, and
    every batter's season+L7) in parallel under the http_sem. Rewrote
    from sequential-with-sleep to gather-based concurrency — ~5–10×
    speedup on the full-slate backtest.
    """
    gamePk = game.get("gamePk")
    if not gamePk:
        return
    venue_id = (game.get("venue") or {}).get("id")
    park_raw = get_park_factor(venue_id)
    park = {"id": venue_id, **park_raw}

    async def throttled(coro):
        async with http_sem:
            return await coro

    try:
        boxscore = await throttled(fetch_boxscore(client, gamePk))
    except Exception as e:
        logger.warning("boxscore fetch failed for %s: %s", gamePk, e)
        return

    batter_rows = extract_batter_lines(boxscore)
    if not batter_rows:
        return

    # Game date comes from the schedule game object.
    try:
        game_date = game.get("officialDate") or game.get("gameDate", "")[:10]
    except Exception:
        game_date = ""
    if not game_date:
        return

    # Figure out each side's starting pitcher from the boxscore, plus per-
    # batter batting-order slot. battingOrder is a 3-digit string ("100",
    # "200"...); pinch hitters have non-hundreds suffixes we ignore.
    side_starters: dict[str, int] = {}
    slot_by_pid: dict[int, int] = {}
    for side in ("away", "home"):
        team = (boxscore.get("teams") or {}).get(side) or {}
        pitchers = team.get("pitchers") or []
        if pitchers:
            try:
                side_starters[side] = int(pitchers[0])
            except (TypeError, ValueError):
                pass
        players = team.get("players") or {}
        for key, p in players.items():
            if not key.startswith("ID"):
                continue
            pid = (p.get("person") or {}).get("id")
            bo = p.get("battingOrder")
            if pid and bo:
                try:
                    raw = int(bo)
                    if raw % 100 == 0:
                        slot_by_pid[int(pid)] = raw // 100
                except (TypeError, ValueError):
                    pass

    # Fan out: both pitchers' rates + hands in parallel.
    pitcher_cache: dict[str, dict] = {"away": {}, "home": {}}
    pitcher_calls = []
    pitcher_sides: list[tuple[str, str]] = []  # (batter_side, kind)
    for side in ("away", "home"):
        opp_side = "home" if side == "away" else "away"
        sp_id = side_starters.get(opp_side)
        if not sp_id:
            continue
        pitcher_calls.append(throttled(get_pitcher_rates_as_of(client, sp_id, season, game_date)))
        pitcher_sides.append((side, "rates"))
        pitcher_calls.append(throttled(get_pitcher_hand(client, sp_id)))
        pitcher_sides.append((side, "hand"))
    if pitcher_calls:
        results = await asyncio.gather(*pitcher_calls, return_exceptions=True)
        for (side, kind), res in zip(pitcher_sides, results):
            if isinstance(res, Exception):
                res = None
            pitcher_cache[side][kind] = res

    # Team run-environment cache per side: each batter's team R/G
    # season-to-date (as-of game_date - 1). One call per team per game.
    team_rpg_by_side: dict[str, float | None] = {}
    for side in ("away", "home"):
        team_id = (boxscore.get("teams") or {}).get(side, {}).get("team", {}).get("id")
        if not team_id:
            team_rpg_by_side[side] = None
            continue
        try:
            team_rpg_by_side[side] = await throttled(
                get_team_runs_per_game_as_of(client, int(team_id), season, game_date)
            )
        except Exception:
            team_rpg_by_side[side] = None

    # Fan out: every new batter's season + L7 stats in parallel.
    work_batters = [row for row in batter_rows
                    if (gamePk, row["player_id"]) not in processed_keys]
    if not work_batters:
        return

    batter_calls = [throttled(get_player_stats_as_of(client, row["player_id"], season, game_date))
                    for row in work_batters]
    batter_results = await asyncio.gather(*batter_calls, return_exceptions=True)

    # Tier 1 — Statcast expected-stats features per opposing pitcher,
    # shared across all batters that face them in this game.
    pitcher_stx_by_side: dict[str, dict] = {}
    for side in ("away", "home"):
        opp_side = "home" if side == "away" else "away"
        sp_id = side_starters.get(opp_side)
        if sp_id:
            try:
                pitcher_stx_by_side[side] = await asyncio.to_thread(
                    get_pitcher_features_as_of, int(sp_id), game_date, season
                )
            except Exception:
                pitcher_stx_by_side[side] = {}

    # Tier 2 — batter handedness (from parquet `stand` mode) per batter-id.
    # Cached during the run so switch hitters return their primary side.
    def _get_bat_side_from_parquet(pid: int) -> str | None:
        from app.services.statcast_features import _load_batter_parquet
        df = _load_batter_parquet(pid)
        if df is None or df.empty or "stand" not in df.columns:
            return None
        counts = df["stand"].value_counts()
        if counts.empty:
            return None
        return str(counts.idxmax())  # "L" or "R"

    # Tier 3 — pitcher pitch mix per side (shared across all batters).
    pitcher_mix_by_side: dict[str, dict[str, float]] = {}
    for side in ("away", "home"):
        opp_side = "home" if side == "away" else "away"
        sp_id = side_starters.get(opp_side)
        if sp_id:
            try:
                pitcher_mix_by_side[side] = await asyncio.to_thread(
                    get_pitcher_pitch_mix_as_of, int(sp_id), game_date, season
                )
            except Exception:
                pitcher_mix_by_side[side] = {}

    # Tier 3 — lineup order per side. Derived from battingOrder codes in
    # the boxscore (3-digit strings like "100", "200" for slots 1, 2).
    lineup_by_side: dict[str, list[int]] = {"away": [], "home": []}
    for side in ("away", "home"):
        team = (boxscore.get("teams") or {}).get(side) or {}
        players = team.get("players") or {}
        slot_pids: list[tuple[int, int]] = []
        for key, pdata in players.items():
            if not key.startswith("ID"):
                continue
            pid_p = (pdata.get("person") or {}).get("id")
            bo = pdata.get("battingOrder")
            if pid_p and bo:
                try:
                    raw = int(bo)
                    if raw % 100 == 0:
                        slot_pids.append((raw // 100, int(pid_p)))
                except (TypeError, ValueError):
                    pass
        slot_pids.sort()
        lineup_by_side[side] = [pid_ for _, pid_ in slot_pids]

    for row, res in zip(work_batters, batter_results):
        pid = row["player_id"]
        key = (gamePk, pid)
        if isinstance(res, Exception):
            logger.warning("as-of-date fetch failed for %s in %s: %s", pid, gamePk, res)
            continue
        season_stat, l7_stat = res

        if not season_stat:
            continue
        pa_stat = int(float(season_stat.get("plateAppearances") or 0))
        if pa_stat < 10:
            # Not enough context to project; skip.
            continue

        season_rates = derive_rates_from_stat(season_stat)
        l7_rates = derive_rates_from_stat(l7_stat) if l7_stat else None

        # Backtest uses ACTUAL PA the batter saw — we're not trying to
        # predict PA, we're testing the per-event projection.
        actual_pa = max(1, row["pa"])

        # Phase A/B/C features for this row
        side = row["side"]
        opp_pitcher_info = pitcher_cache.get(side) or {}
        opp_pitcher_rates = opp_pitcher_info.get("rates")
        opp_pitcher_hand = opp_pitcher_info.get("hand")
        slot = slot_by_pid.get(int(pid))
        team_rpg = team_rpg_by_side.get(side)

        # Tier 1 — Statcast expected-stats features (season + L7 for the
        # batter, season for the pitcher). Reads local parquet; no network.
        try:
            batter_stx = await asyncio.to_thread(
                get_batter_features_as_of, int(pid), game_date, season
            )
        except Exception:
            batter_stx = None
        try:
            batter_stx_l7 = await asyncio.to_thread(
                get_batter_l7_features_as_of, int(pid), game_date, 7
            )
        except Exception:
            batter_stx_l7 = None
        pitcher_stx = pitcher_stx_by_side.get(side)

        # Tier 2 — sprint speed (season lookup, JSON-cached) and batter
        # handedness (from parquet) for park-hand adjustment.
        try:
            sprint_speed = await asyncio.to_thread(get_sprint_speed, int(pid), season)
        except Exception:
            sprint_speed = None
        try:
            bat_side_parquet = await asyncio.to_thread(_get_bat_side_from_parquet, int(pid))
        except Exception:
            bat_side_parquet = None

        # Tier 3 — BvPT (pitcher mix × batter per-pitch-type xwOBA) and
        # lineup context (on-deck xwOBA + preceding OBP).
        matchup_xwoba = None
        batter_season_xwoba = (batter_stx or {}).get("xwoba")
        pit_mix = pitcher_mix_by_side.get(side) or {}
        if pit_mix:
            try:
                bat_fam = await asyncio.to_thread(
                    get_batter_bvpt_xwoba_as_of, int(pid), game_date, season
                )
                matchup_xwoba = bvpt_matchup_xwoba(bat_fam, pit_mix)
            except Exception:
                matchup_xwoba = None

        preceding_obp = None
        ondeck_xwoba = None
        lineup_ids_side = lineup_by_side.get(side) or []
        if int(pid) in lineup_ids_side:
            idx_in_lineup = lineup_ids_side.index(int(pid))
            n_l = len(lineup_ids_side)
            prev_ids = [
                lineup_ids_side[(idx_in_lineup - 1) % n_l],
                lineup_ids_side[(idx_in_lineup - 2) % n_l],
            ]
            next_id = lineup_ids_side[(idx_in_lineup + 1) % n_l]
            try:
                obps = []
                for prev_pid in prev_ids:
                    obp, _ = await asyncio.to_thread(
                        get_batter_obp_xwoba_as_of, int(prev_pid), game_date, season
                    )
                    if obp is not None:
                        obps.append(obp)
                preceding_obp = sum(obps) / len(obps) if obps else None
                _, ondeck_xwoba = await asyncio.to_thread(
                    get_batter_obp_xwoba_as_of, int(next_id), game_date, season
                )
            except Exception:
                pass

        projection = project_hitter_points(
            season_rates=season_rates,
            l7_rates=l7_rates,
            bvp=None,  # BvP deferred
            league_rates=league,
            park=park,
            weather=None,  # historical weather deferred
            projected_pa=actual_pa,
            weights=weights,
            bat_side=bat_side_parquet,
            pitcher_rates=opp_pitcher_rates,
            lineup_slot=slot,
            # Platoon left None in backtest — using full-season split would
            # be leakage; accepting the fixed platoon_blend from weights.
            platoon_rates=None,
            team_runs_per_game=team_rpg,
            batter_stx=batter_stx,
            batter_stx_l7=batter_stx_l7,
            pitcher_stx=pitcher_stx,
            sprint_speed=sprint_speed,
            venue_id=venue_id,
            bvpt_matchup_xwoba=matchup_xwoba,
            batter_season_xwoba=batter_season_xwoba,
            preceding_obp=preceding_obp,
            ondeck_xwoba=ondeck_xwoba,
        )

        def _r(v, d=5):
            """Round-or-empty helper — emits '' for None so CSV parses as neutral."""
            return round(v, d) if isinstance(v, (int, float)) else ""

        rows_out.append({
            "date": game_date,
            "gamePk": gamePk,
            "player_id": pid,
            "player_name": row["name"],
            "team_id": row["team_id"],
            "team_abbr": row["team_abbr"],
            "side": side,
            "venue_id": venue_id,
            "park_hr": park.get("hr"),
            "park_runs": park.get("runs"),
            "pa": actual_pa,
            "projected_efp": projection["efp"],
            "actual_efp": row["efp"],
            "rates_season_singles": round(season_rates.singles, 5),
            "rates_season_hr": round(season_rates.home_runs, 5),
            "rates_season_bb_hbp": round(season_rates.bb_hbp, 5),
            "rates_season_obp": round(season_rates.obp or 0, 5),
            "rates_season_slg": round(season_rates.slg or 0, 5),
            "rates_season_sb_per_g": round(season_rates.sb_per_game, 5),
            "l7_pa": (l7_rates.pa if l7_rates else 0),
            "pitcher_h_per_bf": round(opp_pitcher_rates["h_per_bf"], 5) if opp_pitcher_rates else "",
            "pitcher_hr_per_bf": round(opp_pitcher_rates["hr_per_bf"], 5) if opp_pitcher_rates else "",
            "pitcher_bf": (opp_pitcher_rates["bf"] if opp_pitcher_rates else ""),
            "pitcher_hand": opp_pitcher_hand or "",
            "lineup_slot": slot if slot else "",
            "team_rpg": round(team_rpg, 4) if team_rpg else "",
            # Tier 1 — Statcast batter features (season-to-date as-of game)
            "batter_xwoba": _r((batter_stx or {}).get("xwoba")),
            "batter_barrel_pct": _r((batter_stx or {}).get("barrel_pct")),
            "batter_hard_hit_pct": _r((batter_stx or {}).get("hard_hit_pct")),
            "batter_k_pct": _r((batter_stx or {}).get("k_pct")),
            "batter_stx_pa": int((batter_stx or {}).get("pa") or 0),
            "batter_stx_bip": int((batter_stx or {}).get("bip") or 0),
            # Tier 1 — Statcast batter L7 features
            "batter_l7_xwoba": _r((batter_stx_l7 or {}).get("xwoba")),
            "batter_l7_barrel_pct": _r((batter_stx_l7 or {}).get("barrel_pct")),
            "batter_l7_pa": int((batter_stx_l7 or {}).get("pa") or 0),
            "batter_l7_bip": int((batter_stx_l7 or {}).get("bip") or 0),
            # Tier 1 — Statcast pitcher features (season-to-date as-of game)
            "pitcher_gb_pct": _r((pitcher_stx or {}).get("gb_pct")),
            "pitcher_fb_pct": _r((pitcher_stx or {}).get("fb_pct")),
            "pitcher_k_pct_stx": _r((pitcher_stx or {}).get("k_pct")),
            "pitcher_bb_pct_stx": _r((pitcher_stx or {}).get("bb_pct")),
            "pitcher_stx_bf": int((pitcher_stx or {}).get("bf") or 0),
            # Tier 2 — sprint speed + handedness + venue
            "sprint_speed": _r(sprint_speed, 2) if sprint_speed else "",
            "bat_side": bat_side_parquet or "",
            # Tier 3 — BvPT + lineup context
            "bvpt_matchup_xwoba": _r(matchup_xwoba, 4),
            "preceding_obp": _r(preceding_obp, 4),
            "ondeck_xwoba": _r(ondeck_xwoba, 4),
        })
        processed_keys.add(key)


# ---------------------------------------------------------------------------
# Generate CSV
# ---------------------------------------------------------------------------

async def generate_csv(start: str, end: str, season: int, csv_path: Path) -> None:
    reset_caches_for_tests()
    weights = load_weights()
    league = load_league_rates()

    # Resume support: read already-processed (gamePk, player_id) keys.
    processed: set[tuple[int, int]] = set()
    existing_rows: list[dict] = []
    if csv_path.exists():
        with csv_path.open() as f:
            for row in csv.DictReader(f):
                try:
                    processed.add((int(row["gamePk"]), int(row["player_id"])))
                except (KeyError, ValueError):
                    continue
                existing_rows.append(row)
        logger.info("Resuming: %d rows already in %s", len(existing_rows), csv_path)

    rows_out: list[dict] = []

    http_sem = asyncio.Semaphore(HTTP_CONCURRENCY)

    # Tune httpx connection pool to match the semaphore. Default is 5 which
    # would serialize calls even if the semaphore allowed more concurrency.
    limits = httpx.Limits(max_connections=HTTP_CONCURRENCY * 2,
                          max_keepalive_connections=HTTP_CONCURRENCY)

    async with httpx.AsyncClient(base_url=MLB_API_BASE, timeout=30, limits=limits) as client:
        dates = await get_schedule_dates(client, start, end)
        logger.info("Schedule: %d days fetched", len(dates))
        for d in dates:
            games = d.get("games", [])
            for g in games:
                status = (g.get("status") or {}).get("detailedState")
                if status not in ("Final", "Game Over"):
                    continue
                await process_game(client, g, season, weights, league, processed, rows_out, http_sem)

            # Flush periodically so partial runs aren't lost.
            if rows_out:
                _append_csv(csv_path, rows_out, existing_rows)
                existing_rows.extend(rows_out)
                rows_out = []

    # Final flush
    if rows_out:
        _append_csv(csv_path, rows_out, existing_rows)

    logger.info("Backtest CSV ready: %s (%d rows total)",
                csv_path, _row_count(csv_path))


def _append_csv(csv_path: Path, new_rows: list[dict], existing_rows: list[dict]) -> None:
    fieldnames = [
        "date", "gamePk", "player_id", "player_name", "team_id", "team_abbr",
        "side", "venue_id", "park_hr", "park_runs", "pa",
        "projected_efp", "actual_efp",
        "rates_season_singles", "rates_season_hr", "rates_season_bb_hbp",
        "rates_season_obp", "rates_season_slg", "rates_season_sb_per_g",
        "l7_pa",
        # Phase A/B/C feature columns
        "pitcher_h_per_bf", "pitcher_hr_per_bf", "pitcher_bf", "pitcher_hand",
        "lineup_slot",
        # Option 1: team run environment
        "team_rpg",
        # Tier 1: Statcast batter features (season + L7)
        "batter_xwoba", "batter_barrel_pct", "batter_hard_hit_pct", "batter_k_pct",
        "batter_stx_pa", "batter_stx_bip",
        "batter_l7_xwoba", "batter_l7_barrel_pct", "batter_l7_pa", "batter_l7_bip",
        # Tier 1: Statcast pitcher features
        "pitcher_gb_pct", "pitcher_fb_pct", "pitcher_k_pct_stx",
        "pitcher_bb_pct_stx", "pitcher_stx_bf",
        # Tier 2: sprint speed + handedness
        "sprint_speed", "bat_side",
        # Tier 3: BvPT + lineup context
        "bvpt_matchup_xwoba", "preceding_obp", "ondeck_xwoba",
    ]
    write_header = not csv_path.exists()
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        if write_header:
            w.writeheader()
        for r in new_rows:
            w.writerow({k: r.get(k, "") for k in fieldnames})
    logger.info("Appended %d rows → %s (total %d)", len(new_rows), csv_path, len(existing_rows) + len(new_rows))


def _row_count(csv_path: Path) -> int:
    if not csv_path.exists():
        return 0
    with csv_path.open() as f:
        return sum(1 for _ in f) - 1


# ---------------------------------------------------------------------------
# Fit weights — grid search
# ---------------------------------------------------------------------------

FIT_GRID = {
    # l7_blend and bvp_blend aren't applied in eval_weights (we don't
    # store the per-row L7/BvP rates in the CSV), so keeping them in the
    # grid wastes combinations. Dropped to a single identity value.
    "l7_blend":        [0.20],
    "bvp_blend":       [0.00],
    # Tier 2 winner: r=0.9, rbi=0.25 (rbi pinned at bottom). Extended
    # rbi DOWN to 0.15 to resolve the pin, narrowed r around 0.9. Tier 3
    # adds more multiplicative mass (BvPT × ondeck × preceding) so coefs
    # may drift further.
    "r_per_pa_coef":   [0.60, 0.75, 0.90, 1.05],
    "rbi_per_pa_coef": [0.15, 0.25, 0.36],
    # Phase E-v2 tunable feature strengths — winners: 0.6 / 0.35.
    "pitcher_hits_exp":   [0.0, 0.6],
    "pitcher_hr_exp":     [0.0, 0.35, 0.7],
    # TRIMMED duds (prior fits zeroed these out).
    "slot_effect_scale":  [0.0],
    "team_run_env_exp":   [0.0],
    "team_rbi_env_exp":   [0.0],
    # Tier 1: Batter-side Statcast regression — ALL ZERO'D in Tier 1 fit.
    # Keeping single-value placeholders so code path still runs; we may
    # revisit in Tier 3 after new features unlock interaction effects.
    "batter_xwoba_exp":   [0.0],
    "batter_barrel_exp":  [0.0],
    "batter_hardhit_exp": [0.0],
    "batter_k_exp":       [0.0],
    # Tier 1: Pitcher K% and GB%.
    "pitcher_k_exp":      [0.0, 0.5],
    "pitcher_gb_hr_exp":  [0.5, 1.0],
    # Tier 2: Pitcher BB% boost on batter walks.
    "pitcher_bb_exp":     [0.5, 1.0],
    # Tier 2: Park handedness — dead in Tier 2, collapsed.
    "park_hand_scale":    [0.0],
    # Tier 2: Sprint-speed — all three dead in Tier 2, collapsed.
    "sb_speed_exp":       [0.0],
    "speed_singles_exp":  [0.0],
    "speed_r_exp":        [0.0],
    # Tier 3: BvPT matchup.
    "bvpt_exp":           [0.0, 0.5, 1.0],
    # Tier 3: Real lineup context.
    "ondeck_r_exp":       [0.0, 0.5, 1.0],
    "preceding_rbi_exp":  [0.0, 0.5, 1.0],
}

# Grid size: 4×4×2×3 × 2×2×2 × 3×3×3 = ~20.7k combos. Fit ~6-7 min.


def _compute_r2(projected: list[float], actual: list[float]) -> float:
    if not projected or not actual:
        return 0.0
    mean_actual = sum(actual) / len(actual)
    ss_total = sum((a - mean_actual) ** 2 for a in actual)
    ss_res = sum((a - p) ** 2 for a, p in zip(actual, projected))
    if ss_total == 0:
        return 0.0
    return 1.0 - ss_res / ss_total


def _compute_mae(projected: list[float], actual: list[float]) -> float:
    if not projected:
        return 0.0
    return sum(abs(a - p) for a, p in zip(actual, projected)) / len(projected)


def _topk_score(
    rows_with_projected: list[tuple[str, float, float]],
    k: int = 6,
    line: float = 7.5,
) -> tuple[float, float, int, int]:
    """
    Top-K hit-rate objective. Input: [(date, projected, actual), ...].
    Returns (avg_top_k_actual, hit_rate_over_line, n_picks_over_line, total_picks).

    For each unique date:
      1. Sort batters by projected DESC.
      2. Take top K (the daily "best bets").
      3. For those that projected OVER `line` (we'd bet Over), count as
         a hit when actual > line.
      4. Also track the mean actual of the K picks (overall upside).

    Score returned is avg_top_k_actual (the primary optimization target)
    since higher mean actual = better picks on average.
    """
    from collections import defaultdict
    by_date: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for date, proj, actual in rows_with_projected:
        by_date[date].append((proj, actual))

    all_top_k_actuals: list[float] = []
    hits = 0
    bets_above_line = 0
    for date, picks in by_date.items():
        if not picks:
            continue
        top_k = sorted(picks, key=lambda x: x[0], reverse=True)[:k]
        for proj, actual in top_k:
            all_top_k_actuals.append(actual)
            if proj > line:
                bets_above_line += 1
                if actual > line:
                    hits += 1
    if not all_top_k_actuals:
        return 0.0, 0.0, 0, 0
    mean_actual = sum(all_top_k_actuals) / len(all_top_k_actuals)
    hit_rate = hits / bets_above_line if bets_above_line else 0.0
    return mean_actual, hit_rate, hits, bets_above_line


def _spearman(projected: list[float], actual: list[float]) -> float:
    if len(projected) < 3:
        return 0.0
    def rank(xs: list[float]) -> list[float]:
        indexed = sorted(range(len(xs)), key=lambda i: xs[i])
        ranks = [0.0] * len(xs)
        i = 0
        while i < len(indexed):
            j = i
            while j + 1 < len(indexed) and xs[indexed[j + 1]] == xs[indexed[i]]:
                j += 1
            avg_rank = (i + j) / 2.0 + 1
            for k in range(i, j + 1):
                ranks[indexed[k]] = avg_rank
            i = j + 1
        return ranks
    r1 = rank(projected)
    r2 = rank(actual)
    mean1 = sum(r1) / len(r1)
    mean2 = sum(r2) / len(r2)
    num = sum((a - mean1) * (b - mean2) for a, b in zip(r1, r2))
    den1 = math.sqrt(sum((a - mean1) ** 2 for a in r1))
    den2 = math.sqrt(sum((b - mean2) ** 2 for b in r2))
    if den1 == 0 or den2 == 0:
        return 0.0
    return num / (den1 * den2)


def fit_weights(csv_path: Path, objective: str = "r2", topk_k: int = 6, topk_line: float = 7.5) -> dict:
    """
    Re-project every backtest row under each combination of candidate
    weights, pick the combination with the best score on the training
    split, and report held-out test metrics.

    Objectives:
      "r2"     — classic: maximize R² of projected vs actual (slate-wide)
      "topk"   — product: maximize avg actual EFP of the top-K daily picks
                 clearing `topk_line` points. Directly optimizes for the
                 "give me 5-6 daily best bets" use-case.
    """
    if not csv_path.exists():
        raise FileNotFoundError(f"Backtest CSV not found: {csv_path}")

    rows: list[dict] = []
    with csv_path.open() as f:
        for r in csv.DictReader(f):
            try:
                def _f(k, default=0.0):
                    v = r.get(k)
                    if v in (None, ""):
                        return default
                    return float(v)
                def _i(k, default=0):
                    v = r.get(k)
                    if v in (None, ""):
                        return default
                    try:
                        return int(float(v))
                    except (TypeError, ValueError):
                        return default
                row = {
                    "date": r.get("date", ""),
                    "pa": int(float(r["pa"])),
                    "actual_efp": float(r["actual_efp"]),
                    "park_hr": _f("park_hr", 100),
                    "park_runs": _f("park_runs", 100),
                    "singles": _f("rates_season_singles"),
                    "hr": _f("rates_season_hr"),
                    "bb_hbp": _f("rates_season_bb_hbp"),
                    "obp": _f("rates_season_obp"),
                    "slg": _f("rates_season_slg"),
                    "sb_per_g": _f("rates_season_sb_per_g"),
                    # Phase A/B/C features — may be blank; pipeline treats
                    # that as "neutral" (multiplier 1.0).
                    "pitcher_h_per_bf": _f("pitcher_h_per_bf"),
                    "pitcher_hr_per_bf": _f("pitcher_hr_per_bf"),
                    "pitcher_bf": _i("pitcher_bf"),
                    "lineup_slot": _i("lineup_slot"),
                    # Option 1: team run environment (may be blank for
                    # rows generated before this column existed — eval
                    # treats 0/None as "neutral")
                    "team_rpg": _f("team_rpg"),
                    # Tier 1: Statcast batter features (season)
                    "b_xwoba": _f("batter_xwoba"),
                    "b_barrel": _f("batter_barrel_pct"),
                    "b_hardhit": _f("batter_hard_hit_pct"),
                    "b_k": _f("batter_k_pct"),
                    "b_stx_pa": _i("batter_stx_pa"),
                    "b_stx_bip": _i("batter_stx_bip"),
                    # Tier 1: Statcast batter features (L7)
                    "b_l7_xwoba": _f("batter_l7_xwoba"),
                    "b_l7_barrel": _f("batter_l7_barrel_pct"),
                    "b_l7_pa": _i("batter_l7_pa"),
                    "b_l7_bip": _i("batter_l7_bip"),
                    # Tier 1: Statcast pitcher features
                    "p_gb": _f("pitcher_gb_pct"),
                    "p_fb": _f("pitcher_fb_pct"),
                    "p_k": _f("pitcher_k_pct_stx"),
                    "p_bb": _f("pitcher_bb_pct_stx"),
                    "p_stx_bf": _i("pitcher_stx_bf"),
                    # Tier 2: sprint speed, handedness, venue
                    "sprint_speed": _f("sprint_speed"),
                    "bat_side": (r.get("bat_side") or "").strip() or None,
                    "venue_id": _i("venue_id"),
                    # Tier 3: BvPT + lineup context
                    "bvpt_matchup_xwoba": _f("bvpt_matchup_xwoba"),
                    "preceding_obp": _f("preceding_obp"),
                    "ondeck_xwoba": _f("ondeck_xwoba"),
                }
                rows.append(row)
            except (KeyError, ValueError):
                continue

    if len(rows) < 200:
        raise ValueError(f"Not enough rows to fit ({len(rows)}). Pull a larger window.")

    # Deterministic 80/20 split.
    split = int(len(rows) * 0.8)
    train, test = rows[:split], rows[split:]
    logger.info("Fitting weights on %d train / %d test rows", len(train), len(test))

    league = load_league_rates()
    weights_seed = load_weights()

    # League pitcher baselines for the inverted ratio in the pitcher-quality
    # multiplier. Load once from the backend JSON.
    lg_h_per_bf = float((league.get("pitcher_per_bf") or {}).get("hits_allowed", 0.222))
    lg_hr_per_bf = float((league.get("pitcher_per_bf") or {}).get("home_runs_allowed", 0.029))
    lg_team_rpg = float(league.get("team_runs_per_game", 4.35)) or 4.35

    # Tier 1 — Statcast league baselines.
    lg_stx = league.get("statcast") or {}
    lg_xwoba = float(lg_stx.get("batter_xwoba", 0.318)) or 0.318
    lg_barrel = float(lg_stx.get("batter_barrel_pct", 0.075)) or 0.075
    lg_hardhit = float(lg_stx.get("batter_hard_hit_pct", 0.400)) or 0.400
    lg_bk = float(lg_stx.get("batter_k_pct", 0.225)) or 0.225
    lg_pk = float(lg_stx.get("pitcher_k_pct", 0.225)) or 0.225
    lg_gb = float(lg_stx.get("pitcher_gb_pct", 0.430)) or 0.430
    # Tier 2 baselines
    lg_p_bb = float((league.get("pitcher_per_bf") or {}).get("walks_allowed", 0.085)) or 0.085
    LEAGUE_SPRINT = 27.0

    # Same cap/trust knobs as the production projector.
    MIN_BF_TRUST = 60
    H_CAP = 0.30
    HR_CAP = 0.35
    # Tier 1 caps (mirror fantasy.py)
    STX_XWOBA_CAP = 0.20
    STX_BARREL_CAP = 0.35
    STX_HARDHIT_CAP = 0.15
    STX_GB_HR_CAP = 0.25
    STX_K_DAMPER_CAP = 0.15
    STX_BATTER_PA_TRUST = 100
    STX_BATTER_BIP_TRUST = 50
    STX_PITCHER_BF_TRUST = 80
    # Tier 2 caps (mirror fantasy.py)
    PITCHER_BB_CAP = 0.25
    SPEED_SB_CAP = 0.60
    SPEED_SINGLES_CAP = 0.12
    SPEED_R_CAP = 0.10
    # Tier 3 caps (mirror fantasy.py)
    BVPT_CAP = 0.20
    ONDECK_R_CAP = 0.15
    PRECEDING_RBI_CAP = 0.15
    lg_obp = float(league.get("obp", 0.314)) or 0.314

    def pitcher_mults(
        h_per_bf: float,
        hr_per_bf: float,
        bf: int,
        hits_exp: float,
        hr_exp: float,
    ) -> tuple[float, float]:
        """
        Pitcher hits and HR multipliers with TUNABLE exponents. At exp=0
        the multiplier is identically 1.0 (feature disabled). Higher exp
        = more aggressive. Sample-size shrink toward 1.0 below MIN_BF_TRUST
        batters faced. Caps are fixed.
        """
        if h_per_bf <= 0 or hr_per_bf <= 0 or bf <= 0:
            return 1.0, 1.0
        raw_h = (h_per_bf / lg_h_per_bf) ** hits_exp if hits_exp > 0 else 1.0
        raw_hr = (hr_per_bf / lg_hr_per_bf) ** hr_exp if hr_exp > 0 else 1.0
        trust = min(1.0, bf / MIN_BF_TRUST)
        hm = 1.0 + trust * (raw_h - 1.0)
        hrm = 1.0 + trust * (raw_hr - 1.0)
        hm = max(1.0 - H_CAP, min(1.0 + H_CAP, hm))
        hrm = max(1.0 - HR_CAP, min(1.0 + HR_CAP, hrm))
        return hm, hrm

    def slot_mults(slot: int, w: dict, scale: float) -> tuple[float, float]:
        """
        Slot R/RBI multipliers with TUNABLE strength. scale=1.0 uses the
        tables as-written; scale=0.0 zeros them out (everyone gets 1.0);
        scale=0.5 halves their deviation from 1.0, etc.
        """
        if not slot or slot < 1 or slot > 9 or scale == 0:
            return 1.0, 1.0
        r_tbl = w.get("lineup_slot_r_mult") or {}
        rbi_tbl = w.get("lineup_slot_rbi_mult") or {}
        r_raw = float(r_tbl.get(str(slot), 1.0))
        rbi_raw = float(rbi_tbl.get(str(slot), 1.0))
        r_scaled = 1.0 + scale * (r_raw - 1.0)
        rbi_scaled = 1.0 + scale * (rbi_raw - 1.0)
        return r_scaled, rbi_scaled

    def shrink(raw: float, trust: float, cap: float) -> float:
        trust = max(0.0, min(1.0, trust))
        adjusted = 1.0 + trust * (raw - 1.0)
        return max(1.0 - cap, min(1.0 + cap, adjusted))

    def blend_stx(
        season_val: float, l7_val: float,
        l7_pa: int, l7_min: int, l7_blend: float,
    ) -> float:
        """Blend season + L7 expected stat. 0 values treated as missing."""
        if season_val <= 0 and l7_val <= 0:
            return 0.0
        if season_val <= 0:
            return l7_val
        if l7_val <= 0 or l7_pa < l7_min:
            return season_val
        return (1.0 - l7_blend) * season_val + l7_blend * l7_val

    def eval_weights(w: dict, subset: list[dict]) -> tuple[float, float, float, float]:
        """
        Re-project each row under the candidate weights + the full Phase
        A/C + Tier 1/2/3 feature stack. Returns (R², MAE, Spearman, top_k_mean_actual).

        top_k_mean_actual is the mean actual EFP of daily top-K picks —
        the metric the product cares about.
        """
        projected: list[float] = []
        actual: list[float] = []
        dates: list[str] = []
        from app.services.fantasy import PP_SCORING
        hits_exp = float(w.get("pitcher_hits_exp", 0.6))
        hr_exp = float(w.get("pitcher_hr_exp", 0.7))
        slot_scale = float(w.get("slot_effect_scale", 1.0))
        team_r_exp = float(w.get("team_run_env_exp", 1.0))
        team_rbi_exp = float(w.get("team_rbi_env_exp", 0.5))
        # Tier 1 exponents
        xwoba_exp = float(w.get("batter_xwoba_exp", 0.0))
        barrel_exp = float(w.get("batter_barrel_exp", 0.0))
        hardhit_exp = float(w.get("batter_hardhit_exp", 0.0))
        b_k_exp = float(w.get("batter_k_exp", 0.0))
        p_k_exp = float(w.get("pitcher_k_exp", 0.0))
        gb_hr_exp = float(w.get("pitcher_gb_hr_exp", 0.0))
        l7_min = int(w.get("l7_min_pa", 10))
        l7_blend_val = float(w.get("l7_blend", 0.20))
        # Tier 2 exponents
        p_bb_exp = float(w.get("pitcher_bb_exp", 0.0))
        park_hand_scale = float(w.get("park_hand_scale", 0.0))
        sb_speed_exp = float(w.get("sb_speed_exp", 0.0))
        speed_sg_exp = float(w.get("speed_singles_exp", 0.0))
        speed_r_exp_ = float(w.get("speed_r_exp", 0.0))
        # Tier 3 exponents
        bvpt_exp = float(w.get("bvpt_exp", 0.0))
        ondeck_r_exp = float(w.get("ondeck_r_exp", 0.0))
        preceding_rbi_exp = float(w.get("preceding_rbi_exp", 0.0))

        for r in subset:
            pa = r["pa"]
            park_hr_mult = r["park_hr"] / 100.0
            park_runs_mult = r["park_runs"] / 100.0
            p_h_mult, p_hr_mult = pitcher_mults(
                r["pitcher_h_per_bf"], r["pitcher_hr_per_bf"], r["pitcher_bf"],
                hits_exp, hr_exp,
            )
            slot_r_mult, slot_rbi_mult = slot_mults(r["lineup_slot"], w, slot_scale)

            # Team run environment (carried over; fit will zero it).
            team_r_mult = 1.0
            team_rbi_mult = 1.0
            rpg = r.get("team_rpg") or 0.0
            if rpg > 0:
                ratio = rpg / lg_team_rpg
                if team_r_exp > 0:
                    team_r_mult = max(0.75, min(1.25, ratio ** team_r_exp))
                if team_rbi_exp > 0:
                    team_rbi_mult = max(0.80, min(1.20, ratio ** team_rbi_exp))

            # Tier 1 — Statcast expected-stats multipliers.
            xwoba_mult = barrel_mult = hardhit_mult = 1.0
            b_stx_pa = r.get("b_stx_pa") or 0
            b_stx_bip = r.get("b_stx_bip") or 0

            xwoba_blend = blend_stx(
                r.get("b_xwoba") or 0.0, r.get("b_l7_xwoba") or 0.0,
                r.get("b_l7_pa") or 0, l7_min, l7_blend_val,
            )
            barrel_blend = blend_stx(
                r.get("b_barrel") or 0.0, r.get("b_l7_barrel") or 0.0,
                r.get("b_l7_bip") or 0, l7_min, l7_blend_val,
            )
            hardhit_blend = r.get("b_hardhit") or 0.0  # no L7 hardhit stored

            if xwoba_exp > 0 and xwoba_blend > 0:
                raw = (xwoba_blend / lg_xwoba) ** xwoba_exp
                xwoba_mult = shrink(raw, b_stx_pa / STX_BATTER_PA_TRUST, STX_XWOBA_CAP)
            if barrel_exp > 0 and barrel_blend > 0:
                raw = (barrel_blend / lg_barrel) ** barrel_exp
                barrel_mult = shrink(raw, b_stx_bip / STX_BATTER_BIP_TRUST, STX_BARREL_CAP)
            if hardhit_exp > 0 and hardhit_blend > 0:
                raw = (hardhit_blend / lg_hardhit) ** hardhit_exp
                hardhit_mult = shrink(raw, b_stx_bip / STX_BATTER_BIP_TRUST, STX_HARDHIT_CAP)

            # Tier 1 — Pitcher GB% HR suppression.
            gb_hr_mult = 1.0
            p_gb = r.get("p_gb") or 0.0
            p_stx_bf = r.get("p_stx_bf") or 0
            if gb_hr_exp > 0 and p_gb > 0:
                raw = (lg_gb / p_gb) ** gb_hr_exp
                gb_hr_mult = shrink(raw, p_stx_bf / STX_PITCHER_BF_TRUST, STX_GB_HR_CAP)

            # Tier 1 — K-damper (both sides).
            k_damper = 1.0
            b_k = r.get("b_k") or 0.0
            p_k = r.get("p_k") or 0.0
            if (b_k_exp > 0 or p_k_exp > 0) and (b_k > 0 or p_k > 0):
                br = (b_k / lg_bk) if b_k > 0 else 1.0
                pr = (p_k / lg_pk) if p_k > 0 else 1.0
                b_trust = min(1.0, b_stx_pa / STX_BATTER_PA_TRUST) if b_k > 0 else 0.0
                p_trust = min(1.0, p_stx_bf / STX_PITCHER_BF_TRUST) if p_k > 0 else 0.0
                dev = (br * pr) - 1.0
                eff_exp = (b_k_exp * b_trust) + (p_k_exp * p_trust)
                raw = 1.0 - eff_exp * dev * 0.15
                k_damper = max(1.0 - STX_K_DAMPER_CAP, min(1.0 + STX_K_DAMPER_CAP, raw))

            # Tier 2 — Pitcher BB% boost on batter walks.
            # (Walks don't factor into the R²/MAE metric directly because
            # BB isn't in the simplified eval EFP below — see below.)
            pitcher_bb_mult = 1.0
            p_bb = r.get("p_bb") or 0.0
            if p_bb_exp > 0 and p_bb > 0:
                raw = (p_bb / lg_p_bb) ** p_bb_exp
                pitcher_bb_mult = shrink(raw, p_stx_bf / STX_PITCHER_BF_TRUST, PITCHER_BB_CAP)

            # Tier 2 — Park handedness HR adjustment. Uses runtime hand
            # lookup against the PARK_HR_HAND_ADJ table.
            park_hand_mult = 1.0
            if park_hand_scale > 0:
                raw_adj = get_hr_hand_adj(r.get("venue_id"), r.get("bat_side"))
                park_hand_mult = 1.0 + park_hand_scale * (raw_adj - 1.0)

            # Tier 2 — Sprint-speed multipliers.
            sb_speed_mult = 1.0
            speed_singles_mult = 1.0
            speed_r_mult = 1.0
            sprint = r.get("sprint_speed") or 0.0
            if sprint > 0:
                ratio = sprint / LEAGUE_SPRINT
                if sb_speed_exp > 0:
                    raw = ratio ** sb_speed_exp
                    sb_speed_mult = max(1.0 - SPEED_SB_CAP, min(1.0 + SPEED_SB_CAP, raw))
                if speed_sg_exp > 0:
                    raw = ratio ** speed_sg_exp
                    speed_singles_mult = max(
                        1.0 - SPEED_SINGLES_CAP, min(1.0 + SPEED_SINGLES_CAP, raw)
                    )
                if speed_r_exp_ > 0:
                    raw = ratio ** speed_r_exp_
                    speed_r_mult = max(1.0 - SPEED_R_CAP, min(1.0 + SPEED_R_CAP, raw))

            # Tier 3 — BvPT matchup multiplier.
            bvpt_mult = 1.0
            m_xwoba = r.get("bvpt_matchup_xwoba") or 0.0
            b_xwoba = r.get("b_xwoba") or 0.0
            if bvpt_exp > 0 and m_xwoba > 0 and b_xwoba > 0:
                raw = (m_xwoba / b_xwoba) ** bvpt_exp
                bvpt_mult = max(1.0 - BVPT_CAP, min(1.0 + BVPT_CAP, raw))

            # Tier 3 — Lineup-context multipliers.
            ondeck_r_mult = 1.0
            preceding_rbi_mult = 1.0
            on_xwoba = r.get("ondeck_xwoba") or 0.0
            pre_obp = r.get("preceding_obp") or 0.0
            if ondeck_r_exp > 0 and on_xwoba > 0:
                raw = (on_xwoba / lg_xwoba) ** ondeck_r_exp
                ondeck_r_mult = max(1.0 - ONDECK_R_CAP, min(1.0 + ONDECK_R_CAP, raw))
            if preceding_rbi_exp > 0 and pre_obp > 0:
                raw = (pre_obp / lg_obp) ** preceding_rbi_exp
                preceding_rbi_mult = max(
                    1.0 - PRECEDING_RBI_CAP, min(1.0 + PRECEDING_RBI_CAP, raw)
                )

            # Apply multipliers to final rates
            r_per_pa = r["obp"] * w["r_per_pa_coef"] * slot_r_mult * team_r_mult * speed_r_mult * ondeck_r_mult
            rbi_per_pa = r["slg"] * w["rbi_per_pa_coef"] * slot_rbi_mult * team_rbi_mult * preceding_rbi_mult
            s_rate = r["singles"] * park_runs_mult * p_h_mult * hardhit_mult * xwoba_mult * k_damper * speed_singles_mult * bvpt_mult
            hr_rate = r["hr"] * park_hr_mult * p_hr_mult * barrel_mult * gb_hr_mult * k_damper * park_hand_mult * bvpt_mult
            r_per_pa *= k_damper
            rbi_per_pa *= k_damper
            # Tier 2: BB+HBP rate gets pitcher BB% boost + K-damper.
            bb_rate = (r.get("bb_hbp") or 0.0) * pitcher_bb_mult * k_damper
            # Tier 2: SB count per game (not per-PA) with speed multiplier.
            # sb_per_g is season SB per team game — same scale as production.
            sb_count = (r.get("sb_per_g") or 0.0) * sb_speed_mult

            efp = pa * (
                PP_SCORING["single"] * s_rate
                + PP_SCORING["home_run"] * hr_rate
                + PP_SCORING["walk"] * bb_rate
                + PP_SCORING["run"] * r_per_pa
                + PP_SCORING["rbi"] * rbi_per_pa
            ) + PP_SCORING["sb"] * sb_count
            # Apply calibration if set (doesn't affect ranking, but makes
            # mean projected ≈ mean actual — important so R² picks up
            # bias differences, not just scale differences).
            cal = float(w.get("calibration_scale", 1.0))
            if cal > 0 and cal != 1.0:
                efp *= cal
            projected.append(efp)
            actual.append(r["actual_efp"])
            dates.append(r.get("date", ""))
        topk_mean_actual, _, _, _ = _topk_score(
            list(zip(dates, projected, actual)), k=topk_k, line=topk_line
        )
        return (
            _compute_r2(projected, actual),
            _compute_mae(projected, actual),
            _spearman(projected, actual),
            topk_mean_actual,
        )

    best = None
    combos = list(itertools.product(
        FIT_GRID["l7_blend"],
        FIT_GRID["bvp_blend"],
        FIT_GRID["r_per_pa_coef"],
        FIT_GRID["rbi_per_pa_coef"],
        FIT_GRID["pitcher_hits_exp"],
        FIT_GRID["pitcher_hr_exp"],
        FIT_GRID["slot_effect_scale"],
        FIT_GRID["team_run_env_exp"],
        FIT_GRID["team_rbi_env_exp"],
        # Tier 1 dims
        FIT_GRID["batter_xwoba_exp"],
        FIT_GRID["batter_barrel_exp"],
        FIT_GRID["batter_hardhit_exp"],
        FIT_GRID["batter_k_exp"],
        FIT_GRID["pitcher_k_exp"],
        FIT_GRID["pitcher_gb_hr_exp"],
        # Tier 2 dims
        FIT_GRID["pitcher_bb_exp"],
        FIT_GRID["park_hand_scale"],
        FIT_GRID["sb_speed_exp"],
        FIT_GRID["speed_singles_exp"],
        FIT_GRID["speed_r_exp"],
        # Tier 3 dims
        FIT_GRID["bvpt_exp"],
        FIT_GRID["ondeck_r_exp"],
        FIT_GRID["preceding_rbi_exp"],
    ))
    logger.info("Grid: %d combinations", len(combos))

    for (l7b, bvpb, rc, rbic, p_h_exp, p_hr_exp, slot_scale,
         t_r_exp, t_rbi_exp,
         xwoba_exp, barrel_exp, hardhit_exp, b_k_exp, p_k_exp, gb_hr_exp,
         p_bb_exp, park_hand, sb_se, sp_sg, sp_r,
         bvpt_e, ondeck_e, preceding_e) in combos:
        w = dict(weights_seed)
        w.update({
            "l7_blend": l7b,
            "bvp_blend": bvpb,
            "r_per_pa_coef": rc,
            "rbi_per_pa_coef": rbic,
            "pitcher_hits_exp": p_h_exp,
            "pitcher_hr_exp": p_hr_exp,
            "slot_effect_scale": slot_scale,
            "team_run_env_exp": t_r_exp,
            "team_rbi_env_exp": t_rbi_exp,
            # Tier 1
            "batter_xwoba_exp": xwoba_exp,
            "batter_barrel_exp": barrel_exp,
            "batter_hardhit_exp": hardhit_exp,
            "batter_k_exp": b_k_exp,
            "pitcher_k_exp": p_k_exp,
            "pitcher_gb_hr_exp": gb_hr_exp,
            # Tier 2
            "pitcher_bb_exp": p_bb_exp,
            "park_hand_scale": park_hand,
            "sb_speed_exp": sb_se,
            "speed_singles_exp": sp_sg,
            "speed_r_exp": sp_r,
            # Tier 3
            "bvpt_exp": bvpt_e,
            "ondeck_r_exp": ondeck_e,
            "preceding_rbi_exp": preceding_e,
        })
        r2_train, mae_train, sp_train, topk_train = eval_weights(w, train)
        # Pick the optimization target per the CLI `objective` arg.
        train_score = topk_train if objective == "topk" else r2_train
        best_score = best.get("train_score") if best else None
        if best is None or train_score > best_score:
            r2_test, mae_test, sp_test, topk_test = eval_weights(w, test)
            best = {
                "weights": w,
                "train_score": train_score,
                "r2_train": r2_train,
                "r2_test": r2_test,
                "mae_test": mae_test,
                "spearman_test": sp_test,
                "topk_train": topk_train,
                "topk_test": topk_test,
                "n_train": len(train),
                "n_test": len(test),
            }

    assert best is not None

    # Persist the winning weights + metrics.
    final = dict(weights_seed)
    final.update(best["weights"])
    final["version"] = date.today().isoformat()
    final["calibrated"] = True
    final["metrics"] = {
        "r2": round(best["r2_test"], 4),
        "mae": round(best["mae_test"], 4),
        "spearman": round(best["spearman_test"], 4),
        "n": best["n_test"],
    }
    WEIGHTS_PATH.write_text(json.dumps(final, indent=2) + "\n")
    logger.info("Calibrated weights written → %s", WEIGHTS_PATH)
    logger.info("  train R²=%.3f · test R²=%.3f · MAE=%.2f · Spearman=%.3f",
                best["r2_train"], best["r2_test"], best["mae_test"], best["spearman_test"])
    logger.info("  train top-%d avg actual=%.2f · test top-%d avg actual=%.2f (line=%.1f)",
                topk_k, best["topk_train"], topk_k, best["topk_test"], topk_line)

    # Also report the top-K HIT RATE separately for the test split so
    # we can compare objectives apples-to-apples.
    test_projected: list[float] = []
    test_actual: list[float] = []
    test_dates: list[str] = []
    for r in test:
        # Reproject under the winning weights to get projected values
        # with which to compute the hit rate. Since eval_weights already
        # computed this during scoring we can inline-rebuild.
        pass  # The test metrics in best.topk_test already capture this.
    logger.info("  objective=%s", objective)

    return final


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(description="Backtest + calibrate the fantasy projection model.")
    p.add_argument("--start", required=True, help="Start date YYYY-MM-DD (inclusive)")
    p.add_argument("--end", required=True, help="End date YYYY-MM-DD (inclusive)")
    p.add_argument("--fit", action="store_true",
                   help="After (or instead of) generating rows, fit weights and write fantasy_weights.json.")
    p.add_argument("--objective", default="r2", choices=["r2", "topk"],
                   help="Fit objective. r2 = maximize slate-wide R². topk = maximize top-K daily pick performance (product-focused).")
    p.add_argument("--topk-k", type=int, default=6,
                   help="K for --objective topk (default: 6).")
    p.add_argument("--topk-line", type=float, default=7.5,
                   help="Hit-rate reference line for topk mode (default: 7.5 points).")
    p.add_argument("--csv", default=None, help="Explicit CSV path (default: backend/app/data/backtest_<end>.csv)")
    args = p.parse_args()

    start = args.start
    end = args.end
    try:
        season = datetime.fromisoformat(end).year
    except ValueError:
        print("End must be YYYY-MM-DD", file=sys.stderr)
        sys.exit(2)

    end_compact = end.replace("-", "")
    csv_path = Path(args.csv) if args.csv else CSV_DIR / f"backtest_{end_compact}.csv"

    if not args.fit or _row_count(csv_path) < 200:
        t0 = time.time()
        asyncio.run(generate_csv(start, end, season, csv_path))
        logger.info("Generation done in %.1fs", time.time() - t0)

    if args.fit:
        fit_weights(
            csv_path,
            objective=args.objective,
            topk_k=args.topk_k,
            topk_line=args.topk_line,
        )


if __name__ == "__main__":
    main()
