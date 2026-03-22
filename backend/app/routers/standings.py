from datetime import date
from fastapi import APIRouter

from app.config import CACHE_TTL_STANDINGS, CACHE_TTL_PLAYOFFS
from app.services import cache
from app.services import mlb_api

router = APIRouter(prefix="/api/standings", tags=["standings"])


@router.get("")
async def standings(season: int | None = None):
    if season is None:
        season = date.today().year
    key = f"standings:{season}"
    cached = cache.get(key)
    if cached:
        return cached

    divisions = await mlb_api.get_standings(season)
    cache.set(key, divisions, CACHE_TTL_STANDINGS)
    return divisions


@router.get("/playoffs")
async def playoff_odds():
    key = "playoff_odds"
    cached = cache.get(key)
    if cached:
        return cached

    from app.services import fangraphs
    odds = await fangraphs.scrape_playoff_odds()
    result = {"teams": odds}
    cache.set(key, result, CACHE_TTL_PLAYOFFS)
    return result
