from fastapi import APIRouter, HTTPException

from app.config import ALLOWED_TEAM_IDS, CACHE_TTL_HOT_PLAYERS
from app.services import cache
from app.services import mlb_api
from app.services import statcast

router = APIRouter(prefix="/api/hotplayers", tags=["hotplayers"])


@router.get("/{team_id}")
async def hot_players(team_id: int):
    """Get the hottest batters on a team over the last 14 days."""
    if team_id not in ALLOWED_TEAM_IDS:
        raise HTTPException(status_code=404, detail="Team not supported.")

    key = f"hotplayers:{team_id}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    # Get roster to find player IDs
    roster = await mlb_api.get_roster(team_id)
    # Filter to position players only
    position_player_ids = [
        p["id"] for p in roster
        if p.get("position", {}).get("type") != "Pitcher"
    ]

    hot = await statcast.get_hot_batters(position_player_ids, days=14)
    cache.set(key, hot, CACHE_TTL_HOT_PLAYERS)
    return hot
