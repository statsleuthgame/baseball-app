from datetime import date

from fastapi import APIRouter, Query
from app.services import fangraphs_stats
from app.services.cache import get as cache_get, set as cache_set

router = APIRouter()

CACHE_TTL = 60 * 60 * 6  # 6 hours


@router.get("/api/leaderboards/k-bb-pct")
async def get_kbb_leaderboard(season: int = Query(default=None)):
    """
    Top and bottom K-BB% pitchers (best predictor of pitcher performance).
    Returns top 25 and bottom 25 among qualified starters.
    """
    if season is None:
        season = date.today().year

    cache_key = f"leaderboard:kbb:{season}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    import asyncio
    data = await asyncio.to_thread(fangraphs_stats.get_kbb_leaderboard, season)
    cache_set(cache_key, data, CACHE_TTL)
    return data


@router.get("/api/leaderboards/batting")
async def get_batting_leaderboard(season: int = Query(default=None)):
    """League-wide FanGraphs batting leaderboard ranked by wRC+."""
    if season is None:
        season = date.today().year

    cache_key = f"leaderboard:batting:{season}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    import asyncio
    data = await asyncio.to_thread(fangraphs_stats.get_league_batting_leaderboard, season)
    cache_set(cache_key, data, CACHE_TTL)
    return data


@router.get("/api/leaderboards/pitching")
async def get_pitching_leaderboard(season: int = Query(default=None)):
    """League-wide FanGraphs pitching leaderboard ranked by FIP."""
    if season is None:
        season = date.today().year

    cache_key = f"leaderboard:pitching:{season}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    import asyncio
    data = await asyncio.to_thread(fangraphs_stats.get_league_pitching_leaderboard, season)
    cache_set(cache_key, data, CACHE_TTL)
    return data


@router.get("/api/leaderboards/team-batting")
async def get_team_batting(season: int = Query(default=None)):
    """All 30 teams' batting stats ranked by wRC+."""
    if season is None:
        season = date.today().year

    cache_key = f"leaderboard:team_batting:{season}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    import asyncio
    data = await asyncio.to_thread(fangraphs_stats.get_team_batting_stats, season)
    cache_set(cache_key, data, CACHE_TTL)
    return data


@router.get("/api/leaderboards/team-pitching")
async def get_team_pitching(season: int = Query(default=None)):
    """All 30 teams' pitching stats ranked by FIP."""
    if season is None:
        season = date.today().year

    cache_key = f"leaderboard:team_pitching:{season}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    import asyncio
    data = await asyncio.to_thread(fangraphs_stats.get_team_pitching_stats, season)
    cache_set(cache_key, data, CACHE_TTL)
    return data


@router.get("/api/player/{player_id}/fangraphs")
async def get_player_fangraphs(player_id: int, name: str = Query(...), pitcher: bool = Query(default=False), season: int = Query(default=None)):
    """
    FanGraphs season stats for a specific player.
    Requires the player's full name to look them up in the FanGraphs dataset.
    Returns WAR, wRC+/FIP, K-BB%, SIERA, and more.
    """
    if season is None:
        season = date.today().year

    cache_key = f"fg:{player_id}:{season}:{pitcher}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    if pitcher:
        data = await fangraphs_stats.get_pitcher_fangraphs_async(name, season)
    else:
        data = await fangraphs_stats.get_batter_fangraphs_async(name, season)

    cache_set(cache_key, data, CACHE_TTL)
    return data
