from datetime import date
from fastapi import APIRouter, HTTPException

from app.config import ALLOWED_TEAM_IDS, CACHE_TTL_SCHEDULE, CACHE_TTL_TODAY
from app.services import cache
from app.services import mlb_api

router = APIRouter(prefix="/api/team", tags=["schedule"])


def _validate_team(team_id: int) -> None:
    if team_id not in ALLOWED_TEAM_IDS:
        raise HTTPException(status_code=404, detail="Team not supported.")


@router.get("/{team_id}/schedule")
async def schedule(team_id: int, season: int | None = None):
    _validate_team(team_id)
    if season is None:
        season = date.today().year
    key = f"schedule:{team_id}:{season}"
    cached = cache.get(key)
    if cached:
        return cached

    games = await mlb_api.get_schedule(team_id, season)
    cache.set(key, games, CACHE_TTL_SCHEDULE)
    return games


@router.get("/{team_id}/today")
async def today_game(team_id: int):
    _validate_team(team_id)
    key = f"today:{team_id}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    game = await mlb_api.get_next_game(team_id)
    result = game if game else {"noGame": True, "message": "No games scheduled in the next 14 days."}
    cache.set(key, result, CACHE_TTL_TODAY)
    return result
