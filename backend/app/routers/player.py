from datetime import date
from fastapi import APIRouter, HTTPException

from app.config import CACHE_TTL_PLAYER_STATS, CACHE_TTL_STATCAST
from app.services import cache
from app.services import mlb_api
from app.services import statcast

router = APIRouter(prefix="/api/player", tags=["player"])


@router.get("/{player_id}/detail")
async def player_detail(player_id: int):
    key = f"player_detail:{player_id}"
    cached = cache.get(key)
    if cached:
        return cached

    detail = await mlb_api.get_player_detail(player_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Player not found")
    cache.set(key, detail, CACHE_TTL_PLAYER_STATS)
    return detail


@router.get("/{player_id}/stats")
async def player_stats(player_id: int, season: int | None = None, group: str = "hitting"):
    if season is None:
        season = date.today().year
    key = f"player_stats:{player_id}:{season}:{group}"
    cached = cache.get(key)
    if cached:
        return cached

    stats = await mlb_api.get_player_season_stats(player_id, season, group)
    result = {"playerId": player_id, "season": season, "group": group, "stats": stats}
    cache.set(key, result, CACHE_TTL_PLAYER_STATS)
    return result


@router.get("/{player_id}/advanced")
async def player_advanced(player_id: int, season: int | None = None):
    """Get advanced Statcast metrics for a batter."""
    if season is None:
        season = date.today().year
    key = f"player_advanced:{player_id}:{season}"
    cached = cache.get(key)
    if cached:
        return cached

    advanced = await statcast.get_batter_advanced_stats(player_id, season)
    cache.set(key, advanced, CACHE_TTL_STATCAST)
    return advanced


@router.get("/{player_id}/arsenal")
async def player_arsenal(player_id: int, season: int | None = None):
    """Get pitch type arsenal breakdown for a pitcher."""
    if season is None:
        season = date.today().year
    key = f"player_arsenal:{player_id}:{season}"
    cached = cache.get(key)
    if cached:
        return cached

    arsenal = await statcast.get_pitch_arsenal(player_id, season)
    cache.set(key, arsenal, CACHE_TTL_STATCAST)
    return arsenal


@router.get("/{player_id}/dominance")
async def player_dominance(player_id: int, season: int | None = None):
    """Get pitcher dominance profile — splits by handedness, batted ball type, situational."""
    if season is None:
        season = date.today().year
    key = f"player_dominance:{player_id}:{season}"
    cached = cache.get(key)
    if cached:
        return cached

    profile = await statcast.get_dominance_profile(player_id, season)
    cache.set(key, profile, CACHE_TTL_STATCAST)
    return profile
