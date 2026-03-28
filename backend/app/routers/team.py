from datetime import date
from fastapi import APIRouter, HTTPException

from app.config import ALLOWED_TEAM_IDS, TEAM_META, CACHE_TTL_ROSTER, CACHE_TTL_TEAM_INFO
from app.services import cache
from app.services import mlb_api

router = APIRouter(prefix="/api/team", tags=["team"])


def _validate_team(team_id: int) -> None:
    if team_id not in ALLOWED_TEAM_IDS:
        raise HTTPException(status_code=404, detail="Team not supported. Use 136 (Mariners) or 144 (Braves).")


@router.get("/{team_id}/info")
async def team_info(team_id: int):
    _validate_team(team_id)
    key = f"team_info:{team_id}"
    cached = cache.get(key)
    if cached:
        return cached

    info = await mlb_api.get_team_info(team_id)
    meta = TEAM_META.get(team_id, {})
    result = {
        **info,
        "colors": {
            "primary": meta.get("primary_color", "#333333"),
            "secondary": meta.get("secondary_color", "#666666"),
            "accent": meta.get("accent_color", "#999999"),
        },
    }
    cache.set(key, result, CACHE_TTL_TEAM_INFO)
    return result


@router.get("/{team_id}/roster")
async def roster(team_id: int, season: int | None = None):
    _validate_team(team_id)
    if season is None:
        season = date.today().year
    key = f"roster:{team_id}:{season}"
    cached = cache.get(key)
    if cached:
        return cached

    players = await mlb_api.get_roster(team_id, season)
    cache.set(key, players, CACHE_TTL_ROSTER)
    return players
