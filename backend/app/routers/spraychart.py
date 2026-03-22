import traceback
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.config import CACHE_TTL_STATCAST
from app.services import cache
from app.services import statcast

router = APIRouter(prefix="/api/spraychart", tags=["spraychart"])

# All 30 MLB venues with team abbreviation, name, and outfield dimensions
MLB_VENUES = [
    {"abbr": "ARI", "name": "Chase Field", "team": "Arizona Diamondbacks", "dimensions": {"LF": 330, "LCF": 374, "CF": 407, "RCF": 374, "RF": 334}},
    {"abbr": "ATL", "name": "Truist Park", "team": "Atlanta Braves", "dimensions": {"LF": 335, "LCF": 385, "CF": 400, "RCF": 375, "RF": 325}},
    {"abbr": "BAL", "name": "Oriole Park at Camden Yards", "team": "Baltimore Orioles", "dimensions": {"LF": 333, "LCF": 364, "CF": 400, "RCF": 373, "RF": 318}},
    {"abbr": "BOS", "name": "Fenway Park", "team": "Boston Red Sox", "dimensions": {"LF": 310, "LCF": 379, "CF": 390, "RCF": 380, "RF": 302}},
    {"abbr": "CHC", "name": "Wrigley Field", "team": "Chicago Cubs", "dimensions": {"LF": 355, "LCF": 368, "CF": 400, "RCF": 368, "RF": 353}},
    {"abbr": "CWS", "name": "Guaranteed Rate Field", "team": "Chicago White Sox", "dimensions": {"LF": 330, "LCF": 375, "CF": 400, "RCF": 375, "RF": 335}},
    {"abbr": "CIN", "name": "Great American Ball Park", "team": "Cincinnati Reds", "dimensions": {"LF": 328, "LCF": 379, "CF": 404, "RCF": 370, "RF": 325}},
    {"abbr": "CLE", "name": "Progressive Field", "team": "Cleveland Guardians", "dimensions": {"LF": 325, "LCF": 370, "CF": 400, "RCF": 375, "RF": 325}},
    {"abbr": "COL", "name": "Coors Field", "team": "Colorado Rockies", "dimensions": {"LF": 347, "LCF": 390, "CF": 415, "RCF": 375, "RF": 350}},
    {"abbr": "DET", "name": "Comerica Park", "team": "Detroit Tigers", "dimensions": {"LF": 345, "LCF": 370, "CF": 420, "RCF": 365, "RF": 330}},
    {"abbr": "HOU", "name": "Minute Maid Park", "team": "Houston Astros", "dimensions": {"LF": 315, "LCF": 366, "CF": 409, "RCF": 373, "RF": 326}},
    {"abbr": "KC", "name": "Kauffman Stadium", "team": "Kansas City Royals", "dimensions": {"LF": 330, "LCF": 387, "CF": 410, "RCF": 387, "RF": 330}},
    {"abbr": "LAA", "name": "Angel Stadium", "team": "Los Angeles Angels", "dimensions": {"LF": 330, "LCF": 387, "CF": 400, "RCF": 370, "RF": 330}},
    {"abbr": "LAD", "name": "Dodger Stadium", "team": "Los Angeles Dodgers", "dimensions": {"LF": 330, "LCF": 385, "CF": 395, "RCF": 385, "RF": 330}},
    {"abbr": "MIA", "name": "LoanDepot Park", "team": "Miami Marlins", "dimensions": {"LF": 344, "LCF": 386, "CF": 407, "RCF": 392, "RF": 335}},
    {"abbr": "MIL", "name": "American Family Field", "team": "Milwaukee Brewers", "dimensions": {"LF": 344, "LCF": 371, "CF": 400, "RCF": 374, "RF": 345}},
    {"abbr": "MIN", "name": "Target Field", "team": "Minnesota Twins", "dimensions": {"LF": 339, "LCF": 377, "CF": 404, "RCF": 367, "RF": 328}},
    {"abbr": "NYM", "name": "Citi Field", "team": "New York Mets", "dimensions": {"LF": 335, "LCF": 379, "CF": 408, "RCF": 375, "RF": 330}},
    {"abbr": "NYY", "name": "Yankee Stadium", "team": "New York Yankees", "dimensions": {"LF": 318, "LCF": 399, "CF": 408, "RCF": 385, "RF": 314}},
    {"abbr": "OAK", "name": "Oakland Coliseum", "team": "Oakland Athletics", "dimensions": {"LF": 330, "LCF": 362, "CF": 400, "RCF": 362, "RF": 330}},
    {"abbr": "PHI", "name": "Citizens Bank Park", "team": "Philadelphia Phillies", "dimensions": {"LF": 329, "LCF": 374, "CF": 401, "RCF": 369, "RF": 330}},
    {"abbr": "PIT", "name": "PNC Park", "team": "Pittsburgh Pirates", "dimensions": {"LF": 325, "LCF": 383, "CF": 399, "RCF": 375, "RF": 320}},
    {"abbr": "SD", "name": "Petco Park", "team": "San Diego Padres", "dimensions": {"LF": 336, "LCF": 390, "CF": 396, "RCF": 382, "RF": 322}},
    {"abbr": "SF", "name": "Oracle Park", "team": "San Francisco Giants", "dimensions": {"LF": 339, "LCF": 382, "CF": 399, "RCF": 365, "RF": 309}},
    {"abbr": "SEA", "name": "T-Mobile Park", "team": "Seattle Mariners", "dimensions": {"LF": 331, "LCF": 378, "CF": 405, "RCF": 381, "RF": 326}},
    {"abbr": "STL", "name": "Busch Stadium", "team": "St. Louis Cardinals", "dimensions": {"LF": 336, "LCF": 375, "CF": 400, "RCF": 375, "RF": 335}},
    {"abbr": "TB", "name": "Tropicana Field", "team": "Tampa Bay Rays", "dimensions": {"LF": 315, "LCF": 370, "CF": 404, "RCF": 370, "RF": 322}},
    {"abbr": "TEX", "name": "Globe Life Field", "team": "Texas Rangers", "dimensions": {"LF": 329, "LCF": 372, "CF": 407, "RCF": 374, "RF": 326}},
    {"abbr": "TOR", "name": "Rogers Centre", "team": "Toronto Blue Jays", "dimensions": {"LF": 328, "LCF": 375, "CF": 400, "RCF": 375, "RF": 328}},
    {"abbr": "WSH", "name": "Nationals Park", "team": "Washington Nationals", "dimensions": {"LF": 336, "LCF": 377, "CF": 402, "RCF": 370, "RF": 335}},
]


@router.get("/venues")
async def list_venues():
    """List all MLB venues with dimensions."""
    return MLB_VENUES


@router.get("/{player_id}")
async def spray_chart(player_id: int, homeTeam: str | None = None, season: int | None = None):
    """Get batted ball coordinates filtered by park (homeTeam abbreviation)."""
    key = f"spraychart:{player_id}:{homeTeam}:{season}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    try:
        data = await statcast.get_spray_chart_data(player_id, homeTeam, season)
        cache.set(key, data, CACHE_TTL_STATCAST)
        return data
    except Exception as e:
        return {"error": str(e), "hits": [], "summary": {}}
