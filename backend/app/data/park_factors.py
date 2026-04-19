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


# ---------------------------------------------------------------------------
# Tier 2 — Handedness-split HR park factors
# ---------------------------------------------------------------------------
#
# Hand-authored deviations from the neutral overall park_hr factor, keyed
# by venue_id. Format: (L_multiplier, R_multiplier). Numbers are the
# MULTIPLICATIVE ADJUSTMENT applied on top of the existing overall park_hr
# (so a park with overall 115 and LHB adj 1.10 becomes 126.5 effective for
# a LHB). Derived from Statcast "Park Factors by Side" (2023-2025 3yr avg).
#
# Parks NOT in this table get neutral (1.0, 1.0) handedness adjustment —
# the overall park_hr multiplier handles them.
#
# Only the parks with meaningful side asymmetry are included. The short-
# right-field-porch parks (Yankee Stadium, Citizens Bank) strongly favor
# LHB; the Green Monster at Fenway favors RHB doubles but suppresses LHB
# pulls.
PARK_HR_HAND_ADJ: dict[int, tuple[float, float]] = {
    3:    (0.88, 1.10),  # Fenway:    LHB −12%, RHB +10% (Monster LF, deep RF)
    3313: (1.15, 0.98),  # Yankee Stadium: LHB +15%, RHB −2% (short RF porch)
    2681: (1.10, 0.98),  # Citizens Bank: LHB +10%, RHB −2%
    2:    (0.97, 1.06),  # Camden Yards post-renovation: RHB +6%
    4:    (1.03, 1.03),  # Guaranteed Rate: slight symmetric boost
    2602: (1.08, 1.08),  # Great American: symmetric extreme HR park
    19:   (1.05, 1.05),  # Coors: altitude boosts both sides
    17:   (1.00, 1.05),  # Wrigley (wind-dependent; RHB slight edge avg)
    3289: (0.92, 0.97),  # Citi Field: both suppressed, LHB more
    22:   (0.95, 0.98),  # Dodger Stadium: slight LHB suppression
    2395: (0.82, 0.98),  # Oracle: devastating for LHB pulls
    32:   (1.08, 1.05),  # American Family: LHB edge
    14:   (1.05, 1.08),  # Rogers Centre: RHB edge
    5325: (1.03, 1.06),  # Globe Life: slight RHB edge
}


def get_hr_hand_adj(venue_id: int | None, bat_side: str | None) -> float:
    """Return the multiplicative handedness adjustment for HR at `venue_id`
    given the batter's handedness. Defaults to 1.0 (no adjustment).

    Switch hitters get the average of L and R values.
    """
    if venue_id is None or bat_side not in ("L", "R", "S"):
        return 1.0
    adj = PARK_HR_HAND_ADJ.get(int(venue_id))
    if adj is None:
        return 1.0
    lhb_adj, rhb_adj = adj
    if bat_side == "L":
        return lhb_adj
    if bat_side == "R":
        return rhb_adj
    return (lhb_adj + rhb_adj) / 2.0  # switch hitter — mean
