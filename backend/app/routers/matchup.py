from datetime import date
from fastapi import APIRouter

from app.config import CACHE_TTL_STATCAST, CACHE_TTL_SCHEDULE
from app.services import cache
from app.services import matchup as matchup_svc

router = APIRouter(prefix="/api/matchup", tags=["matchup"])


@router.get("/bvp")
async def batter_vs_pitcher(batterId: int, pitcherId: int):
    """Historical batter vs pitcher stats."""
    key = f"bvp:{batterId}:{pitcherId}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    result = await matchup_svc.get_batter_vs_pitcher(batterId, pitcherId)
    cache.set(key, result, CACHE_TTL_STATCAST)
    return result


@router.get("/pitch-type")
async def pitch_type_matchup(batterId: int, pitcherId: int):
    """How batter fares against each of the pitcher's pitch types."""
    key = f"pitch_type:{batterId}:{pitcherId}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    result = await matchup_svc.get_batter_vs_pitch_types(batterId, pitcherId)
    cache.set(key, result, CACHE_TTL_STATCAST)
    return result


@router.get("/park-history")
async def park_history(teamId: int, venueId: int):
    """Team's historical record at a specific ballpark."""
    key = f"park_history:{teamId}:{venueId}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    result = await matchup_svc.get_team_park_history(teamId, venueId)
    cache.set(key, result, CACHE_TTL_SCHEDULE)
    return result


@router.get("/prior")
async def prior_matchups(team1: int, team2: int, season: int | None = None):
    """Prior meeting results between two teams this season."""
    if season is None:
        season = date.today().year
    key = f"prior:{team1}:{team2}:{season}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    result = await matchup_svc.get_prior_matchups(team1, team2, season)
    cache.set(key, result, CACHE_TTL_SCHEDULE)
    return result
