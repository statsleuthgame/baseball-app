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
from app.data.park_factors import get as get_park_factor  # noqa: E402


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

        projection = project_hitter_points(
            season_rates=season_rates,
            l7_rates=l7_rates,
            bvp=None,  # BvP deferred
            league_rates=league,
            park=park,
            weather=None,  # historical weather deferred
            projected_pa=actual_pa,
            weights=weights,
            pitcher_rates=opp_pitcher_rates,
            lineup_slot=slot,
            # Platoon left None in backtest — using full-season split would
            # be leakage; accepting the fixed platoon_blend from weights.
            platoon_rates=None,
            team_runs_per_game=team_rpg,
        )

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
            "rates_season_obp": round(season_rates.obp or 0, 5),
            "rates_season_slg": round(season_rates.slg or 0, 5),
            "l7_pa": (l7_rates.pa if l7_rates else 0),
            "pitcher_h_per_bf": round(opp_pitcher_rates["h_per_bf"], 5) if opp_pitcher_rates else "",
            "pitcher_hr_per_bf": round(opp_pitcher_rates["hr_per_bf"], 5) if opp_pitcher_rates else "",
            "pitcher_bf": (opp_pitcher_rates["bf"] if opp_pitcher_rates else ""),
            "pitcher_hand": opp_pitcher_hand or "",
            "lineup_slot": slot if slot else "",
            "team_rpg": round(team_rpg, 4) if team_rpg else "",
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
        "rates_season_singles", "rates_season_hr",
        "rates_season_obp", "rates_season_slg",
        "l7_pa",
        # Phase A/B/C feature columns
        "pitcher_h_per_bf", "pitcher_hr_per_bf", "pitcher_bf", "pitcher_hand",
        "lineup_slot",
        # Option 1: team run environment
        "team_rpg",
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
    # Trimmed to keep the 7-dim grid tractable (~17k combinations).
    "r_per_pa_coef":   [0.30, 0.42, 0.54, 0.66, 0.78, 0.90],
    "rbi_per_pa_coef": [0.24, 0.36, 0.48, 0.60, 0.72],
    # Phase E-v2 tunable feature strengths (see prior commits for detail):
    "pitcher_hits_exp":   [0.0, 0.3, 0.6, 0.9],
    "pitcher_hr_exp":     [0.0, 0.35, 0.7, 1.0],
    "slot_effect_scale":  [0.0, 0.5, 1.0],        # prior fit chose 0
    # Option 1: team run environment exponent on (team_rpg / league_rpg).
    # 0 disables; higher = more aggressive. Separate knobs for R and RBI
    # so we can e.g. apply strong R effect but subtle RBI.
    "team_run_env_exp":   [0.0, 0.5, 1.0, 1.5],
    "team_rbi_env_exp":   [0.0, 0.5, 1.0],
}


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


def fit_weights(csv_path: Path) -> dict:
    """
    Re-project every backtest row under each combination of candidate
    weights, pick the combination with the best R² on the training split,
    and report held-out test metrics.
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
                    "pa": int(float(r["pa"])),
                    "actual_efp": float(r["actual_efp"]),
                    "park_hr": _f("park_hr", 100),
                    "park_runs": _f("park_runs", 100),
                    "singles": _f("rates_season_singles"),
                    "hr": _f("rates_season_hr"),
                    "obp": _f("rates_season_obp"),
                    "slg": _f("rates_season_slg"),
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

    # Same cap/trust knobs as the production projector.
    MIN_BF_TRUST = 60
    H_CAP = 0.30
    HR_CAP = 0.35

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

    def eval_weights(w: dict, subset: list[dict]) -> tuple[float, float, float]:
        """
        Re-project each row under the candidate weights + the full Phase
        A/C feature stack (pitcher quality, lineup slot). Returns
        (R², MAE, Spearman).
        """
        projected: list[float] = []
        actual: list[float] = []
        from app.services.fantasy import PP_SCORING
        hits_exp = float(w.get("pitcher_hits_exp", 0.6))
        hr_exp = float(w.get("pitcher_hr_exp", 0.7))
        slot_scale = float(w.get("slot_effect_scale", 1.0))
        team_r_exp = float(w.get("team_run_env_exp", 1.0))
        team_rbi_exp = float(w.get("team_rbi_env_exp", 0.5))

        for r in subset:
            pa = r["pa"]
            park_hr_mult = r["park_hr"] / 100.0
            park_runs_mult = r["park_runs"] / 100.0
            p_h_mult, p_hr_mult = pitcher_mults(
                r["pitcher_h_per_bf"], r["pitcher_hr_per_bf"], r["pitcher_bf"],
                hits_exp, hr_exp,
            )
            slot_r_mult, slot_rbi_mult = slot_mults(r["lineup_slot"], w, slot_scale)

            # Team run environment. Mirrors project_hitter_points logic;
            # missing team_rpg (older rows before this column) → no effect.
            team_r_mult = 1.0
            team_rbi_mult = 1.0
            rpg = r.get("team_rpg") or 0.0
            if rpg > 0:
                ratio = rpg / lg_team_rpg
                if team_r_exp > 0:
                    team_r_mult = max(0.75, min(1.25, ratio ** team_r_exp))
                if team_rbi_exp > 0:
                    team_rbi_mult = max(0.80, min(1.20, ratio ** team_rbi_exp))

            r_per_pa = r["obp"] * w["r_per_pa_coef"] * slot_r_mult * team_r_mult
            rbi_per_pa = r["slg"] * w["rbi_per_pa_coef"] * slot_rbi_mult * team_rbi_mult
            s_rate = r["singles"] * park_runs_mult * p_h_mult
            hr_rate = r["hr"] * park_hr_mult * p_hr_mult

            efp = pa * (
                PP_SCORING["single"] * s_rate
                + PP_SCORING["home_run"] * hr_rate
                + PP_SCORING["run"] * r_per_pa
                + PP_SCORING["rbi"] * rbi_per_pa
            )
            projected.append(efp)
            actual.append(r["actual_efp"])
        return _compute_r2(projected, actual), _compute_mae(projected, actual), _spearman(projected, actual)

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
    ))
    logger.info("Grid: %d combinations", len(combos))

    for (l7b, bvpb, rc, rbic, p_h_exp, p_hr_exp, slot_scale,
         t_r_exp, t_rbi_exp) in combos:
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
        })
        r2_train, mae_train, sp_train = eval_weights(w, train)
        if best is None or r2_train > best["r2_train"]:
            r2_test, mae_test, sp_test = eval_weights(w, test)
            best = {
                "weights": w,
                "r2_train": r2_train,
                "r2_test": r2_test,
                "mae_test": mae_test,
                "spearman_test": sp_test,
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
        fit_weights(csv_path)


if __name__ == "__main__":
    main()
