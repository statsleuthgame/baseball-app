import os

MLB_API_BASE = "https://statsapi.mlb.com/api/v1"
MLB_PHOTOS_BASE = "https://img.mlbstatic.com/mlb-photos/image/upload"

ALLOWED_TEAM_IDS = {136, 144}  # Mariners, Braves

TEAM_META = {
    136: {
        "name": "Seattle Mariners",
        "abbreviation": "SEA",
        "venue_id": 680,
        "venue_name": "T-Mobile Park",
        "league": "AL",
        "division": "AL West",
        "division_id": 200,
        "primary_color": "#0C2C56",
        "secondary_color": "#005C5C",
        "accent_color": "#C4CED4",
    },
    144: {
        "name": "Atlanta Braves",
        "abbreviation": "ATL",
        "venue_id": 4705,
        "venue_name": "Truist Park",
        "league": "NL",
        "division": "NL East",
        "division_id": 204,
        "primary_color": "#13274F",
        "secondary_color": "#CE1141",
        "accent_color": "#EAAA00",
    },
}

# Cache TTLs in seconds
CACHE_TTL_ROSTER = 86400       # 24 hours
CACHE_TTL_TEAM_INFO = 604800   # 7 days
CACHE_TTL_SCHEDULE = 3600      # 1 hour
CACHE_TTL_TODAY = 900          # 15 minutes
CACHE_TTL_STANDINGS = 3600     # 1 hour
CACHE_TTL_PLAYOFFS = 21600     # 6 hours
CACHE_TTL_PLAYER_STATS = 3600  # 1 hour
CACHE_TTL_STATCAST = 86400     # 24 hours
CACHE_TTL_HOT_PLAYERS = 21600  # 6 hours

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
