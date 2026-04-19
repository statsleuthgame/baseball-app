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
POLITE_THROTTLE_S = 0.25

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
):
    gamePk = game.get("gamePk")
    if not gamePk:
        return
    venue_id = (game.get("venue") or {}).get("id")
    park_raw = get_park_factor(venue_id)
    park = {"id": venue_id, **park_raw}

    try:
        boxscore = await fetch_boxscore(client, gamePk)
    except Exception as e:
        logger.warning("boxscore fetch failed for %s: %s", gamePk, e)
        return
    await asyncio.sleep(POLITE_THROTTLE_S)

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

    for row in batter_rows:
        pid = row["player_id"]
        key = (gamePk, pid)
        if key in processed_keys:
            continue

        try:
            season_stat, l7_stat = await get_player_stats_as_of(
                client, pid, season, game_date
            )
        except Exception as e:
            logger.warning("as-of-date fetch failed for %s in %s: %s", pid, gamePk, e)
            continue
        await asyncio.sleep(POLITE_THROTTLE_S)

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

        projection = project_hitter_points(
            season_rates=season_rates,
            l7_rates=l7_rates,
            bvp=None,  # BvP skipped in Phase 1 backtest
            league_rates=league,
            park=park,
            weather=None,  # historical weather deferred — neutral
            projected_pa=actual_pa,
            weights=weights,
        )

        rows_out.append({
            "date": game_date,
            "gamePk": gamePk,
            "player_id": pid,
            "player_name": row["name"],
            "team_id": row["team_id"],
            "team_abbr": row["team_abbr"],
            "side": row["side"],
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

    async with httpx.AsyncClient(base_url=MLB_API_BASE, timeout=30) as client:
        dates = await get_schedule_dates(client, start, end)
        logger.info("Schedule: %d days fetched", len(dates))
        for d in dates:
            games = d.get("games", [])
            for g in games:
                status = (g.get("status") or {}).get("detailedState")
                if status not in ("Final", "Game Over"):
                    continue
                await process_game(client, g, season, weights, league, processed, rows_out)

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
    "l7_blend":        [0.20, 0.30, 0.40, 0.50],
    "bvp_blend":       [0.00, 0.10, 0.20, 0.30],
    # Widened twice after both coefs pinned at the upper bound. Extending
    # the ceiling helps us tell "model wants bigger coefs" from "grid is
    # the ceiling". If these still pin, the model structure (linear r/rbi
    # per OBP/SLG) has hit its R² ceiling and richer features are needed.
    "r_per_pa_coef":   [0.30, 0.34, 0.38, 0.42, 0.46, 0.50, 0.54, 0.58, 0.62, 0.66, 0.70],
    "rbi_per_pa_coef": [0.20, 0.24, 0.28, 0.32, 0.36, 0.40, 0.44, 0.48, 0.52, 0.56, 0.60],
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
                row = {
                    "pa": int(float(r["pa"])),
                    "actual_efp": float(r["actual_efp"]),
                    "park_hr": float(r.get("park_hr") or 100),
                    "park_runs": float(r.get("park_runs") or 100),
                    "singles": float(r["rates_season_singles"]),
                    "hr": float(r["rates_season_hr"]),
                    "obp": float(r["rates_season_obp"]),
                    "slg": float(r["rates_season_slg"]),
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

    def eval_weights(w: dict, subset: list[dict]) -> tuple[float, float, float]:
        """Return (R², MAE, Spearman). The inputs (singles/hr/obp/slg) are
        fixed per row; we re-score with different weights."""
        projected: list[float] = []
        actual: list[float] = []
        from app.services.fantasy import (
            PP_SCORING,
        )  # lazy import — already imported above but keeps local scope clean
        for r in subset:
            pa = r["pa"]
            park_hr_mult = r["park_hr"] / 100.0
            park_runs_mult = r["park_runs"] / 100.0
            # For fit, we shortcut: R and RBI coefficients are what matter
            # plus park multipliers. Fine-grained per-event rates are
            # already baked into singles/hr; we don't change them here.
            # (l7_blend and bvp_blend won't affect anything here without
            # the raw L7/BvP data in the CSV — Phase 2 only fits the R
            # and RBI coefficients meaningfully. l7_blend + bvp_blend
            # stubs exist for Phase 3's deeper backtest.)
            r_per_pa = r["obp"] * w["r_per_pa_coef"]
            rbi_per_pa = r["slg"] * w["rbi_per_pa_coef"]
            # Rebuild a minimal EFP with the stored season rates.
            # 1B is already net of park-runs in the CSV only if we stored
            # post-multiplier; we stored raw season rates, so apply here.
            s_rate = r["singles"] * park_runs_mult
            hr_rate = r["hr"] * park_hr_mult
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
    ))
    logger.info("Grid: %d combinations", len(combos))

    for (l7b, bvpb, rc, rbic) in combos:
        w = dict(weights_seed)
        w.update({
            "l7_blend": l7b,
            "bvp_blend": bvpb,
            "r_per_pa_coef": rc,
            "rbi_per_pa_coef": rbic,
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
