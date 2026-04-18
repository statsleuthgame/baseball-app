"""
Hitter Fantasy Score — PrizePicks Projection Model

Pure projection math + slate orchestration for the Edge tab's Fantasy
section. Scoring table is the OFFICIAL PrizePicks hitter scoring:

    1B=3, 2B=5, 3B=8, HR=10, R=2, RBI=2, BB=2, HBP=2, SB=5

No strikeout penalty for batters.

The projection for a hitter on a given day:

    EFP = PA × ( 3·s + 5·d + 8·t + 10·hr + 2·(bb+hbp) + 2·R/PA + 2·RBI/PA )
        + stolen_base_per_game

Per-event rates are blended L7 over season (0.3/0.7 default, sample-gated),
then nudged by BvP if enough sample (>= 5 PA, ramped to 20 PA), then
multiplied by park factors and a hard-coded weather physics multiplier
on HR rate (Alan Nathan baseball-physics: temp ≥ 85°F → HR ×1.05,
temp < 55°F → HR ×0.90, wind out → ×1.10, wind in → ×0.88).

R/PA ≈ OBP · r_coef; RBI/PA ≈ SLG · rbi_coef — the two coefs (r_coef,
rbi_coef) are tunable via `fantasy_weights.json`, which the Phase-2
backtest re-fits.

The module is intentionally side-effect-free at import time; the
`project_hitter_points` function is pure so it unit-tests cleanly, and
the async slate orchestrator is separate.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Optional

from app.services import mlb_api
from app.services.cache import get as cache_get, set as cache_set
from app.data.park_factors import get as get_park_factor

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Scoring constants — the OFFICIAL PrizePicks hitter table.
# ---------------------------------------------------------------------------

PP_SCORING = {
    "single":    3.0,
    "double":    5.0,
    "triple":    8.0,
    "home_run": 10.0,
    "run":       2.0,
    "rbi":       2.0,
    "walk":      2.0,
    "hbp":       2.0,
    "sb":        5.0,
}

# Weather multipliers (HR rate only). Published baseball-physics values,
# NOT tuned from backtest (backtest has no historical weather).
WEATHER_TEMP_HOT_THRESHOLD_F = 85.0
WEATHER_TEMP_COLD_THRESHOLD_F = 55.0
WEATHER_HR_MULT_HOT = 1.05
WEATHER_HR_MULT_COLD = 0.90
WEATHER_HR_MULT_WIND_OUT = 1.10
WEATHER_HR_MULT_WIND_IN = 0.88

# ---------------------------------------------------------------------------
# Config / weight loading
# ---------------------------------------------------------------------------

_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
_WEIGHTS_PATH = _DATA_DIR / "fantasy_weights.json"
_LEAGUE_RATES_PATH = _DATA_DIR / "league_rates_2026.json"

_weights_cache: dict | None = None
_league_cache: dict | None = None


def load_weights() -> dict:
    global _weights_cache
    if _weights_cache is None:
        with _WEIGHTS_PATH.open() as f:
            _weights_cache = json.load(f)
    return _weights_cache


def load_league_rates() -> dict:
    global _league_cache
    if _league_cache is None:
        with _LEAGUE_RATES_PATH.open() as f:
            _league_cache = json.load(f)
    return _league_cache


def reset_caches_for_tests() -> None:
    """Test-only helper to force re-reading on-disk config."""
    global _weights_cache, _league_cache
    _weights_cache = None
    _league_cache = None


# ---------------------------------------------------------------------------
# Rate shape + derivation helpers
# ---------------------------------------------------------------------------

@dataclass
class Rates:
    """Per-PA rates used by the projection model."""
    singles: float
    doubles: float
    triples: float
    home_runs: float
    bb_hbp: float
    obp: float
    slg: float
    sb_per_game: float
    pa: int

    def as_dict(self) -> dict:
        return {
            "singles": self.singles,
            "doubles": self.doubles,
            "triples": self.triples,
            "home_runs": self.home_runs,
            "bb_hbp": self.bb_hbp,
            "obp": self.obp,
            "slg": self.slg,
            "sb_per_game": self.sb_per_game,
            "pa": self.pa,
        }


def _safe_div(num: float, den: float, default: float = 0.0) -> float:
    return num / den if den else default


def derive_rates_from_stat(stat: dict | None, games_played: int | None = None) -> Rates:
    """
    Turn a raw MLB stat row into per-PA Rates. Works with MLB Stats API's
    `splits[0].stat` shape (dict of camelCase strings/numbers).
    """
    s = stat or {}

    def f(key: str) -> float:
        v = s.get(key)
        if v is None or v == "":
            return 0.0
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0

    pa = int(f("plateAppearances") or 0)
    ab = int(f("atBats") or 0)
    hits = int(f("hits") or 0)
    doubles = int(f("doubles") or 0)
    triples = int(f("triples") or 0)
    hr = int(f("homeRuns") or 0)
    singles = max(0, hits - doubles - triples - hr)
    bb = int(f("baseOnBalls") or 0)
    hbp = int(f("hitByPitch") or 0)
    sb = int(f("stolenBases") or 0)

    obp = f("obp")
    slg = f("slg")

    gp = int(games_played or s.get("gamesPlayed") or 0)

    return Rates(
        singles=_safe_div(singles, pa),
        doubles=_safe_div(doubles, pa),
        triples=_safe_div(triples, pa),
        home_runs=_safe_div(hr, pa),
        bb_hbp=_safe_div(bb + hbp, pa),
        obp=obp,
        slg=slg,
        sb_per_game=_safe_div(sb, gp),
        pa=pa,
    )


# ---------------------------------------------------------------------------
# Pure projection — THE function the backtest calls too.
# ---------------------------------------------------------------------------

def _blend_l7(season_rate: float, l7_rate: float, l7_pa: int, weights: dict) -> float:
    """
    Shrink L7 toward season. When L7 has < l7_min_pa plate appearances we
    trust season entirely (L7 noise dominates).
    """
    if l7_pa < weights.get("l7_min_pa", 10):
        return season_rate
    blend = float(weights.get("l7_blend", 0.30))
    return (1.0 - blend) * season_rate + blend * l7_rate


def _bvp_multiplier(
    batter_rate: float,
    league_rate: float,
    bvp_rate: float,
    bvp_pa: int,
    weights: dict,
) -> float:
    """
    Multiplicative nudge based on BvP deviation from league rate. Sample
    weighted 0 below 5 PA, linear to full at 20 PA.
    """
    if league_rate <= 0 or bvp_rate is None:
        return 1.0
    floor = weights.get("bvp_blend_ramp_floor", 5)
    ceil = weights.get("bvp_min_pa", 20)
    if bvp_pa < floor:
        return 1.0
    ramp = 1.0 if bvp_pa >= ceil else (bvp_pa - floor) / max(1, ceil - floor)
    blend = float(weights.get("bvp_blend", 0.20))
    cap = float(weights.get("bvp_multiplier_cap", 0.25))
    deviation = (bvp_rate - league_rate) / league_rate
    mult = 1.0 + ramp * blend * deviation
    return max(1.0 - cap, min(1.0 + cap, mult))


def _weather_hr_multiplier(weather: dict | None) -> float:
    if not weather:
        return 1.0
    mult = 1.0
    temp = weather.get("temp")
    try:
        if temp is not None:
            temp_f = float(temp)
            if temp_f >= WEATHER_TEMP_HOT_THRESHOLD_F:
                mult *= WEATHER_HR_MULT_HOT
            elif temp_f < WEATHER_TEMP_COLD_THRESHOLD_F:
                mult *= WEATHER_HR_MULT_COLD
    except (TypeError, ValueError):
        pass
    wind = (weather.get("wind") or "").lower()
    # Wind strings come from MLB Stats API as e.g. "10 mph, Out To CF",
    # "8 mph, In From LF", "5 mph, L To R".
    if "out" in wind:
        mult *= WEATHER_HR_MULT_WIND_OUT
    elif "in" in wind and "from" in wind:
        # "In from CF/LF/RF" — wind blowing IN knocks fly balls down.
        mult *= WEATHER_HR_MULT_WIND_IN
    return mult


def _clamp_pa(projected_pa: float, weights: dict) -> float:
    floor = float(weights.get("pa_floor", 3.0))
    ceil = float(weights.get("pa_ceil", 5.2))
    return max(floor, min(ceil, projected_pa))


def _tier(efp: float, weights: dict) -> str:
    if efp >= float(weights.get("tier_high", 11.0)):
        return "high"
    if efp >= float(weights.get("tier_medium", 8.0)):
        return "medium"
    return "low"


def project_hitter_points(
    *,
    season_rates: Rates,
    l7_rates: Rates | None,
    bvp: dict | None,
    league_rates: dict,
    park: dict,
    weather: dict | None,
    projected_pa: float,
    weights: dict,
) -> dict:
    """
    Pure projection function. Returns a dict:
        {
          "efp": float,
          "per_event": {singles, doubles, triples, home_runs, bb_hbp, r, rbi, sb},
          "multipliers": {park_hr, park_runs, weather_hr},
          "rates": effective per-PA rates used,
          "pa": clamped PA,
          "tier": "high"|"medium"|"low",
        }
    """
    # 1. Base rate blend (L7 + season)
    def blend(key: str) -> float:
        season_v = getattr(season_rates, key)
        l7_v = getattr(l7_rates, key) if l7_rates else 0.0
        l7_pa = l7_rates.pa if l7_rates else 0
        return _blend_l7(season_v, l7_v, l7_pa, weights)

    singles = blend("singles")
    doubles = blend("doubles")
    triples = blend("triples")
    home_runs = blend("home_runs")
    bb_hbp = blend("bb_hbp")

    # 2. BvP nudge — one multiplier applied to BA-like rates (1B+2B+3B+HR) and
    #    a separate one for HR specifically via the HR rate in BvP.
    if bvp and bvp.get("pa"):
        pp_bvp = league_rates.get("per_pa", {})
        league_ba = league_rates.get("ba", 0.244)
        league_hr = pp_bvp.get("home_runs", 0.033)
        bvp_pa = int(bvp.get("pa") or 0)
        bvp_ab = int(bvp.get("ab") or 0)
        bvp_hits = int(bvp.get("hits") or 0)
        bvp_hr = int(bvp.get("home_runs") or bvp.get("homeRuns") or 0)
        bvp_ba = _safe_div(bvp_hits, bvp_ab)
        bvp_hr_per_pa = _safe_div(bvp_hr, bvp_pa)
        contact_mult = _bvp_multiplier(0, league_ba, bvp_ba, bvp_pa, weights)
        hr_mult_bvp = _bvp_multiplier(0, league_hr, bvp_hr_per_pa, bvp_pa, weights)
        singles *= contact_mult
        doubles *= contact_mult
        triples *= contact_mult
        home_runs *= hr_mult_bvp
    # bb_hbp is not nudged by BvP — walk/HBP tendencies are more about the
    # pitcher's control profile, which isn't in our BvP input.

    # 3. Park factors (runs on non-HR hits, hr on HR)
    park_runs = float(park.get("runs", 100)) / 100.0
    park_hr = float(park.get("hr", 100)) / 100.0
    singles *= park_runs
    doubles *= park_runs
    triples *= park_runs
    home_runs *= park_hr

    # 4. Weather HR multiplier
    weather_hr = _weather_hr_multiplier(weather)
    home_runs *= weather_hr

    # 5. R and RBI projections — OBP / SLG proxies
    r_coef = float(weights.get("r_per_pa_coef", 0.35))
    rbi_coef = float(weights.get("rbi_per_pa_coef", 0.25))
    obp_base = season_rates.obp or 0.0
    slg_base = season_rates.slg or 0.0
    if l7_rates and l7_rates.pa >= weights.get("l7_min_pa", 10):
        blend_r = float(weights.get("l7_blend", 0.30))
        obp_base = (1.0 - blend_r) * obp_base + blend_r * (l7_rates.obp or 0.0)
        slg_base = (1.0 - blend_r) * slg_base + blend_r * (l7_rates.slg or 0.0)
    r_per_pa = obp_base * r_coef
    rbi_per_pa = slg_base * rbi_coef

    # 6. PA and final EFP
    pa = _clamp_pa(projected_pa, weights)

    sb_proj = (season_rates.sb_per_game or 0.0)
    if l7_rates and l7_rates.sb_per_game:
        sb_proj = (sb_proj + l7_rates.sb_per_game) / 2.0

    efp = pa * (
        PP_SCORING["single"] * singles
        + PP_SCORING["double"] * doubles
        + PP_SCORING["triple"] * triples
        + PP_SCORING["home_run"] * home_runs
        + PP_SCORING["walk"] * bb_hbp
        + PP_SCORING["run"] * r_per_pa
        + PP_SCORING["rbi"] * rbi_per_pa
    ) + PP_SCORING["sb"] * sb_proj

    return {
        "efp": round(efp, 2),
        "per_event": {
            "singles": round(pa * PP_SCORING["single"] * singles, 2),
            "doubles": round(pa * PP_SCORING["double"] * doubles, 2),
            "triples": round(pa * PP_SCORING["triple"] * triples, 2),
            "home_runs": round(pa * PP_SCORING["home_run"] * home_runs, 2),
            "bb_hbp": round(pa * PP_SCORING["walk"] * bb_hbp, 2),
            "r": round(pa * PP_SCORING["run"] * r_per_pa, 2),
            "rbi": round(pa * PP_SCORING["rbi"] * rbi_per_pa, 2),
            "sb": round(PP_SCORING["sb"] * sb_proj, 2),
        },
        "multipliers": {
            "park_hr": round(park_hr, 3),
            "park_runs": round(park_runs, 3),
            "weather_hr": round(weather_hr, 3),
        },
        "rates": {
            "singles": round(singles, 4),
            "doubles": round(doubles, 4),
            "triples": round(triples, 4),
            "home_runs": round(home_runs, 4),
            "bb_hbp": round(bb_hbp, 4),
            "r_per_pa": round(r_per_pa, 4),
            "rbi_per_pa": round(rbi_per_pa, 4),
        },
        "pa": round(pa, 2),
        "tier": _tier(efp, weights),
    }


# ---------------------------------------------------------------------------
# Slate orchestration — fan out against MLB Stats API to project today.
# ---------------------------------------------------------------------------

_SEASON_STATS_TTL = 60 * 30
_L7_STATS_TTL = 60 * 15
_SCHEDULE_TTL = 60 * 10
_SLATE_TTL = 60 * 5
_CONCURRENCY_LIMIT = 8


def _today_iso() -> str:
    return date.today().isoformat()


async def _fetch_season_stats(player_id: int, season: int) -> dict | None:
    cache_key = f"fantasy:seasonStats:{player_id}:{season}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    data = await mlb_api.fetch(
        f"/people/{player_id}/stats",
        params={"stats": "season", "group": "hitting", "season": season},
    )
    splits = (data.get("stats") or [{}])[0].get("splits") or []
    stat = splits[0].get("stat") if splits else None
    if stat:
        cache_set(cache_key, stat, _SEASON_STATS_TTL)
    return stat


async def _fetch_l7_stats(player_id: int, season: int) -> dict | None:
    cache_key = f"fantasy:l7Stats:{player_id}:{season}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    data = await mlb_api.fetch(
        f"/people/{player_id}/stats",
        params={
            "stats": "lastXGames",
            "group": "hitting",
            "gameType": "R",
            "limit": 7,
        },
    )
    splits = (data.get("stats") or [{}])[0].get("splits") or []
    stat = splits[0].get("stat") if splits else None
    if stat:
        cache_set(cache_key, stat, _L7_STATS_TTL)
    return stat


async def _fetch_schedule(date_iso: str) -> list[dict]:
    cache_key = f"fantasy:schedule:{date_iso}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    data = await mlb_api.fetch(
        "/schedule",
        params={
            "sportId": 1,
            "date": date_iso,
            "hydrate": "team,linescore,probablePitcher,weather,venue(location),lineups",
            "gameType": "R",
        },
    )
    games: list[dict] = []
    for d in data.get("dates", []):
        for g in d.get("games", []):
            games.append(g)
    cache_set(cache_key, games, _SCHEDULE_TTL)
    return games


async def _fetch_roster(team_id: int, season: int) -> list[dict]:
    """Get the active position-player list (exclude pitchers)."""
    cache_key = f"fantasy:roster:{team_id}:{season}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    roster = await mlb_api.get_roster(team_id, season=season)
    batters = [
        p for p in roster
        if (p.get("position") or {}).get("type") != "Pitcher"
    ]
    cache_set(cache_key, batters, _SEASON_STATS_TTL)
    return batters


def _extract_lineup_ids(lineups: dict | None, side: str) -> list[int]:
    """
    MLB `lineups` hydrate shape varies. Return the confirmed batting order
    as a list of player IDs when available; else [].
    """
    if not lineups:
        return []
    for key in (f"{side}Players", f"{side}Lineup", side):
        arr = lineups.get(key) if isinstance(lineups, dict) else None
        if isinstance(arr, list) and arr:
            ids: list[int] = []
            for p in arr:
                if isinstance(p, dict):
                    pid = p.get("id") or (p.get("person") or {}).get("id")
                    if pid:
                        ids.append(int(pid))
            if ids:
                return ids
    return []


def _projected_pa(lineup_ids: list[int], batter_id: int, weights: dict) -> tuple[float, str]:
    """Return (projected_pa, source). Source is 'lineup' or 'default'."""
    default = float(weights.get("default_pa", 4.0))
    if not lineup_ids:
        return default, "default"
    try:
        idx = lineup_ids.index(int(batter_id))  # 0-based
    except ValueError:
        return default, "default"
    slot = idx + 1
    adj = float(weights.get("lineup_pa_adj", 0.30))
    if slot <= 3:
        return default + adj, "lineup"
    if slot >= 7:
        return default - adj, "lineup"
    return default, "lineup"


async def _build_game_context(g: dict) -> dict:
    """Reshape one hydrated MLB schedule game into the fields we need."""
    teams = g.get("teams", {}) or {}
    away = teams.get("away", {}) or {}
    home = teams.get("home", {}) or {}
    away_team = away.get("team", {}) or {}
    home_team = home.get("team", {}) or {}
    venue = g.get("venue", {}) or {}
    weather = g.get("weather") or None

    def pitcher(t: dict) -> dict | None:
        p = t.get("probablePitcher")
        if not p:
            return None
        return {
            "id": p.get("id"),
            "fullName": p.get("fullName"),
        }

    return {
        "gamePk": g.get("gamePk"),
        "gameDate": g.get("gameDate"),
        "status": (g.get("status") or {}).get("detailedState"),
        "venue": {"id": venue.get("id"), "name": venue.get("name")},
        "weather": weather if (weather and weather.get("temp")) else None,
        "away": {
            "id": away_team.get("id"),
            "name": away_team.get("name"),
            "abbreviation": away_team.get("abbreviation"),
            "probablePitcher": pitcher(away),
        },
        "home": {
            "id": home_team.get("id"),
            "name": home_team.get("name"),
            "abbreviation": home_team.get("abbreviation"),
            "probablePitcher": pitcher(home),
        },
        "lineups": g.get("lineups") or {},
    }


async def _project_batter(
    *,
    player: dict,
    season: int,
    team_abbr: str,
    team_id: int,
    opp_abbr: str,
    opp_team_id: int,
    opp_pitcher: dict | None,
    park: dict,
    weather: dict | None,
    projected_pa: float,
    pa_source: str,
    weights: dict,
    league_rates: dict,
    semaphore: asyncio.Semaphore,
) -> dict | None:
    async with semaphore:
        try:
            pid = int(player.get("id"))
            season_stat, l7_stat = await asyncio.gather(
                _fetch_season_stats(pid, season),
                _fetch_l7_stats(pid, season),
                return_exceptions=False,
            )
        except Exception as e:
            logger.warning("fantasy: fetch failed for %s: %s", player.get("id"), e)
            return None

    # Require at least 10 season PA to project at all — protects against
    # call-ups / rehabbers with zero context.
    if not season_stat or int(float(season_stat.get("plateAppearances") or 0)) < 10:
        return None

    season_rates = derive_rates_from_stat(season_stat)
    l7_rates = derive_rates_from_stat(l7_stat) if l7_stat else None

    projection = project_hitter_points(
        season_rates=season_rates,
        l7_rates=l7_rates,
        bvp=None,  # Phase 1 skips BvP (added alongside backtest in Phase 2)
        league_rates=league_rates,
        park=park,
        weather=weather,
        projected_pa=projected_pa,
        weights=weights,
    )

    return {
        "player_id": pid,
        "name": player.get("fullName", ""),
        "position": (player.get("position") or {}).get("abbreviation", ""),
        "team_id": team_id,
        "team_abbr": team_abbr,
        "opp_abbr": opp_abbr,
        "opp_team_id": opp_team_id,
        "opp_pitcher": opp_pitcher,
        "park": {"id": park.get("id"), "name": park.get("name"), "runs": park.get("runs"), "hr": park.get("hr"), "label": park.get("label")},
        "weather": weather,
        "pa_source": pa_source,
        **projection,
    }


async def project_slate(date_iso: str | None = None, season: int | None = None) -> dict:
    """
    Main entry: rank every eligible hitter on today's slate by projected
    EFP, return top-N along with supporting metadata.
    """
    from app.config import get_current_season

    if season is None:
        season = get_current_season()
    if not date_iso:
        date_iso = _today_iso()

    cache_key = f"fantasy:projections:{date_iso}:{season}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    weights = load_weights()
    league_rates = load_league_rates()

    raw_games = await _fetch_schedule(date_iso)
    games = [await _build_game_context(g) for g in raw_games if g]
    # Only project games we can meaningfully score (not Final, both teams
    # present). Unknown pitcher is OK (BvP skipped anyway in Phase 1).
    games = [
        g for g in games
        if g.get("status") != "Final"
        and g.get("away", {}).get("id")
        and g.get("home", {}).get("id")
    ]

    semaphore = asyncio.Semaphore(_CONCURRENCY_LIMIT)
    tasks = []

    for g in games:
        park_raw = get_park_factor(g.get("venue", {}).get("id"))
        park = {"id": g.get("venue", {}).get("id"), **park_raw}
        lineup_away = _extract_lineup_ids(g.get("lineups"), "away")
        lineup_home = _extract_lineup_ids(g.get("lineups"), "home")

        # Fetch rosters (so we have someone to project when no lineup yet).
        try:
            away_batters, home_batters = await asyncio.gather(
                _fetch_roster(g["away"]["id"], season),
                _fetch_roster(g["home"]["id"], season),
            )
        except Exception as e:
            logger.warning("fantasy: roster fetch failed for game %s: %s", g.get("gamePk"), e)
            continue

        # If lineup exists, project only lineup hitters (the real 9). If
        # not, project the full roster and UI shows "default" badge.
        away_pool = [p for p in away_batters if (not lineup_away) or int(p.get("id")) in lineup_away]
        home_pool = [p for p in home_batters if (not lineup_home) or int(p.get("id")) in lineup_home]

        for p in away_pool:
            proj_pa, pa_source = _projected_pa(lineup_away, int(p.get("id")), weights)
            tasks.append(_project_batter(
                player=p, season=season,
                team_abbr=g["away"]["abbreviation"], team_id=g["away"]["id"],
                opp_abbr=g["home"]["abbreviation"], opp_team_id=g["home"]["id"],
                opp_pitcher=g["home"]["probablePitcher"],
                park=park, weather=g.get("weather"),
                projected_pa=proj_pa, pa_source=pa_source,
                weights=weights, league_rates=league_rates,
                semaphore=semaphore,
            ))
        for p in home_pool:
            proj_pa, pa_source = _projected_pa(lineup_home, int(p.get("id")), weights)
            tasks.append(_project_batter(
                player=p, season=season,
                team_abbr=g["home"]["abbreviation"], team_id=g["home"]["id"],
                opp_abbr=g["away"]["abbreviation"], opp_team_id=g["away"]["id"],
                opp_pitcher=g["away"]["probablePitcher"],
                park=park, weather=g.get("weather"),
                projected_pa=proj_pa, pa_source=pa_source,
                weights=weights, league_rates=league_rates,
                semaphore=semaphore,
            ))

    rows: list[dict] = [r for r in await asyncio.gather(*tasks, return_exceptions=False) if r]
    rows.sort(key=lambda r: r["efp"], reverse=True)

    # Cap displayed list; full slate can grow large but UI wants a focused top.
    MAX_DISPLAY = 40
    payload = {
        "date": date_iso,
        "season": season,
        "weights_version": weights.get("version"),
        "calibrated": bool(weights.get("calibrated")),
        "metrics": weights.get("metrics") or {},
        "game_count": len(games),
        "projection_count": len(rows),
        "projections": rows[:MAX_DISPLAY],
    }
    cache_set(cache_key, payload, _SLATE_TTL)
    return payload
