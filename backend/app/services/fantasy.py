"""
Hitter Fantasy Score — PrizePicks Projection Model

Pure projection math + slate orchestration for the Edge tab's Fantasy
section. Scoring table is the OFFICIAL PrizePicks hitter scoring:

    1B=3, 2B=5, 3B=8, HR=10, R=2, RBI=2, BB=2, HBP=2, SB=5

No strikeout penalty for batters.

The projection for a hitter on a given day:

    EFP = PA × ( 3·s + 5·d + 8·t + 10·hr + 2·(bb+hbp) + 2·R/PA + 2·RBI/PA )
        + stolen_base_per_game

Per-event rates are blended L7 over season (0.3/0.7 default, sample-gated),
then nudged by BvP if enough sample (>= 5 PA, ramped to 20 PA), then
multiplied by park factors and a hard-coded weather physics multiplier
on HR rate (Alan Nathan baseball-physics: temp ≥ 85°F → HR ×1.05,
temp < 55°F → HR ×0.90, wind out → ×1.10, wind in → ×0.88).

R/PA ≈ OBP · r_coef; RBI/PA ≈ SLG · rbi_coef — the two coefs (r_coef,
rbi_coef) are tunable via `fantasy_weights.json`, which the Phase-2
backtest re-fits.

The module is intentionally side-effect-free at import time; the
`project_hitter_points` function is pure so it unit-tests cleanly, and
the async slate orchestrator is separate.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Optional

from app.services import mlb_api, prizepicks
from app.services.cache import get as cache_get, set as cache_set
from app.services.player_stats import compute_edge_z, get_player_stats
from app.services.statcast_features import (
    LEAGUE_SPRINT_SPEED,
    bvpt_matchup_xwoba as _bvpt_matchup_xwoba,
    get_batter_bvpt_xwoba_as_of,
    get_batter_features_as_of,
    get_batter_l7_features_as_of,
    get_pitcher_features_as_of,
    get_pitcher_pitch_mix_as_of,
    get_sprint_speed,
    lineup_context,
)
from app.data.park_factors import get as get_park_factor, get_hr_hand_adj

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Scoring constants — the OFFICIAL PrizePicks hitter table.
# ---------------------------------------------------------------------------

PP_SCORING = {
    "single":    3.0,
    "double":    5.0,
    "triple":    8.0,
    "home_run": 10.0,
    "run":       2.0,
    "rbi":       2.0,
    "walk":      2.0,
    "hbp":       2.0,
    "sb":        5.0,
}

# Weather multipliers (HR rate only). Published baseball-physics values,
# NOT tuned from backtest (backtest has no historical weather).
WEATHER_TEMP_HOT_THRESHOLD_F = 85.0
WEATHER_TEMP_COLD_THRESHOLD_F = 55.0
WEATHER_HR_MULT_HOT = 1.05
WEATHER_HR_MULT_COLD = 0.90

# Wind × batter-handedness table. MLB hitters pull the ball ~65% of the
# time on air contact, so wind blowing out to the pull side matters much
# more than wind to the opposite field. Values are HR-rate multipliers
# applied on top of temp and park factors.
#
#                    LHB    RHB    Switch / unknown
# Out To RF         1.15   1.03   1.09    (LHB pull side)
# Out To CF         1.08   1.08   1.08    (neutral)
# Out To LF         1.03   1.15   1.09    (RHB pull side)
# In  From RF       0.82   0.95   0.88
# In  From CF       0.90   0.90   0.90
# In  From LF       0.95   0.82   0.88
# Crosswind (L↔R)   1.00   1.00   1.00
# No wind / dome    1.00   1.00   1.00
WIND_HR_TABLE = {
    ("out", "rf"): {"L": 1.15, "R": 1.03, "S": 1.09, None: 1.09},
    ("out", "cf"): {"L": 1.08, "R": 1.08, "S": 1.08, None: 1.08},
    ("out", "lf"): {"L": 1.03, "R": 1.15, "S": 1.09, None: 1.09},
    ("in", "rf"):  {"L": 0.82, "R": 0.95, "S": 0.88, None: 0.88},
    ("in", "cf"):  {"L": 0.90, "R": 0.90, "S": 0.90, None: 0.90},
    ("in", "lf"):  {"L": 0.95, "R": 0.82, "S": 0.88, None: 0.88},
}

# ---------------------------------------------------------------------------
# Config / weight loading
# ---------------------------------------------------------------------------

_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
_WEIGHTS_PATH = _DATA_DIR / "fantasy_weights.json"
_LEAGUE_RATES_PATH = _DATA_DIR / "league_rates_2026.json"

_weights_cache: dict | None = None
_league_cache: dict | None = None


def load_weights() -> dict:
    global _weights_cache
    if _weights_cache is None:
        with _WEIGHTS_PATH.open() as f:
            _weights_cache = json.load(f)
    return _weights_cache


def load_league_rates() -> dict:
    global _league_cache
    if _league_cache is None:
        with _LEAGUE_RATES_PATH.open() as f:
            _league_cache = json.load(f)
    return _league_cache


def reset_caches_for_tests() -> None:
    """Test-only helper to force re-reading on-disk config."""
    global _weights_cache, _league_cache
    _weights_cache = None
    _league_cache = None


# ---------------------------------------------------------------------------
# Rate shape + derivation helpers
# ---------------------------------------------------------------------------

@dataclass
class Rates:
    """Per-PA rates used by the projection model."""
    singles: float
    doubles: float
    triples: float
    home_runs: float
    bb_hbp: float
    obp: float
    slg: float
    sb_per_game: float
    pa: int

    def as_dict(self) -> dict:
        return {
            "singles": self.singles,
            "doubles": self.doubles,
            "triples": self.triples,
            "home_runs": self.home_runs,
            "bb_hbp": self.bb_hbp,
            "obp": self.obp,
            "slg": self.slg,
            "sb_per_game": self.sb_per_game,
            "pa": self.pa,
        }


def _safe_div(num: float, den: float, default: float = 0.0) -> float:
    return num / den if den else default


def derive_rates_from_stat(stat: dict | None, games_played: int | None = None) -> Rates:
    """
    Turn a raw MLB stat row into per-PA Rates. Works with MLB Stats API's
    `splits[0].stat` shape (dict of camelCase strings/numbers).
    """
    s = stat or {}

    def f(key: str) -> float:
        v = s.get(key)
        if v is None or v == "":
            return 0.0
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0

    pa = int(f("plateAppearances") or 0)
    ab = int(f("atBats") or 0)
    hits = int(f("hits") or 0)
    doubles = int(f("doubles") or 0)
    triples = int(f("triples") or 0)
    hr = int(f("homeRuns") or 0)
    singles = max(0, hits - doubles - triples - hr)
    bb = int(f("baseOnBalls") or 0)
    hbp = int(f("hitByPitch") or 0)
    sb = int(f("stolenBases") or 0)

    obp = f("obp")
    slg = f("slg")

    gp = int(games_played or s.get("gamesPlayed") or 0)

    return Rates(
        singles=_safe_div(singles, pa),
        doubles=_safe_div(doubles, pa),
        triples=_safe_div(triples, pa),
        home_runs=_safe_div(hr, pa),
        bb_hbp=_safe_div(bb + hbp, pa),
        obp=obp,
        slg=slg,
        sb_per_game=_safe_div(sb, gp),
        pa=pa,
    )


# ---------------------------------------------------------------------------
# Pure projection — THE function the backtest calls too.
# ---------------------------------------------------------------------------

def _blend_l7(season_rate: float, l7_rate: float, l7_pa: int, weights: dict) -> float:
    """
    Shrink L7 toward season. When L7 has < l7_min_pa plate appearances we
    trust season entirely (L7 noise dominates).
    """
    if l7_pa < weights.get("l7_min_pa", 10):
        return season_rate
    blend = float(weights.get("l7_blend", 0.30))
    return (1.0 - blend) * season_rate + blend * l7_rate


def _bvp_multiplier(
    batter_rate: float,
    league_rate: float,
    bvp_rate: float,
    bvp_pa: int,
    weights: dict,
) -> float:
    """
    Multiplicative nudge based on BvP deviation from league rate. Sample
    weighted 0 below 5 PA, linear to full at 20 PA.
    """
    if league_rate <= 0 or bvp_rate is None:
        return 1.0
    floor = weights.get("bvp_blend_ramp_floor", 5)
    ceil = weights.get("bvp_min_pa", 20)
    if bvp_pa < floor:
        return 1.0
    ramp = 1.0 if bvp_pa >= ceil else (bvp_pa - floor) / max(1, ceil - floor)
    blend = float(weights.get("bvp_blend", 0.20))
    cap = float(weights.get("bvp_multiplier_cap", 0.25))
    deviation = (bvp_rate - league_rate) / league_rate
    mult = 1.0 + ramp * blend * deviation
    return max(1.0 - cap, min(1.0 + cap, mult))


def _parse_wind_direction(wind_str: str) -> tuple[str, str] | None:
    """
    Parse MLB's wind descriptor into ('in'|'out', 'rf'|'cf'|'lf') or None.

    Real examples seen from MLB Stats API:
      '10 mph, Out To CF'  → ('out', 'cf')
      '8 mph, In From LF'  → ('in',  'lf')
      '5 mph, L To R'      → None  (crosswind)
      'Wind 0 mph'         → None
      '0 mph'              → None
      ''                   → None
    """
    w = (wind_str or "").lower()
    if not w:
        return None
    # Wind speed of 0 → no effect. Use a word-boundary match so "10 mph" doesn't trip it.
    speed_match = re.search(r"(?<!\d)(\d+)\s*mph", w)
    if speed_match and int(speed_match.group(1)) == 0:
        return None
    if "out" in w and "to" in w:
        axis = "out"
    elif "in" in w and "from" in w:
        axis = "in"
    else:
        return None  # crosswind / unknown
    for field in ("rf", "cf", "lf"):
        if field in w:
            return axis, field
    # If we got "Out To" but no explicit field direction, treat as CF
    # (neutral boost rather than guessing).
    return axis, "cf"


def _weather_hr_multiplier(weather: dict | None, bat_side: str | None = None) -> float:
    """
    HR-rate multiplier from temp and wind. Handedness-aware when bat_side
    is known (L/R/S); otherwise uses the neutral "unknown" column which
    averages across batting sides.
    """
    if not weather:
        return 1.0

    mult = 1.0
    # Temp
    temp = weather.get("temp")
    try:
        if temp is not None:
            temp_f = float(temp)
            if temp_f >= WEATHER_TEMP_HOT_THRESHOLD_F:
                mult *= WEATHER_HR_MULT_HOT
            elif temp_f < WEATHER_TEMP_COLD_THRESHOLD_F:
                mult *= WEATHER_HR_MULT_COLD
    except (TypeError, ValueError):
        pass

    # Wind
    parsed = _parse_wind_direction(weather.get("wind") or "")
    if parsed is not None:
        hand_key = bat_side if bat_side in ("L", "R", "S") else None
        table = WIND_HR_TABLE.get(parsed)
        if table is not None:
            mult *= table.get(hand_key, table[None])
    return mult


def _clamp_pa(projected_pa: float, weights: dict) -> float:
    floor = float(weights.get("pa_floor", 3.0))
    ceil = float(weights.get("pa_ceil", 5.2))
    return max(floor, min(ceil, projected_pa))


def _tier(efp: float, weights: dict) -> str:
    if efp >= float(weights.get("tier_high", 11.0)):
        return "high"
    if efp >= float(weights.get("tier_medium", 8.0)):
        return "medium"
    return "low"


def project_hitter_points(
    *,
    season_rates: Rates,
    l7_rates: Rates | None,
    bvp: dict | None,
    league_rates: dict,
    park: dict,
    weather: dict | None,
    projected_pa: float,
    weights: dict,
    bat_side: str | None = None,
    pitcher_rates: dict | None = None,
    lineup_slot: int | None = None,
    platoon_rates: dict | None = None,
    team_runs_per_game: float | None = None,
    batter_stx: dict | None = None,
    batter_stx_l7: dict | None = None,
    pitcher_stx: dict | None = None,
    sprint_speed: float | None = None,
    venue_id: int | None = None,
    bvpt_matchup_xwoba: float | None = None,
    batter_season_xwoba: float | None = None,
    preceding_obp: float | None = None,
    ondeck_xwoba: float | None = None,
) -> dict:
    """
    Pure projection function. Returns a dict:
        {
          "efp": float,
          "per_event": {singles, doubles, triples, home_runs, bb_hbp, r, rbi, sb},
          "multipliers": {park_hr, park_runs, weather_hr},
          "rates": effective per-PA rates used,
          "pa": clamped PA,
          "tier": "high"|"medium"|"low",
        }
    """
    # 1. Base rate blend (League ← Season ← L7 ← Platoon).
    #
    # Small-sample Bayesian shrinkage: pull the batter's observed season
    # rate toward the league rate when their season PA is small. Prevents
    # April hot-start over-projection (e.g. a 30-PA player with 4 HRs has
    # a "season" HR/PA of 0.133 = 4× league — would otherwise bake into
    # the projection with no regression).
    #
    # Formula (per Tom Tango's "regression to the mean" stabilization):
    #     effective = (pa × observed + prior_pa × league) / (pa + prior_pa)
    #
    # prior_pa ≈ the PA count where half the batter's rate comes from
    # observed and half from league. Set conservatively (150 PA) so
    # April hot starts get meaningfully regressed through early May.
    prior_pa = float(weights.get("rate_regression_prior_pa", 150))
    league_per_pa = (league_rates or {}).get("per_pa") or {}
    league_per_pa_map = {
        "singles": float(league_per_pa.get("singles", 0.144)),
        "doubles": float(league_per_pa.get("doubles", 0.045)),
        "triples": float(league_per_pa.get("triples", 0.004)),
        "home_runs": float(league_per_pa.get("home_runs", 0.033)),
        "bb_hbp": float(league_per_pa.get("bb_hbp", 0.096)),
    }
    season_pa_count = int(getattr(season_rates, "pa", 0) or 0)

    def shrink_season(key: str) -> float:
        """Pull the season rate toward league mean by prior_pa."""
        observed = getattr(season_rates, key)
        if prior_pa <= 0 or season_pa_count <= 0:
            return observed
        league_rate = league_per_pa_map.get(key, observed)
        return (
            (season_pa_count * observed + prior_pa * league_rate)
            / (season_pa_count + prior_pa)
        )

    def blend(key: str) -> float:
        season_v = shrink_season(key)
        l7_v = getattr(l7_rates, key) if l7_rates else 0.0
        l7_pa = l7_rates.pa if l7_rates else 0
        base = _blend_l7(season_v, l7_v, l7_pa, weights)
        # Platoon blend — batter's rate vs the opposing pitcher's hand.
        # Applied as an additional weighted blend on top of the season+L7
        # output: new = (1 - pb) * base + pb * platoon_v, when sample is
        # big enough (platoon_rates only populated when PA ≥ 30).
        if platoon_rates and key in platoon_rates:
            pb = float(weights.get("platoon_blend", 0.20))
            platoon_v = float(platoon_rates.get(key) or 0.0)
            base = (1.0 - pb) * base + pb * platoon_v
        return base

    singles = blend("singles")
    doubles = blend("doubles")
    triples = blend("triples")
    home_runs = blend("home_runs")
    bb_hbp = blend("bb_hbp")

    # 2. BvP nudge — one multiplier applied to BA-like rates (1B+2B+3B+HR) and
    #    a separate one for HR specifically via the HR rate in BvP.
    if bvp and bvp.get("pa"):
        pp_bvp = league_rates.get("per_pa", {})
        league_ba = league_rates.get("ba", 0.244)
        league_hr = pp_bvp.get("home_runs", 0.033)
        bvp_pa = int(bvp.get("pa") or 0)
        bvp_ab = int(bvp.get("ab") or 0)
        bvp_hits = int(bvp.get("hits") or 0)
        bvp_hr = int(bvp.get("home_runs") or bvp.get("homeRuns") or 0)
        bvp_ba = _safe_div(bvp_hits, bvp_ab)
        bvp_hr_per_pa = _safe_div(bvp_hr, bvp_pa)
        contact_mult = _bvp_multiplier(0, league_ba, bvp_ba, bvp_pa, weights)
        hr_mult_bvp = _bvp_multiplier(0, league_hr, bvp_hr_per_pa, bvp_pa, weights)
        singles *= contact_mult
        doubles *= contact_mult
        triples *= contact_mult
        home_runs *= hr_mult_bvp
    # bb_hbp is not nudged by BvP — walk/HBP tendencies are more about the
    # pitcher's control profile, which isn't in our BvP input.

    # 3. Park factors (runs on non-HR hits, hr on HR)
    park_runs = float(park.get("runs", 100)) / 100.0
    park_hr = float(park.get("hr", 100)) / 100.0
    singles *= park_runs
    doubles *= park_runs
    triples *= park_runs
    home_runs *= park_hr

    # 4. Weather HR multiplier — handedness-aware when bat_side is known.
    weather_hr = _weather_hr_multiplier(weather, bat_side=bat_side)
    home_runs *= weather_hr

    # 4b. Opposing pitcher quality — exponents are tunable via weights
    # (fit by the backtest). exp=0 disables the feature; higher exp makes
    # it more aggressive.
    pitcher_hits_mult, pitcher_hr_mult = _pitcher_multipliers(
        pitcher_rates, league_rates, weights=weights
    )
    singles *= pitcher_hits_mult
    doubles *= pitcher_hits_mult
    triples *= pitcher_hits_mult
    home_runs *= pitcher_hr_mult

    # 4c. Tier 1 — Statcast expected-stats regression.
    # Adjusts outcome rates toward the batter's underlying skill signal
    # (barrel%, xwOBA, hard-hit%). A batter whose outcome HR rate exceeds
    # his barrel skill gets regressed DOWN; a batter whose barrel skill
    # exceeds his outcome gets boosted. Exponents tunable via weights;
    # 0 disables.
    (
        xwoba_mult, barrel_mult, hardhit_mult,
    ) = _statcast_expected_multipliers(
        batter_stx, batter_stx_l7, league_rates, weights
    )
    # HR rate gated by barrel skill (barrel% is the best single predictor
    # of HR regression).
    home_runs *= barrel_mult
    # Non-HR hit rates gated by hard-hit% (contact quality → BA on balls
    # in play) and xwOBA-on-contact (captures what the batter "deserved").
    singles *= hardhit_mult * xwoba_mult
    doubles *= hardhit_mult * xwoba_mult
    triples *= hardhit_mult * xwoba_mult

    # 4d. Tier 1 — pitcher GB%/FB% gating on HR probability. High-GB
    # pitchers (sinker-ballers) suppress HRs beyond what raw HR/BF shows
    # because their batted-ball profile prevents the fly balls needed for
    # HR outcomes.
    pitcher_gb_hr_mult = _pitcher_gb_hr_multiplier(pitcher_stx, league_rates, weights)
    home_runs *= pitcher_gb_hr_mult

    # 4e. Tier 1 — K-damper. Both pitcher K% and batter K% feed into the
    # likelihood of any given PA ending in a 0-point strikeout. This damps
    # the ENTIRE projection proportionally since K outcomes replace
    # whatever hit / walk would have happened.
    k_damper = _k_damper(batter_stx, pitcher_stx, league_rates, weights)
    singles *= k_damper
    doubles *= k_damper
    triples *= k_damper
    home_runs *= k_damper
    # bb_hbp is also damped by the K-product (a strikeout PA can't become
    # a walk PA).
    bb_hbp *= k_damper

    # 4f. Tier 2 — Pitcher BB% boost on batter walks. A pitcher with
    # elevated BB% feeds the batter more free bases. Applied directly to
    # bb_hbp rate; tunable exponent.
    pitcher_bb_mult = _pitcher_bb_multiplier(pitcher_stx, league_rates, weights)
    bb_hbp *= pitcher_bb_mult

    # 4g. Tier 2 — Handedness-split park factor for HR. An extra
    # multiplicative adjustment on top of the overall park_hr, tuned per
    # park × batter handedness (Fenway LHB gets suppressed, YS LHB gets
    # boosted, Oracle LHB really gets crushed, etc.).
    park_hand_mult = _park_hand_multiplier(venue_id, bat_side, weights)
    home_runs *= park_hand_mult

    # 4h. Tier 2 — Sprint speed effects. Fast batters get:
    #   - Boosted SB rate (big effect)
    #   - Small boost to singles (infield hits)
    #   - Small boost to R/PA (extra-base taking from 1B)
    # Applied via exponents tunable in weights; missing sprint speed =
    # neutral. League avg ~27.0 ft/sec; elite is 29.5+, slow is 25.0.
    sb_speed_mult, speed_singles_mult, speed_r_mult = _sprint_speed_multipliers(
        sprint_speed, weights
    )
    singles *= speed_singles_mult

    # 4i. Tier 3 — BvPT (Batter vs Pitch-Type) matchup multiplier.
    # Weighted xwOBA of this batter against THIS pitcher's mix vs the
    # batter's overall xwOBA. Ratio > 1 = favorable matchup, < 1 = tough.
    # Applied to hit rates (singles/doubles/triples/HR together).
    bvpt_mult = _bvpt_multiplier(
        bvpt_matchup_xwoba, batter_season_xwoba, weights
    )
    singles *= bvpt_mult
    doubles *= bvpt_mult
    triples *= bvpt_mult
    home_runs *= bvpt_mult

    # 5. R and RBI projections — OBP / SLG proxies
    # Apply the same small-sample shrinkage to OBP/SLG so hot-start
    # batters don't get inflated R/RBI projections off a 20-PA .450 OBP.
    r_coef = float(weights.get("r_per_pa_coef", 0.35))
    rbi_coef = float(weights.get("rbi_per_pa_coef", 0.25))
    obp_base = season_rates.obp or 0.0
    slg_base = season_rates.slg or 0.0
    if prior_pa > 0 and season_pa_count > 0:
        lg_obp = float((league_rates or {}).get("obp", 0.314))
        lg_slg = float((league_rates or {}).get("slg", 0.399))
        obp_base = (
            (season_pa_count * obp_base + prior_pa * lg_obp)
            / (season_pa_count + prior_pa)
        )
        slg_base = (
            (season_pa_count * slg_base + prior_pa * lg_slg)
            / (season_pa_count + prior_pa)
        )
    if l7_rates and l7_rates.pa >= weights.get("l7_min_pa", 10):
        blend_r = float(weights.get("l7_blend", 0.30))
        obp_base = (1.0 - blend_r) * obp_base + blend_r * (l7_rates.obp or 0.0)
        slg_base = (1.0 - blend_r) * slg_base + blend_r * (l7_rates.slg or 0.0)
    r_per_pa = obp_base * r_coef
    rbi_per_pa = slg_base * rbi_coef

    # Lineup-slot adjustment. Cleanup / middle-of-order batters see more
    # RBI opportunities; top-of-order batters score more runs. slot_effect_scale
    # is tunable by the backtest fit — 0 disables slot entirely, 1 uses
    # the tables as-written, values in between are partial effect.
    slot_r_mult = 1.0
    slot_rbi_mult = 1.0
    slot_scale = float(weights.get("slot_effect_scale", 1.0))
    if lineup_slot is not None and slot_scale != 0:
        r_table = weights.get("lineup_slot_r_mult") or {}
        rbi_table = weights.get("lineup_slot_rbi_mult") or {}
        r_raw = float(r_table.get(str(int(lineup_slot)), 1.0))
        rbi_raw = float(rbi_table.get(str(int(lineup_slot)), 1.0))
        slot_r_mult = 1.0 + slot_scale * (r_raw - 1.0)
        slot_rbi_mult = 1.0 + slot_scale * (rbi_raw - 1.0)
    r_per_pa *= slot_r_mult
    rbi_per_pa *= slot_rbi_mult

    # Team run environment — a hitter's R and RBI opportunities scale with
    # how often their lineup mates get on base and drive runs. Dodgers
    # hitters score more than Rockies hitters controlling for personal
    # skill. Exponents tunable via fantasy_weights.json; 0 disables.
    team_env_r_mult = 1.0
    team_env_rbi_mult = 1.0
    if team_runs_per_game and team_runs_per_game > 0:
        lg_rpg = float(league_rates.get("team_runs_per_game", 4.35)) or 4.35
        ratio = team_runs_per_game / lg_rpg
        r_exp = float(weights.get("team_run_env_exp", 1.0))
        rbi_exp = float(weights.get("team_rbi_env_exp", 0.5))
        if r_exp > 0:
            team_env_r_mult = ratio ** r_exp
        if rbi_exp > 0:
            team_env_rbi_mult = ratio ** rbi_exp
        # Cap ±25% so a Colorado-at-altitude team in a wild season can't
        # sling an individual hitter's R off a cliff.
        team_env_r_mult = max(0.75, min(1.25, team_env_r_mult))
        team_env_rbi_mult = max(0.80, min(1.20, team_env_rbi_mult))
    r_per_pa *= team_env_r_mult
    rbi_per_pa *= team_env_rbi_mult

    # Tier 2 — Sprint speed also nudges R/PA (fast batters take more
    # extra bases once on base). Applied AFTER slot + team env.
    r_per_pa *= speed_r_mult

    # Tier 3 — Real lineup context.
    # A batter's R/PA scales with the ON-DECK batter's wOBA (he drives
    # you in); RBI/PA scales with the PRECEDING batters' OBP (they're
    # on base when you bat).
    ondeck_r_mult, preceding_rbi_mult = _lineup_context_multipliers(
        ondeck_xwoba, preceding_obp, league_rates, weights
    )
    r_per_pa *= ondeck_r_mult
    rbi_per_pa *= preceding_rbi_mult

    # 6. PA and final EFP
    pa = _clamp_pa(projected_pa, weights)

    # SB projection — weighted blend consistent with the other rates, plus
    # two matchup multipliers:
    #   - Opposing LHP suppresses SB rate ~20% (better pickoff + shorter lead)
    #   - Lineup slots 1-2 boost SB rate (more baserunning opportunities); 7-9 shrink.
    sb_season = season_rates.sb_per_game or 0.0
    if l7_rates and l7_rates.pa >= weights.get("l7_min_pa", 10):
        pb = float(weights.get("l7_blend", 0.30))
        sb_proj = (1.0 - pb) * sb_season + pb * (l7_rates.sb_per_game or 0.0)
    else:
        sb_proj = sb_season

    # Pitcher-hand SB hold: inferred from pitcher_rates (rates dict has
    # no 'hand' field, so we pass it via weights-addressable sidecar).
    # Simplest: let the orchestrator pass pitcher hand through. Use the
    # platoon hand inference here via a new dedicated arg is cleaner —
    # wiring that in a follow-up tweak. For now, apply slot + static pitcher.
    sb_slot_mult = 1.0
    if lineup_slot is not None:
        sb_table = weights.get("lineup_slot_sb_mult") or {}
        sb_slot_mult = float(sb_table.get(str(int(lineup_slot)), 1.0))
    sb_proj *= sb_slot_mult

    # LHP suppression — if the opposing pitcher's hand is exposed via
    # pitcher_rates["hand"] (Phase B wiring sets this), apply it.
    sb_pitcher_mult = 1.0
    if pitcher_rates and pitcher_rates.get("hand") == "L":
        sb_pitcher_mult = float(weights.get("sb_lhp_mult", 0.80))
    sb_proj *= sb_pitcher_mult

    # Tier 2 — Sprint speed SB boost (the biggest effect of the speed
    # trio). Already-fast guys with low sb_per_game in season stats get
    # projected higher SB attempts vs a weak matchup.
    sb_proj *= sb_speed_mult

    efp = pa * (
        PP_SCORING["single"] * singles
        + PP_SCORING["double"] * doubles
        + PP_SCORING["triple"] * triples
        + PP_SCORING["home_run"] * home_runs
        + PP_SCORING["walk"] * bb_hbp
        + PP_SCORING["run"] * r_per_pa
        + PP_SCORING["rbi"] * rbi_per_pa
    ) + PP_SCORING["sb"] * sb_proj

    # Global calibration scale — fit on the 30-day backtest to align the
    # model's average top-6 projection with actual top-6 production
    # (model ran ~14% high on the displayed numbers, even while ranking
    # correctly). This scale multiplies the entire projected EFP so the
    # ranking is preserved but absolute numbers match reality.
    cal = float(weights.get("calibration_scale", 1.0))
    if cal > 0 and cal != 1.0:
        efp *= cal

    return {
        "efp": round(efp, 2),
        "bat_side": bat_side,
        "per_event": {
            "singles": round(pa * PP_SCORING["single"] * singles, 2),
            "doubles": round(pa * PP_SCORING["double"] * doubles, 2),
            "triples": round(pa * PP_SCORING["triple"] * triples, 2),
            "home_runs": round(pa * PP_SCORING["home_run"] * home_runs, 2),
            "bb_hbp": round(pa * PP_SCORING["walk"] * bb_hbp, 2),
            "r": round(pa * PP_SCORING["run"] * r_per_pa, 2),
            "rbi": round(pa * PP_SCORING["rbi"] * rbi_per_pa, 2),
            "sb": round(PP_SCORING["sb"] * sb_proj, 2),
        },
        "multipliers": {
            "park_hr": round(park_hr, 3),
            "park_runs": round(park_runs, 3),
            "weather_hr": round(weather_hr, 3),
            "pitcher_hits": round(pitcher_hits_mult, 3),
            "pitcher_hr": round(pitcher_hr_mult, 3),
            "slot_r": round(slot_r_mult, 3),
            "slot_rbi": round(slot_rbi_mult, 3),
            "team_env_r": round(team_env_r_mult, 3),
            "team_env_rbi": round(team_env_rbi_mult, 3),
            # Tier 1 — Statcast expected + K-damper
            "stx_xwoba": round(xwoba_mult, 3),
            "stx_barrel": round(barrel_mult, 3),
            "stx_hardhit": round(hardhit_mult, 3),
            "pitcher_gb_hr": round(pitcher_gb_hr_mult, 3),
            "k_damper": round(k_damper, 3),
            # Tier 2 — Sprint speed + pitcher BB% + park handedness
            "pitcher_bb": round(pitcher_bb_mult, 3),
            "park_hand_hr": round(park_hand_mult, 3),
            "sb_speed": round(sb_speed_mult, 3),
            "speed_singles": round(speed_singles_mult, 3),
            "speed_r": round(speed_r_mult, 3),
            # Tier 3 — BvPT + lineup context
            "bvpt": round(bvpt_mult, 3),
            "ondeck_r": round(ondeck_r_mult, 3),
            "preceding_rbi": round(preceding_rbi_mult, 3),
        },
        "rates": {
            "singles": round(singles, 4),
            "doubles": round(doubles, 4),
            "triples": round(triples, 4),
            "home_runs": round(home_runs, 4),
            "bb_hbp": round(bb_hbp, 4),
            "r_per_pa": round(r_per_pa, 4),
            "rbi_per_pa": round(rbi_per_pa, 4),
        },
        "pa": round(pa, 2),
        "tier": _tier(efp, weights),
    }


# ---------------------------------------------------------------------------
# Slate orchestration — fan out against MLB Stats API to project today.
# ---------------------------------------------------------------------------

_SEASON_STATS_TTL = 60 * 30
_L7_STATS_TTL = 60 * 15
_SCHEDULE_TTL = 60 * 10
_SLATE_TTL = 60 * 5
_CONCURRENCY_LIMIT = 8


def _today_iso() -> str:
    return date.today().isoformat()


async def _noop_none():
    """Returns None. Used as a no-op filler inside asyncio.gather when a
    conditional awaitable would otherwise short the tuple unpacking."""
    return None


async def _fetch_season_stats(player_id: int, season: int) -> dict | None:
    cache_key = f"fantasy:seasonStats:{player_id}:{season}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    data = await mlb_api.fetch(
        f"/people/{player_id}/stats",
        params={"stats": "season", "group": "hitting", "season": season},
    )
    splits = (data.get("stats") or [{}])[0].get("splits") or []
    stat = splits[0].get("stat") if splits else None
    if stat:
        cache_set(cache_key, stat, _SEASON_STATS_TTL)
    return stat


async def _fetch_team_run_env(team_id: int, season: int) -> dict | None:
    """
    Return the team's season-to-date offensive environment as runs per
    game. Used to scale an individual batter's R and RBI projections —
    a hitter on a strong offense gets more R/RBI chances than the same
    hitter on a weak one.

    Shape: { "runs_per_game": float, "games": int }
    """
    if not team_id:
        return None
    cache_key = f"fantasy:teamRPG:{team_id}:{season}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached or None
    data = await mlb_api.fetch(
        f"/teams/{team_id}/stats",
        params={"stats": "season", "group": "hitting", "season": season},
    )
    splits = (data.get("stats") or [{}])[0].get("splits") or []
    stat = splits[0].get("stat") if splits else None
    if not stat:
        cache_set(cache_key, {}, 60 * 60 * 6)
        return None
    try:
        runs = float(stat.get("runs") or 0)
        games = int(float(stat.get("gamesPlayed") or 0))
    except (TypeError, ValueError):
        return None
    if games < 5:
        cache_set(cache_key, {}, 60 * 60 * 6)
        return None
    result = {"runs_per_game": runs / games, "games": games}
    cache_set(cache_key, result, 60 * 60 * 6)
    return result


async def _fetch_pitcher_rates(player_id: int, season: int) -> dict | None:
    """
    Return the opposing pitcher's season per-BF rates, or None if unknown.
    Used to adjust hitter base rates based on pitcher quality (Phase A of
    the richer-features model).

    Shape: { "h_per_bf": float, "hr_per_bf": float, "k_per_bf": float,
             "bb_per_bf": float, "bf": int }
    """
    if not player_id:
        return None
    cache_key = f"fantasy:pitcherRates:{player_id}:{season}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached or None  # sentinel empty dict means "known unknown"
    data = await mlb_api.fetch(
        f"/people/{player_id}/stats",
        params={"stats": "season", "group": "pitching", "season": season},
    )
    splits = (data.get("stats") or [{}])[0].get("splits") or []
    stat = splits[0].get("stat") if splits else None
    if not stat:
        cache_set(cache_key, {}, _SEASON_STATS_TTL)
        return None

    def f(key: str) -> float:
        v = stat.get(key)
        if v is None or v == "":
            return 0.0
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0

    # Batters faced: MLB returns `battersFaced`; fall back to plate appearances
    # and then to IP-derived estimate (IP × 4.3) as last resort.
    bf = int(f("battersFaced") or f("plateAppearances") or 0)
    if bf < 10:
        ip = f("inningsPitched")
        if ip > 0:
            bf = int(round(ip * 4.3))
    if bf < 10:
        # Not enough data to project from — signal unknown.
        cache_set(cache_key, {}, _SEASON_STATS_TTL)
        return None

    rates = {
        "h_per_bf": f("hits") / bf if bf else 0.0,
        "hr_per_bf": f("homeRuns") / bf if bf else 0.0,
        "k_per_bf": f("strikeOuts") / bf if bf else 0.0,
        "bb_per_bf": f("baseOnBalls") / bf if bf else 0.0,
        "bf": bf,
    }
    cache_set(cache_key, rates, _SEASON_STATS_TTL)
    return rates


# Multiplier caps — clamp extreme pitcher matchups so no single batter's
# projection is overwhelmed by the pitcher term. Values picked so a very
# bad pitcher (2× league HR rate) caps at ~+35%.
_PITCHER_HITS_MULT_CAP = 0.30
_PITCHER_HR_MULT_CAP = 0.35
_PITCHER_MIN_BF_FOR_TRUST = 60  # shrink toward 1.0 below this


def _pitcher_multipliers(
    pitcher_rates: dict | None,
    league_rates: dict,
    weights: dict | None = None,
) -> tuple[float, float]:
    """
    Return (hit_rate_mult, hr_rate_mult) applied on top of park/weather.
    Uses tunable exponents from fantasy_weights.json so the backtest fit
    can turn the feature up or down (exp=0 disables it entirely).
    Degrades gracefully:
      - Unknown pitcher → (1.0, 1.0)
      - Small sample (< 60 BF) → shrink toward 1.0 by the sample-size ratio.
    """
    if not pitcher_rates:
        return 1.0, 1.0
    pp = league_rates.get("pitcher_per_bf", {})
    lg_h = float(pp.get("hits_allowed", 0.222)) or 0.222
    lg_hr = float(pp.get("home_runs_allowed", 0.029)) or 0.029
    p_h = pitcher_rates.get("h_per_bf") or 0.0
    p_hr = pitcher_rates.get("hr_per_bf") or 0.0
    if p_h <= 0 or p_hr <= 0:
        return 1.0, 1.0

    # Exponents come from the calibrated weights; defaults match the
    # original hand-picked values if weights are missing.
    hits_exp = float((weights or {}).get("pitcher_hits_exp", 0.6))
    hr_exp = float((weights or {}).get("pitcher_hr_exp", 0.7))

    raw_hits_mult = (p_h / lg_h) ** hits_exp if hits_exp > 0 else 1.0
    raw_hr_mult = (p_hr / lg_hr) ** hr_exp if hr_exp > 0 else 1.0

    # Sample-size shrink: below 60 BF, pull the multiplier toward 1.0.
    bf = pitcher_rates.get("bf") or 0
    trust = min(1.0, bf / _PITCHER_MIN_BF_FOR_TRUST)
    hits_mult = 1.0 + trust * (raw_hits_mult - 1.0)
    hr_mult = 1.0 + trust * (raw_hr_mult - 1.0)

    # Cap extremes.
    hits_mult = max(1.0 - _PITCHER_HITS_MULT_CAP, min(1.0 + _PITCHER_HITS_MULT_CAP, hits_mult))
    hr_mult = max(1.0 - _PITCHER_HR_MULT_CAP, min(1.0 + _PITCHER_HR_MULT_CAP, hr_mult))
    return hits_mult, hr_mult


# ---------------------------------------------------------------------------
# Tier 1 — Statcast expected-stats + K-damper helpers
# ---------------------------------------------------------------------------

# Caps on Tier 1 multipliers. Batter-expected regression is capped tighter
# than pitcher-quality because expected stats stabilize faster and we
# trust them to move the needle more cleanly — but still cap to avoid
# blow-outs for early-season small samples.
_STX_XWOBA_CAP = 0.20    # ±20% on non-HR hit rates
_STX_BARREL_CAP = 0.35   # ±35% on HR rate
_STX_HARDHIT_CAP = 0.15  # ±15% on non-HR hit rates
_STX_GB_HR_CAP = 0.25    # ±25% on HR rate from pitcher GB mix
_STX_K_DAMPER_CAP = 0.15 # ±15% on overall rates from K-product

# Sample-size shrink thresholds. Below these, we pull the multiplier
# toward 1.0 proportionally. Barrel%/xwOBA stabilize fastest (Savant
# research), K% needs more PAs to stabilize.
_STX_BATTER_PA_TRUST = 100     # xwOBA stabilizes ~50-80 PA, K% ~60 PA
_STX_BATTER_BIP_TRUST = 50     # barrel%, hard-hit% stabilize ~30-50 BIP
_STX_PITCHER_BF_TRUST = 80     # pitcher K% and GB% stabilize ~70 BF


def _shrink(raw_mult: float, trust: float, cap: float) -> float:
    """Sample-size shrink + cap. `trust` is 0..1; 0 means no data, 1 means
    full confidence. Caps symmetric around 1.0."""
    trust = max(0.0, min(1.0, trust))
    adjusted = 1.0 + trust * (raw_mult - 1.0)
    return max(1.0 - cap, min(1.0 + cap, adjusted))


def _blend_stx(
    season_val: float | None,
    l7_val: float | None,
    season_pa: int,
    l7_pa: int,
    l7_min: int,
    l7_blend: float,
) -> float | None:
    """Blend season and L7 expected stats using the same philosophy as
    outcome rates (trust L7 when sample ≥ min, else season only).
    Returns None if both are unavailable."""
    if season_val is None and l7_val is None:
        return None
    if season_val is None:
        return l7_val
    if l7_val is None or l7_pa < l7_min:
        return season_val
    return (1.0 - l7_blend) * season_val + l7_blend * l7_val


def _statcast_expected_multipliers(
    batter_stx: dict | None,
    batter_stx_l7: dict | None,
    league_rates: dict,
    weights: dict,
) -> tuple[float, float, float]:
    """Return (xwoba_mult, barrel_mult, hardhit_mult) applied on top of
    park / weather / pitcher multipliers. These regress outcome rates
    toward the batter's underlying skill signal.

    Degrades gracefully: missing stats → multiplier 1.0 (no effect)."""
    if not batter_stx:
        return 1.0, 1.0, 1.0

    lg = (league_rates or {}).get("statcast") or {}
    lg_xwoba = float(lg.get("batter_xwoba", 0.318)) or 0.318
    lg_barrel = float(lg.get("batter_barrel_pct", 0.075)) or 0.075
    lg_hardhit = float(lg.get("batter_hard_hit_pct", 0.400)) or 0.400

    xwoba_exp = float(weights.get("batter_xwoba_exp", 0.0))
    barrel_exp = float(weights.get("batter_barrel_exp", 0.0))
    hardhit_exp = float(weights.get("batter_hardhit_exp", 0.0))

    # Blend season + L7 for each feature using the usual l7_blend.
    l7_min = int(weights.get("l7_min_pa", 10))
    l7b = float(weights.get("l7_blend", 0.20))
    season_pa = int(batter_stx.get("pa") or 0)
    season_bip = int(batter_stx.get("bip") or 0)
    l7_pa = int((batter_stx_l7 or {}).get("pa") or 0)
    l7_bip = int((batter_stx_l7 or {}).get("bip") or 0)

    xwoba_blended = _blend_stx(
        batter_stx.get("xwoba"),
        (batter_stx_l7 or {}).get("xwoba"),
        season_pa, l7_pa, l7_min, l7b,
    )
    barrel_blended = _blend_stx(
        batter_stx.get("barrel_pct"),
        (batter_stx_l7 or {}).get("barrel_pct"),
        season_bip, l7_bip, l7_min, l7b,
    )
    hardhit_blended = _blend_stx(
        batter_stx.get("hard_hit_pct"),
        (batter_stx_l7 or {}).get("hard_hit_pct"),
        season_bip, l7_bip, l7_min, l7b,
    )

    xwoba_mult = 1.0
    barrel_mult = 1.0
    hardhit_mult = 1.0

    if xwoba_exp > 0 and xwoba_blended and xwoba_blended > 0:
        raw = (xwoba_blended / lg_xwoba) ** xwoba_exp
        trust = min(1.0, season_pa / _STX_BATTER_PA_TRUST)
        xwoba_mult = _shrink(raw, trust, _STX_XWOBA_CAP)

    if barrel_exp > 0 and barrel_blended and barrel_blended > 0:
        raw = (barrel_blended / lg_barrel) ** barrel_exp
        trust = min(1.0, season_bip / _STX_BATTER_BIP_TRUST)
        barrel_mult = _shrink(raw, trust, _STX_BARREL_CAP)

    if hardhit_exp > 0 and hardhit_blended and hardhit_blended > 0:
        raw = (hardhit_blended / lg_hardhit) ** hardhit_exp
        trust = min(1.0, season_bip / _STX_BATTER_BIP_TRUST)
        hardhit_mult = _shrink(raw, trust, _STX_HARDHIT_CAP)

    return xwoba_mult, barrel_mult, hardhit_mult


def _pitcher_gb_hr_multiplier(
    pitcher_stx: dict | None,
    league_rates: dict,
    weights: dict,
) -> float:
    """High-GB pitchers suppress HRs beyond raw HR/BF. Multiplier applies
    to HR rate only. Tunable exponent `pitcher_gb_hr_exp` (0 disables)."""
    if not pitcher_stx:
        return 1.0
    exp = float(weights.get("pitcher_gb_hr_exp", 0.0))
    if exp <= 0:
        return 1.0
    gb = pitcher_stx.get("gb_pct")
    if not gb or gb <= 0:
        return 1.0
    lg = (league_rates or {}).get("statcast") or {}
    lg_gb = float(lg.get("pitcher_gb_pct", 0.430)) or 0.430
    # Inverse relationship: high GB% → lower HR rate. Ratio > 1 means
    # MORE ground balls than average, so HR multiplier < 1.
    raw = (lg_gb / gb) ** exp
    bf = int(pitcher_stx.get("bf") or 0)
    trust = min(1.0, bf / _STX_PITCHER_BF_TRUST)
    return _shrink(raw, trust, _STX_GB_HR_CAP)


def _k_damper(
    batter_stx: dict | None,
    pitcher_stx: dict | None,
    league_rates: dict,
    weights: dict,
) -> float:
    """Return a 0.85..1.15 multiplier that damps or boosts all offensive
    rates based on the K-product (batter K% × pitcher K%). A high-K
    batter vs high-K pitcher has more PAs ending in 0-point strikeouts,
    so every other rate must come down proportionally."""
    if not batter_stx and not pitcher_stx:
        return 1.0
    batter_exp = float(weights.get("batter_k_exp", 0.0))
    pitcher_exp = float(weights.get("pitcher_k_exp", 0.0))
    if batter_exp <= 0 and pitcher_exp <= 0:
        return 1.0

    lg = (league_rates or {}).get("statcast") or {}
    lg_bk = float(lg.get("batter_k_pct", 0.225)) or 0.225
    lg_pk = float(lg.get("pitcher_k_pct", 0.225)) or 0.225

    batter_k = (batter_stx or {}).get("k_pct")
    pitcher_k = (pitcher_stx or {}).get("k_pct")

    # If both sides are missing the signal isn't usable.
    if not batter_k and not pitcher_k:
        return 1.0

    # Build the combined K "excess" over league. If we only have one side,
    # use league-average for the other (neutral).
    batter_ratio = (batter_k / lg_bk) if batter_k and batter_k > 0 else 1.0
    pitcher_ratio = (pitcher_k / lg_pk) if pitcher_k and pitcher_k > 0 else 1.0

    # Weight by how much we trust each side given sample size.
    batter_pa = int((batter_stx or {}).get("pa") or 0)
    pitcher_bf = int((pitcher_stx or {}).get("bf") or 0)
    batter_trust = min(1.0, batter_pa / _STX_BATTER_PA_TRUST) if batter_k else 0.0
    pitcher_trust = min(1.0, pitcher_bf / _STX_PITCHER_BF_TRUST) if pitcher_k else 0.0

    # Deviation from neutral. Product - 1 measures how much EXTRA K-risk
    # vs a league-avg matchup. Scale by the exponents and trust.
    dev = (batter_ratio * pitcher_ratio) - 1.0
    effective_exp = (batter_exp * batter_trust) + (pitcher_exp * pitcher_trust)
    # Negative sign: high-K matchup suppresses offense.
    raw = 1.0 - effective_exp * dev * 0.15
    return max(1.0 - _STX_K_DAMPER_CAP, min(1.0 + _STX_K_DAMPER_CAP, raw))


# ---------------------------------------------------------------------------
# Tier 2 — Sprint speed + pitcher BB% + handedness-split park factors
# ---------------------------------------------------------------------------

_STX_PITCHER_BB_CAP = 0.25    # ±25% on batter bb_hbp rate from pitcher BB%
_SPEED_SB_CAP = 0.60          # SB can swing ±60% because signal is massive
_SPEED_SINGLES_CAP = 0.12     # ±12% on singles rate (infield hits)
_SPEED_R_CAP = 0.10           # ±10% on R/PA


def _pitcher_bb_multiplier(
    pitcher_stx: dict | None,
    league_rates: dict,
    weights: dict,
) -> float:
    """Boost batter BB+HBP rate when facing a high-BB pitcher. Tunable
    exponent `pitcher_bb_exp`. 0 disables."""
    if not pitcher_stx:
        return 1.0
    exp = float(weights.get("pitcher_bb_exp", 0.0))
    if exp <= 0:
        return 1.0
    bb = pitcher_stx.get("bb_pct")
    if not bb or bb <= 0:
        return 1.0
    lg = (league_rates or {}).get("statcast") or {}
    # Reuse pitcher_per_bf league baseline for BB.
    lg_bb = float(
        (league_rates or {}).get("pitcher_per_bf", {}).get("walks_allowed", 0.085)
    ) or 0.085
    raw = (bb / lg_bb) ** exp
    bf = int(pitcher_stx.get("bf") or 0)
    trust = min(1.0, bf / _STX_PITCHER_BF_TRUST)
    return _shrink(raw, trust, _STX_PITCHER_BB_CAP)


def _park_hand_multiplier(
    venue_id: int | None,
    bat_side: str | None,
    weights: dict,
) -> float:
    """Handedness-aware HR park adjustment. Strength tunable via
    `park_hand_scale` ∈ [0, 1]. 0 disables (back to overall-only park);
    1 uses the full hand-authored deviation."""
    scale = float(weights.get("park_hand_scale", 0.0))
    if scale <= 0:
        return 1.0
    raw = get_hr_hand_adj(venue_id, bat_side)
    # Interpolate between 1.0 and the raw adjustment based on scale.
    return 1.0 + scale * (raw - 1.0)


def _sprint_speed_multipliers(
    sprint_speed: float | None,
    weights: dict,
) -> tuple[float, float, float]:
    """Return (sb_mult, singles_mult, r_mult) based on sprint speed.
    Missing sprint speed → all 1.0 (neutral). Exponents 0 → feature off."""
    if not sprint_speed or sprint_speed <= 0:
        return 1.0, 1.0, 1.0
    sb_exp = float(weights.get("sb_speed_exp", 0.0))
    singles_exp = float(weights.get("speed_singles_exp", 0.0))
    r_exp = float(weights.get("speed_r_exp", 0.0))

    ratio = sprint_speed / LEAGUE_SPRINT_SPEED
    sb_mult = 1.0
    singles_mult = 1.0
    r_mult = 1.0
    if sb_exp > 0:
        raw = ratio ** sb_exp
        sb_mult = max(1.0 - _SPEED_SB_CAP, min(1.0 + _SPEED_SB_CAP, raw))
    if singles_exp > 0:
        raw = ratio ** singles_exp
        singles_mult = max(
            1.0 - _SPEED_SINGLES_CAP, min(1.0 + _SPEED_SINGLES_CAP, raw)
        )
    if r_exp > 0:
        raw = ratio ** r_exp
        r_mult = max(1.0 - _SPEED_R_CAP, min(1.0 + _SPEED_R_CAP, raw))
    return sb_mult, singles_mult, r_mult


# ---------------------------------------------------------------------------
# Tier 3 — BvPT + lineup context
# ---------------------------------------------------------------------------

_BVPT_CAP = 0.20               # ±20% on hit rates from pitch-type matchup
_ONDECK_R_CAP = 0.15           # ±15% on R/PA from on-deck batter's wOBA
_PRECEDING_RBI_CAP = 0.15      # ±15% on RBI/PA from preceding batters' OBP


def _bvpt_multiplier(
    matchup_xwoba: float | None,
    batter_season_xwoba: float | None,
    weights: dict,
) -> float:
    """BvPT multiplier based on the ratio of matchup xwOBA (batter's
    per-pitch-type xwOBA weighted by pitcher's pitch mix) to the batter's
    overall season xwOBA. Ratio > 1 = favorable matchup."""
    exp = float(weights.get("bvpt_exp", 0.0))
    if exp <= 0:
        return 1.0
    if not matchup_xwoba or not batter_season_xwoba or batter_season_xwoba <= 0:
        return 1.0
    raw = (matchup_xwoba / batter_season_xwoba) ** exp
    return max(1.0 - _BVPT_CAP, min(1.0 + _BVPT_CAP, raw))


def _lineup_context_multipliers(
    ondeck_xwoba: float | None,
    preceding_obp: float | None,
    league_rates: dict,
    weights: dict,
) -> tuple[float, float]:
    """Return (ondeck_r_mult, preceding_rbi_mult). On-deck xwOBA drives
    R scoring (the batter ahead drives you in); preceding OBP drives
    RBI (runners on base when you come up)."""
    ondeck_exp = float(weights.get("ondeck_r_exp", 0.0))
    preceding_exp = float(weights.get("preceding_rbi_exp", 0.0))

    ondeck_mult = 1.0
    preceding_mult = 1.0

    if ondeck_exp > 0 and ondeck_xwoba and ondeck_xwoba > 0:
        lg_xwoba = float(
            ((league_rates or {}).get("statcast") or {}).get("batter_xwoba", 0.318)
        ) or 0.318
        raw = (ondeck_xwoba / lg_xwoba) ** ondeck_exp
        ondeck_mult = max(1.0 - _ONDECK_R_CAP, min(1.0 + _ONDECK_R_CAP, raw))

    if preceding_exp > 0 and preceding_obp and preceding_obp > 0:
        lg_obp = float((league_rates or {}).get("obp", 0.314)) or 0.314
        raw = (preceding_obp / lg_obp) ** preceding_exp
        preceding_mult = max(
            1.0 - _PRECEDING_RBI_CAP, min(1.0 + _PRECEDING_RBI_CAP, raw)
        )

    return ondeck_mult, preceding_mult


async def _fetch_pitcher_hand(player_id: int) -> str | None:
    """
    Return pitcher's throwing hand ('L' or 'R'). Cached 24h.
    Uses /people/{id}.pitchHand.code.
    """
    if not player_id:
        return None
    cache_key = f"fantasy:pitchHand:{player_id}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached or None
    data = await mlb_api.fetch(f"/people/{player_id}")
    people = data.get("people") or []
    if not people:
        cache_set(cache_key, "", 60 * 60 * 24)
        return None
    hand = (people[0].get("pitchHand") or {}).get("code")
    value = hand if hand in ("L", "R") else ""
    cache_set(cache_key, value, 60 * 60 * 24)
    return value or None


async def _fetch_platoon_split(player_id: int, season: int, vs_hand: str) -> dict | None:
    """
    Return the batter's per-PA rates vs pitchers of the given hand ('L' or
    'R') for the current season, or None if no usable sample.

    Uses MLB's statSplits with sitCode=vl (vs lefty) or vr (vs righty).
    """
    if not player_id or vs_hand not in ("L", "R"):
        return None
    code = "vl" if vs_hand == "L" else "vr"
    cache_key = f"fantasy:platoon:{player_id}:{season}:{code}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached or None

    data = await mlb_api.fetch(
        f"/people/{player_id}/stats",
        params={
            "stats": "statSplits",
            "sitCodes": code,
            "group": "hitting",
            "season": season,
        },
    )
    splits = (data.get("stats") or [{}])[0].get("splits") or []
    stat = splits[0].get("stat") if splits else None
    if not stat:
        cache_set(cache_key, {}, 60 * 60 * 12)
        return None

    rates_obj = derive_rates_from_stat(stat)
    # Below 30 PA, splits are too noisy to meaningfully blend in.
    if rates_obj.pa < 30:
        cache_set(cache_key, {}, 60 * 60 * 12)
        return None

    platoon = rates_obj.as_dict()
    cache_set(cache_key, platoon, 60 * 60 * 12)
    return platoon


async def _fetch_bat_side(player_id: int) -> str | None:
    """
    Return the batter's primary batting hand: 'L', 'R', 'S', or None.
    Cached for 24h since handedness basically never changes mid-season.
    """
    cache_key = f"fantasy:batSide:{player_id}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached or None  # empty string means "known unknown"
    data = await mlb_api.fetch(f"/people/{player_id}")
    people = data.get("people") or []
    if not people:
        cache_set(cache_key, "", 60 * 60 * 24)
        return None
    side = (people[0].get("batSide") or {}).get("code")
    value = side if side in ("L", "R", "S") else ""
    cache_set(cache_key, value, 60 * 60 * 24)
    return value or None


async def _fetch_l7_stats(player_id: int, season: int) -> dict | None:
    cache_key = f"fantasy:l7Stats:{player_id}:{season}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    data = await mlb_api.fetch(
        f"/people/{player_id}/stats",
        params={
            "stats": "lastXGames",
            "group": "hitting",
            "gameType": "R",
            "limit": 7,
        },
    )
    splits = (data.get("stats") or [{}])[0].get("splits") or []
    stat = splits[0].get("stat") if splits else None
    if stat:
        cache_set(cache_key, stat, _L7_STATS_TTL)
    return stat


async def _fetch_schedule(date_iso: str) -> list[dict]:
    cache_key = f"fantasy:schedule:{date_iso}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    data = await mlb_api.fetch(
        "/schedule",
        params={
            "sportId": 1,
            "date": date_iso,
            "hydrate": "team,linescore,probablePitcher,weather,venue(location),lineups",
            "gameType": "R",
        },
    )
    games: list[dict] = []
    for d in data.get("dates", []):
        for g in d.get("games", []):
            games.append(g)
    cache_set(cache_key, games, _SCHEDULE_TTL)
    return games


async def _fetch_roster(team_id: int, season: int) -> list[dict]:
    """Get the active position-player list (exclude pitchers)."""
    cache_key = f"fantasy:roster:{team_id}:{season}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    roster = await mlb_api.get_roster(team_id, season=season)
    batters = [
        p for p in roster
        if (p.get("position") or {}).get("type") != "Pitcher"
    ]
    cache_set(cache_key, batters, _SEASON_STATS_TTL)
    return batters


def _extract_lineup_ids(lineups: dict | None, side: str) -> list[int]:
    """
    MLB `lineups` hydrate shape varies. Return the confirmed batting order
    as a list of player IDs when available; else [].
    """
    if not lineups:
        return []
    for key in (f"{side}Players", f"{side}Lineup", side):
        arr = lineups.get(key) if isinstance(lineups, dict) else None
        if isinstance(arr, list) and arr:
            ids: list[int] = []
            for p in arr:
                if isinstance(p, dict):
                    pid = p.get("id") or (p.get("person") or {}).get("id")
                    if pid:
                        ids.append(int(pid))
            if ids:
                return ids
    return []


def _projected_pa(lineup_ids: list[int], batter_id: int, weights: dict) -> tuple[float, str, int | None]:
    """
    Return (projected_pa, source, slot). Source is 'lineup' or 'default';
    slot is the 1-based batting order position when known, else None.
    """
    default = float(weights.get("default_pa", 4.0))
    if not lineup_ids:
        return default, "default", None
    try:
        idx = lineup_ids.index(int(batter_id))  # 0-based
    except ValueError:
        return default, "default", None
    slot = idx + 1
    adj = float(weights.get("lineup_pa_adj", 0.30))
    if slot <= 3:
        return default + adj, "lineup", slot
    if slot >= 7:
        return default - adj, "lineup", slot
    return default, "lineup", slot


async def _build_game_context(g: dict) -> dict:
    """Reshape one hydrated MLB schedule game into the fields we need."""
    teams = g.get("teams", {}) or {}
    away = teams.get("away", {}) or {}
    home = teams.get("home", {}) or {}
    away_team = away.get("team", {}) or {}
    home_team = home.get("team", {}) or {}
    venue = g.get("venue", {}) or {}
    weather = g.get("weather") or None

    def pitcher(t: dict) -> dict | None:
        p = t.get("probablePitcher")
        if not p:
            return None
        return {
            "id": p.get("id"),
            "fullName": p.get("fullName"),
        }

    return {
        "gamePk": g.get("gamePk"),
        "gameDate": g.get("gameDate"),
        "status": (g.get("status") or {}).get("detailedState"),
        "venue": {"id": venue.get("id"), "name": venue.get("name")},
        "weather": weather if (weather and weather.get("temp")) else None,
        "away": {
            "id": away_team.get("id"),
            "name": away_team.get("name"),
            "abbreviation": away_team.get("abbreviation"),
            "probablePitcher": pitcher(away),
        },
        "home": {
            "id": home_team.get("id"),
            "name": home_team.get("name"),
            "abbreviation": home_team.get("abbreviation"),
            "probablePitcher": pitcher(home),
        },
        "lineups": g.get("lineups") or {},
    }


async def _project_batter(
    *,
    player: dict,
    season: int,
    team_abbr: str,
    team_id: int,
    opp_abbr: str,
    opp_team_id: int,
    opp_pitcher: dict | None,
    opp_pitcher_rates: dict | None,
    opp_pitcher_hand: str | None,
    park: dict,
    weather: dict | None,
    projected_pa: float,
    pa_source: str,
    lineup_slot: int | None,
    lineup_ids: list[int] | None,
    team_runs_per_game: float | None,
    weights: dict,
    league_rates: dict,
    semaphore: asyncio.Semaphore,
) -> dict | None:
    async with semaphore:
        try:
            pid = int(player.get("id"))
            season_stat, l7_stat, bat_side = await asyncio.gather(
                _fetch_season_stats(pid, season),
                _fetch_l7_stats(pid, season),
                _fetch_bat_side(pid),
                return_exceptions=False,
            )
            # Platoon split (vs pitcher hand) — only attempt if we know the
            # opposing pitcher's throwing hand; cached per batter × season ×
            # hand so this is one call max per batter per day.
            platoon_rates = None
            if opp_pitcher_hand in ("L", "R"):
                try:
                    platoon_rates = await _fetch_platoon_split(pid, season, opp_pitcher_hand)
                except Exception:
                    platoon_rates = None
        except Exception as e:
            logger.warning("fantasy: fetch failed for %s: %s", player.get("id"), e)
            return None

    # Attach pitcher hand to the rates dict so project_hitter_points
    # can apply the LHP SB-suppression. Shallow-copy to avoid mutating
    # the cached pitcher rates (which other batters share via cache).
    pitcher_rates_with_hand = None
    if opp_pitcher_rates is not None:
        pitcher_rates_with_hand = {**opp_pitcher_rates}
        if opp_pitcher_hand:
            pitcher_rates_with_hand["hand"] = opp_pitcher_hand

    # Require at least 10 season PA to project at all — protects against
    # call-ups / rehabbers with zero context.
    if not season_stat or int(float(season_stat.get("plateAppearances") or 0)) < 10:
        return None

    season_rates = derive_rates_from_stat(season_stat)
    l7_rates = derive_rates_from_stat(l7_stat) if l7_stat else None

    # Tier 1 — Statcast expected-stats features (season + L7). Reads the
    # local parquet cache; no network. Missing cache → all fields None
    # (treated as neutral multiplier inside project_hitter_points).
    today = _today_iso()
    try:
        batter_stx = await asyncio.to_thread(get_batter_features_as_of, pid, today, season)
        batter_stx_l7 = await asyncio.to_thread(get_batter_l7_features_as_of, pid, today, 7)
    except Exception:
        batter_stx = batter_stx_l7 = None
    pitcher_stx = None
    opp_sp_id = (opp_pitcher or {}).get("id") if opp_pitcher else None
    if opp_sp_id:
        try:
            pitcher_stx = await asyncio.to_thread(
                get_pitcher_features_as_of, int(opp_sp_id), today, season
            )
        except Exception:
            pitcher_stx = None

    # Tier 2 — sprint speed (season leaderboard, JSON-cached). Missing
    # player → None → speed multipliers all 1.0.
    try:
        sprint_speed = await asyncio.to_thread(get_sprint_speed, pid, season)
    except Exception:
        sprint_speed = None

    # Tier 3 — BvPT: batter per-pitch-type xwOBA (3-year window) × pitcher
    # current-season pitch mix → matchup xwOBA. Both local parquet.
    matchup_xwoba = None
    batter_season_xwoba = (batter_stx or {}).get("xwoba")
    if opp_sp_id:
        try:
            bat_fam = await asyncio.to_thread(
                get_batter_bvpt_xwoba_as_of, pid, today, season
            )
            pit_mix = await asyncio.to_thread(
                get_pitcher_pitch_mix_as_of, int(opp_sp_id), today, season
            )
            matchup_xwoba = _bvpt_matchup_xwoba(bat_fam, pit_mix)
        except Exception:
            matchup_xwoba = None

    # Tier 3 — Lineup context: surrounding batters' OBP/xwOBA. Only
    # meaningful when we have a confirmed lineup (lineup_ids).
    preceding_obp = None
    ondeck_xwoba = None
    if lineup_ids and pid in lineup_ids:
        try:
            ctx = await asyncio.to_thread(
                lineup_context, lineup_ids, pid, today, season
            )
            preceding_obp = ctx.get("preceding_obp")
            ondeck_xwoba = ctx.get("ondeck_xwoba")
        except Exception:
            pass

    projection = project_hitter_points(
        season_rates=season_rates,
        l7_rates=l7_rates,
        bvp=None,  # Phase 1 skips BvP (added alongside backtest in Phase 2)
        league_rates=league_rates,
        park=park,
        weather=weather,
        projected_pa=projected_pa,
        weights=weights,
        bat_side=bat_side,
        pitcher_rates=pitcher_rates_with_hand or opp_pitcher_rates,
        lineup_slot=lineup_slot,
        platoon_rates=platoon_rates,
        team_runs_per_game=team_runs_per_game,
        batter_stx=batter_stx,
        batter_stx_l7=batter_stx_l7,
        pitcher_stx=pitcher_stx,
        sprint_speed=sprint_speed,
        venue_id=park.get("id"),
        bvpt_matchup_xwoba=matchup_xwoba,
        batter_season_xwoba=batter_season_xwoba,
        preceding_obp=preceding_obp,
        ondeck_xwoba=ondeck_xwoba,
    )

    # Per-player historical stdev for confidence scoring. Falls back to
    # slate defaults when the player has no backtest history.
    hist = get_player_stats(pid, season)

    row = {
        "player_id": pid,
        "name": player.get("fullName", ""),
        "position": (player.get("position") or {}).get("abbreviation", ""),
        # bat_side comes through via **projection below
        "team_id": team_id,
        "team_abbr": team_abbr,
        "opp_abbr": opp_abbr,
        "opp_team_id": opp_team_id,
        "opp_pitcher": opp_pitcher,
        "park": {"id": park.get("id"), "name": park.get("name"), "runs": park.get("runs"), "hr": park.get("hr"), "label": park.get("label")},
        "weather": weather,
        "pa_source": pa_source,
        # Confidence fields — product-level metrics that match the
        # "daily best bets" framing rather than raw R².
        "stdev_efp": round(hist["stdev"], 2) if hist["stdev"] else None,
        "mean_efp": round(hist["mean"], 2) if hist["mean"] else None,
        "stats_games": hist["n"],
        **projection,
    }
    return row


async def project_slate(date_iso: str | None = None, season: int | None = None) -> dict:
    """
    Main entry: rank every eligible hitter on today's slate by projected
    EFP, return top-N along with supporting metadata.
    """
    from app.config import get_current_season

    if season is None:
        season = get_current_season()
    if not date_iso:
        date_iso = _today_iso()

    cache_key = f"fantasy:projections:{date_iso}:{season}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    weights = load_weights()
    league_rates = load_league_rates()

    raw_games = await _fetch_schedule(date_iso)
    games = [await _build_game_context(g) for g in raw_games if g]
    # Only project games we can meaningfully score (not Final, both teams
    # present). Unknown pitcher is OK (BvP skipped anyway in Phase 1).
    games = [
        g for g in games
        if g.get("status") != "Final"
        and g.get("away", {}).get("id")
        and g.get("home", {}).get("id")
    ]

    semaphore = asyncio.Semaphore(_CONCURRENCY_LIMIT)
    tasks = []

    for g in games:
        park_raw = get_park_factor(g.get("venue", {}).get("id"))
        park = {"id": g.get("venue", {}).get("id"), **park_raw}
        lineup_away = _extract_lineup_ids(g.get("lineups"), "away")
        lineup_home = _extract_lineup_ids(g.get("lineups"), "home")

        # Fetch rosters + both probable pitchers (rates + hands) + both
        # teams' season run environments in parallel. Per-pitcher calls are
        # cached (rates 30 min, hand 24h); team run env is cached 6h so
        # repeats across batters on the same team are free.
        home_sp_id = (g["home"]["probablePitcher"] or {}).get("id")
        away_sp_id = (g["away"]["probablePitcher"] or {}).get("id")
        try:
            (
                away_batters, home_batters,
                home_sp_rates, away_sp_rates,
                home_sp_hand, away_sp_hand,
                away_team_env, home_team_env,
            ) = await asyncio.gather(
                _fetch_roster(g["away"]["id"], season),
                _fetch_roster(g["home"]["id"], season),
                _fetch_pitcher_rates(home_sp_id, season) if home_sp_id else _noop_none(),
                _fetch_pitcher_rates(away_sp_id, season) if away_sp_id else _noop_none(),
                _fetch_pitcher_hand(home_sp_id) if home_sp_id else _noop_none(),
                _fetch_pitcher_hand(away_sp_id) if away_sp_id else _noop_none(),
                _fetch_team_run_env(g["away"]["id"], season),
                _fetch_team_run_env(g["home"]["id"], season),
            )
        except Exception as e:
            logger.warning("fantasy: roster/pitcher fetch failed for game %s: %s", g.get("gamePk"), e)
            continue

        away_rpg = (away_team_env or {}).get("runs_per_game")
        home_rpg = (home_team_env or {}).get("runs_per_game")

        # If lineup exists, project only lineup hitters (the real 9). If
        # not, project the full roster and UI shows "default" badge.
        away_pool = [p for p in away_batters if (not lineup_away) or int(p.get("id")) in lineup_away]
        home_pool = [p for p in home_batters if (not lineup_home) or int(p.get("id")) in lineup_home]

        for p in away_pool:
            proj_pa, pa_source, slot = _projected_pa(lineup_away, int(p.get("id")), weights)
            tasks.append(_project_batter(
                player=p, season=season,
                team_abbr=g["away"]["abbreviation"], team_id=g["away"]["id"],
                opp_abbr=g["home"]["abbreviation"], opp_team_id=g["home"]["id"],
                opp_pitcher=g["home"]["probablePitcher"],
                opp_pitcher_rates=home_sp_rates,
                opp_pitcher_hand=home_sp_hand,
                park=park, weather=g.get("weather"),
                projected_pa=proj_pa, pa_source=pa_source,
                lineup_slot=slot,
                lineup_ids=lineup_away or None,
                team_runs_per_game=away_rpg,
                # away batters are in `lineup_away`, so context uses that;
                # the second call site gets patched to home below.
                weights=weights, league_rates=league_rates,
                semaphore=semaphore,
            ))
        for p in home_pool:
            proj_pa, pa_source, slot = _projected_pa(lineup_home, int(p.get("id")), weights)
            tasks.append(_project_batter(
                player=p, season=season,
                team_abbr=g["home"]["abbreviation"], team_id=g["home"]["id"],
                opp_abbr=g["away"]["abbreviation"], opp_team_id=g["away"]["id"],
                opp_pitcher=g["away"]["probablePitcher"],
                opp_pitcher_rates=away_sp_rates,
                opp_pitcher_hand=away_sp_hand,
                park=park, weather=g.get("weather"),
                projected_pa=proj_pa, pa_source=pa_source,
                lineup_slot=slot,
                lineup_ids=lineup_home or None,
                team_runs_per_game=home_rpg,
                weights=weights, league_rates=league_rates,
                semaphore=semaphore,
            ))

    rows: list[dict] = [r for r in await asyncio.gather(*tasks, return_exceptions=False) if r]
    rows.sort(key=lambda r: r["efp"], reverse=True)

    # Enrich with PrizePicks lines (best effort — fails silently). Matched
    # rows get a `prizepicks` field with {fantasy, hits, home_runs, ...}
    # and an `edge` summary when a direct fantasy-score line exists.
    try:
        pp_lines = await prizepicks.fetch_lines()
    except Exception as e:
        logger.warning("prizepicks: slate-level fetch failed: %s", e)
        pp_lines = {}
    if pp_lines:
        pp_match_count = 0
        for r in rows:
            match = prizepicks.lookup_for_batter(pp_lines, r.get("name"), r.get("team_abbr"))
            if not match:
                continue
            pp_match_count += 1
            r["prizepicks"] = match
            fan_line = match.get("fantasy")
            if fan_line is not None:
                r["edge_fantasy"] = round(r["efp"] - float(fan_line), 2)
                # Confidence-adjusted edge: # of stdevs our projection
                # exceeds the PP line. > 0 = bet OVER, larger = more
                # confident. This is the metric daily top-6 picks
                # should sort by.
                ez = compute_edge_z(r["efp"], float(fan_line), r.get("stdev_efp"))
                if ez is not None:
                    r["edge_z"] = round(ez, 3)
        logger.info("prizepicks: matched %d / %d projections", pp_match_count, len(rows))

    # Cap displayed list; full slate can grow large but UI wants a focused top.
    # We serve 30 here so the frontend has room to filter by live lineup data
    # (pre-scratched / non-starter batters drop off, confirmed starters get a
    # checkmark) and still show ~10 usable cards.
    MAX_DISPLAY = 30

    # Best-bets list — top 20 picks across the ENTIRE slate ranked by
    # edge_z (confidence-adjusted edge).
    #
    # QUALITY FILTERS — the edge_z metric rewards large
    # (projection − line) / stdev gaps, which math-wise favors platoon /
    # bench batters with tiny PP lines (e.g. a .250-hitter projected 7.0
    # with a 3.0 line gets +1.2σ). But those low lines reflect PP's own
    # adjustment for role uncertainty — the "edge" is often illusory
    # because the player might get 2 PAs and bust.
    #
    # Filter picks to legit starter-quality bets:
    #   1. PP fantasy line ≥ best_bets_min_line (default 5.0) — excludes
    #      bench/platoon guys whose low line reflects playing-time risk
    #   2. Player has ≥ best_bets_min_games of logged stats_games —
    #      requires real 2026 variance history; excludes call-ups /
    #      early-season unknowns with default slate stdev
    MAX_BEST_BETS = 20
    min_line = float(weights.get("best_bets_min_line", 5.0))
    min_games = int(weights.get("best_bets_min_games", 10))

    def _passes_quality(r: dict) -> bool:
        pp_line = ((r.get("prizepicks") or {}).get("fantasy"))
        if pp_line is None or float(pp_line) < min_line:
            return False
        if int(r.get("stats_games") or 0) < min_games:
            return False
        return True

    best_bets = [
        r for r in rows
        if isinstance(r.get("edge_z"), (int, float))
        and r["edge_z"] >= 0
        and _passes_quality(r)
    ]
    best_bets.sort(key=lambda r: r["edge_z"], reverse=True)
    best_bets = best_bets[:MAX_BEST_BETS]

    payload = {
        "date": date_iso,
        "season": season,
        "weights_version": weights.get("version"),
        "calibrated": bool(weights.get("calibrated")),
        "metrics": weights.get("metrics") or {},
        "game_count": len(games),
        "projection_count": len(rows),
        "projections": rows[:MAX_DISPLAY],
        "best_bets": best_bets,
        # Full untrimmed slate for offline tooling (PP line logger,
        # backtest, analytics). NOT included in the static site JSON —
        # the generator strips this before writing to keep the payload
        # small for the frontend.
        "_all_projections": rows,
    }
    cache_set(cache_key, payload, _SLATE_TTL)
    return payload
