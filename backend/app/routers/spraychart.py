from fastapi import APIRouter

from app.config import CACHE_TTL_STATCAST
from app.services import cache
from app.services import statcast

router = APIRouter(prefix="/api/spraychart", tags=["spraychart"])


@router.get("/{player_id}")
async def spray_chart(player_id: int, venue: int | None = None, season: int | None = None):
    """Get batted ball coordinates for spray chart visualization."""
    key = f"spraychart:{player_id}:{venue}:{season}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    data = await statcast.get_spray_chart_data(player_id, venue, season)
    cache.set(key, data, CACHE_TTL_STATCAST)
    return data
