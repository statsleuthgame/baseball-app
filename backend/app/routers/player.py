from datetime import date
from fastapi import APIRouter

from app.config import CACHE_TTL_PLAYER_STATS
from app.services import cache
from app.services import mlb_api

router = APIRouter(prefix="/api/player", tags=["player"])


@router.get("/{player_id}/detail")
async def player_detail(player_id: int):
    key = f"player_detail:{player_id}"
    cached = cache.get(key)
    if cached:
        return cached

    detail = await mlb_api.get_player_detail(player_id)
    if not detail:
        return {"error": "Player not found"}
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
