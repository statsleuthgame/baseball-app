"""
Park factors keyed by MLB venueId. 100 = league average.
Mirrors frontend/src/data/parkFactors.js so backend and frontend agree.
Source: ESPN / FanGraphs (updated annually).
"""

PARK_FACTORS: dict[int, dict] = {
    680:  {"name": "T-Mobile Park",              "runs": 95,  "hr": 96,  "label": "Pitcher Friendly"},
    4705: {"name": "Truist Park",                "runs": 102, "hr": 105, "label": "Slight Hitter"},
    15:   {"name": "Chase Field",                "runs": 106, "hr": 110, "label": "Hitter Friendly"},
    2:    {"name": "Camden Yards",               "runs": 103, "hr": 108, "label": "Slight Hitter"},
    3:    {"name": "Fenway Park",                "runs": 108, "hr": 99,  "label": "Hitter Friendly"},
    17:   {"name": "Wrigley Field",              "runs": 104, "hr": 107, "label": "Slight Hitter"},
    4:    {"name": "Guaranteed Rate Field",      "runs": 104, "hr": 110, "label": "Hitter Friendly"},
    2602: {"name": "Great American Ball Park",   "runs": 109, "hr": 116, "label": "Hitter Friendly"},
    5:    {"name": "Progressive Field",          "runs": 97,  "hr": 95,  "label": "Pitcher Friendly"},
    19:   {"name": "Coors Field",                "runs": 116, "hr": 118, "label": "Hitter Friendly"},
    2394: {"name": "Comerica Park",              "runs": 97,  "hr": 93,  "label": "Pitcher Friendly"},
    2392: {"name": "Minute Maid Park",           "runs": 103, "hr": 107, "label": "Slight Hitter"},
    7:    {"name": "Kauffman Stadium",           "runs": 101, "hr": 99,  "label": "Neutral"},
    1:    {"name": "Angel Stadium",              "runs": 97,  "hr": 96,  "label": "Pitcher Friendly"},
    22:   {"name": "Dodger Stadium",             "runs": 96,  "hr": 94,  "label": "Pitcher Friendly"},
    4169: {"name": "LoanDepot Park",             "runs": 95,  "hr": 91,  "label": "Pitcher Friendly"},
    32:   {"name": "American Family Field",      "runs": 103, "hr": 108, "label": "Slight Hitter"},
    3312: {"name": "Target Field",               "runs": 100, "hr": 101, "label": "Neutral"},
    3289: {"name": "Citi Field",                 "runs": 96,  "hr": 93,  "label": "Pitcher Friendly"},
    3313: {"name": "Yankee Stadium",             "runs": 107, "hr": 115, "label": "Hitter Friendly"},
    10:   {"name": "Oakland Coliseum",           "runs": 93,  "hr": 90,  "label": "Pitcher Friendly"},
    2681: {"name": "Citizens Bank Park",         "runs": 105, "hr": 112, "label": "Hitter Friendly"},
    31:   {"name": "PNC Park",                   "runs": 96,  "hr": 92,  "label": "Pitcher Friendly"},
    2680: {"name": "Petco Park",                 "runs": 95,  "hr": 93,  "label": "Pitcher Friendly"},
    2395: {"name": "Oracle Park",                "runs": 93,  "hr": 88,  "label": "Pitcher Friendly"},
    2889: {"name": "Busch Stadium",              "runs": 98,  "hr": 97,  "label": "Slight Pitcher"},
    12:   {"name": "Tropicana Field",            "runs": 96,  "hr": 98,  "label": "Pitcher Friendly"},
    5325: {"name": "Globe Life Field",           "runs": 104, "hr": 108, "label": "Slight Hitter"},
    14:   {"name": "Rogers Centre",              "runs": 104, "hr": 109, "label": "Hitter Friendly"},
    3309: {"name": "Nationals Park",             "runs": 100, "hr": 101, "label": "Neutral"},
}

NEUTRAL_PARK = {"name": "Unknown", "runs": 100, "hr": 100, "label": "Neutral"}


def get(venue_id: int | None) -> dict:
    """Lookup a park factor by venueId, falling back to neutral."""
    if venue_id is None:
        return NEUTRAL_PARK
    return PARK_FACTORS.get(int(venue_id), NEUTRAL_PARK)
