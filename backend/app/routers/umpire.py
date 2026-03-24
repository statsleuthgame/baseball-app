from fastapi import APIRouter
from app.services import umpire as umpire_service
from app.services.cache import get as cache_get, set as cache_set

router = APIRouter()

CACHE_TTL = 60 * 60 * 24  # 24 hours — umpire data doesn't change intra-day


@router.get("/api/umpire/{umpire_name}")
async def get_umpire(umpire_name: str):
    """
    Return historical accuracy, zone tendencies, and run impact for a given umpire.
    Uses pybaseballstats umpire scorecards (data back to 2008).
    """
    cache_key = f"umpire:{umpire_name.lower().replace(' ', '_')}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    profile = await umpire_service.get_umpire_profile(umpire_name)
    cache_set(cache_key, profile, CACHE_TTL)
    return profile
