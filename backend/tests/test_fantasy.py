"""
Unit tests for the fantasy projection model.

Exercises the pure `project_hitter_points` function directly — no HTTP,
no I/O — so these run in milliseconds and are easy to debug.

Run from the backend directory:
    cd backend && python -m pytest tests/test_fantasy.py -v
"""

from __future__ import annotations

import math

import pytest

from app.services.fantasy import (
    PP_SCORING,
    Rates,
    derive_rates_from_stat,
    load_league_rates,
    load_weights,
    project_hitter_points,
    reset_caches_for_tests,
    _weather_hr_multiplier,
)


# A clean set of season rates: league-average hitter with 500 PA.
def _avg_rates(pa: int = 500) -> Rates:
    return Rates(
        singles=0.144,
        doubles=0.045,
        triples=0.004,
        home_runs=0.033,
        bb_hbp=0.096,
        obp=0.314,
        slg=0.399,
        sb_per_game=0.08,
        pa=pa,
    )


# A strong-power hitter — season .920 OPS, 40-HR pace.
def _power_rates(pa: int = 500) -> Rates:
    return Rates(
        singles=0.130,
        doubles=0.065,
        triples=0.004,
        home_runs=0.064,  # 32 HR in 500 PA
        bb_hbp=0.130,
        obp=0.390,
        slg=0.540,
        sb_per_game=0.10,
        pa=pa,
    )


@pytest.fixture(autouse=True)
def reset_caches():
    reset_caches_for_tests()
    yield
    reset_caches_for_tests()


@pytest.fixture
def weights():
    return load_weights()


@pytest.fixture
def league():
    return load_league_rates()


def test_season_only_batter_no_l7(weights, league):
    """L7=None ⇒ effective rates equal season rates (no blending)."""
    season = _avg_rates()
    result = project_hitter_points(
        season_rates=season,
        l7_rates=None,
        bvp=None,
        league_rates=league,
        park={"runs": 100, "hr": 100},
        weather=None,
        projected_pa=4.0,
        weights=weights,
    )
    assert result["rates"]["singles"] == pytest.approx(season.singles, abs=1e-6)
    assert result["rates"]["home_runs"] == pytest.approx(season.home_runs, abs=1e-6)
    # All multipliers neutral
    assert result["multipliers"]["park_hr"] == 1.0
    assert result["multipliers"]["park_runs"] == 1.0
    assert result["multipliers"]["weather_hr"] == 1.0
    assert result["multipliers"]["pitcher_hits"] == 1.0
    assert result["multipliers"]["pitcher_hr"] == 1.0


def test_l7_shrinks_toward_season(weights, league):
    """With L7 ≥ l7_min_pa, effective rate = (1-blend)·season + blend·L7."""
    season = _avg_rates()
    l7 = Rates(
        singles=0.200, doubles=0.060, triples=0.004, home_runs=0.060,
        bb_hbp=0.100, obp=0.400, slg=0.550, sb_per_game=0.1, pa=20,
    )
    result = project_hitter_points(
        season_rates=season, l7_rates=l7, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
    )
    b = weights["l7_blend"]
    expected_1b = (1 - b) * season.singles + b * l7.singles
    expected_hr = (1 - b) * season.home_runs + b * l7.home_runs
    assert result["rates"]["singles"] == pytest.approx(expected_1b, abs=5e-4)
    assert result["rates"]["home_runs"] == pytest.approx(expected_hr, abs=5e-4)


def test_l7_with_low_pa_ignored(weights, league):
    """When L7 PA < l7_min_pa, season rates are trusted entirely."""
    season = _avg_rates()
    tiny_l7 = Rates(
        singles=0.500, doubles=0.1, triples=0.01, home_runs=0.1,
        bb_hbp=0.1, obp=0.5, slg=0.8, sb_per_game=0.0, pa=4,  # < 10
    )
    result = project_hitter_points(
        season_rates=season, l7_rates=tiny_l7, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
    )
    assert result["rates"]["singles"] == pytest.approx(season.singles, abs=1e-6)
    assert result["rates"]["home_runs"] == pytest.approx(season.home_runs, abs=1e-6)


def test_bvp_boost_with_full_sample(weights, league):
    """BvP with PA≥20 and elevated BA nudges contact rates upward (when bvp_blend > 0)."""
    if weights.get("bvp_blend", 0.0) <= 0.0:
        pytest.skip("Calibrated weights have bvp_blend=0; no BvP effect to test.")
    season = _avg_rates()
    bvp = {"pa": 30, "ab": 25, "hits": 10, "home_runs": 2}
    result = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=bvp, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
    )
    baseline = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
    )
    assert result["rates"]["singles"] > baseline["rates"]["singles"]
    assert result["rates"]["home_runs"] >= baseline["rates"]["home_runs"]
    cap = weights.get("bvp_multiplier_cap", 0.25)
    assert result["rates"]["singles"] <= baseline["rates"]["singles"] * (1 + cap) + 1e-6


def test_bvp_half_weight_ramp(weights, league):
    """BvP at PA=10 gets roughly half-weight vs PA=20 (when bvp_blend > 0)."""
    if weights.get("bvp_blend", 0.0) <= 0.0:
        pytest.skip("Calibrated weights have bvp_blend=0; no BvP effect to test.")
    season = _avg_rates()
    bvp_mid = {"pa": 10, "ab": 10, "hits": 5, "home_runs": 0}
    bvp_full = {"pa": 20, "ab": 20, "hits": 10, "home_runs": 0}
    mid = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=bvp_mid, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
    )
    full = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=bvp_full, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
    )
    delta_mid = mid["rates"]["singles"] - season.singles
    delta_full = full["rates"]["singles"] - season.singles
    assert delta_full > delta_mid > 0


def test_coors_multiplier(weights, league):
    """Coors (hr=118, runs=116) multiplies HR ×1.18 and non-HR hits ×1.16."""
    season = _avg_rates()
    result = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 116, "hr": 118}, weather=None,
        projected_pa=4.0, weights=weights,
    )
    # rates are rounded to 4 decimals on output — tolerance reflects that
    assert result["rates"]["home_runs"] == pytest.approx(season.home_runs * 1.18, abs=5e-4)
    assert result["rates"]["singles"] == pytest.approx(season.singles * 1.16, abs=5e-4)


def test_weather_hot_and_wind_out_cf(weights, league):
    """90°F + wind out-to-CF is neutral for handedness — 1.05 · 1.08 on HR rate."""
    season = _avg_rates()
    result = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100},
        weather={"temp": 90, "condition": "Sunny", "wind": "12 mph, Out To CF"},
        projected_pa=4.0, weights=weights,
    )
    expected_mult = 1.05 * 1.08
    assert result["multipliers"]["weather_hr"] == pytest.approx(expected_mult, abs=1e-6)
    assert result["rates"]["home_runs"] == pytest.approx(season.home_runs * expected_mult, abs=5e-4)


def test_wind_out_rf_helps_lhb_more_than_rhb(weights, league):
    """Wind out to RF is a much bigger boost for a lefty's pull side."""
    season = _avg_rates()
    weather = {"temp": 72, "wind": "12 mph, Out To RF"}
    lhb = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=weather,
        projected_pa=4.0, weights=weights, bat_side="L",
    )
    rhb = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=weather,
        projected_pa=4.0, weights=weights, bat_side="R",
    )
    assert lhb["multipliers"]["weather_hr"] == pytest.approx(1.15, abs=1e-6)
    assert rhb["multipliers"]["weather_hr"] == pytest.approx(1.03, abs=1e-6)
    # The lefty's EFP is strictly higher under the same matchup + park.
    assert lhb["efp"] > rhb["efp"]


def test_wind_out_lf_helps_rhb_more_than_lhb(weights, league):
    """Symmetric — wind out to LF favors RHBs pulling there."""
    season = _avg_rates()
    weather = {"temp": 72, "wind": "12 mph, Out To LF"}
    lhb = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=weather,
        projected_pa=4.0, weights=weights, bat_side="L",
    )
    rhb = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=weather,
        projected_pa=4.0, weights=weights, bat_side="R",
    )
    assert lhb["multipliers"]["weather_hr"] == pytest.approx(1.03, abs=1e-6)
    assert rhb["multipliers"]["weather_hr"] == pytest.approx(1.15, abs=1e-6)


def test_wind_in_from_rf_hurts_lhb_more(weights, league):
    """Wind IN from RF crushes a lefty's pull side more than a righty's oppo."""
    season = _avg_rates()
    weather = {"temp": 72, "wind": "12 mph, In From RF"}
    lhb = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=weather,
        projected_pa=4.0, weights=weights, bat_side="L",
    )
    rhb = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=weather,
        projected_pa=4.0, weights=weights, bat_side="R",
    )
    assert lhb["multipliers"]["weather_hr"] == pytest.approx(0.82, abs=1e-6)
    assert rhb["multipliers"]["weather_hr"] == pytest.approx(0.95, abs=1e-6)


def test_switch_hitter_averages_between_lhb_rhb(weights, league):
    """Switch hitters use the averaged column (0.88 in from RF, 1.09 out to RF)."""
    season = _avg_rates()
    lh_out = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100},
        weather={"temp": 72, "wind": "12 mph, Out To RF"},
        projected_pa=4.0, weights=weights, bat_side="L",
    )
    switch_out = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100},
        weather={"temp": 72, "wind": "12 mph, Out To RF"},
        projected_pa=4.0, weights=weights, bat_side="S",
    )
    rh_out = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100},
        weather={"temp": 72, "wind": "12 mph, Out To RF"},
        projected_pa=4.0, weights=weights, bat_side="R",
    )
    assert lh_out["multipliers"]["weather_hr"] == pytest.approx(1.15)
    assert switch_out["multipliers"]["weather_hr"] == pytest.approx(1.09)
    assert rh_out["multipliers"]["weather_hr"] == pytest.approx(1.03)


def test_unknown_handedness_falls_back_to_neutral(weights, league):
    """If bat_side is None (API didn't return it), use the averaged-across-hands value."""
    season = _avg_rates()
    result = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100},
        weather={"temp": 72, "wind": "12 mph, Out To RF"},
        projected_pa=4.0, weights=weights,
        # bat_side omitted
    )
    assert result["multipliers"]["weather_hr"] == pytest.approx(1.09)


def test_crosswind_no_effect(weights, league):
    """Wind L-to-R or R-to-L is a crosswind — no HR boost or drag."""
    season = _avg_rates()
    result = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100},
        weather={"temp": 72, "wind": "8 mph, L To R"},
        projected_pa=4.0, weights=weights, bat_side="L",
    )
    assert result["multipliers"]["weather_hr"] == pytest.approx(1.0)


def test_weather_none_neutral(weights, league):
    season = _avg_rates()
    result = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
    )
    assert result["multipliers"]["weather_hr"] == 1.0


def test_cold_wind_in_cf(weights, league):
    """Cold + wind in from CF depresses HR rate — CF is neutral for handedness."""
    season = _avg_rates()
    result = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100},
        weather={"temp": 48, "wind": "10 mph, In From CF"},
        projected_pa=4.0, weights=weights,
    )
    expected_mult = 0.90 * 0.90
    assert result["multipliers"]["weather_hr"] == pytest.approx(expected_mult, abs=1e-6)


def test_missing_probable_pitcher(weights, league):
    """bvp=None should not crash and EFP is finite."""
    season = _avg_rates()
    result = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
    )
    assert math.isfinite(result["efp"])
    assert result["efp"] > 0


def test_tier_thresholds(weights, league):
    """Verify tier bucketing matches the json thresholds."""
    season = _power_rates()
    # Big park + hot weather + wind out → push into HIGH
    result = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 116, "hr": 118},
        weather={"temp": 92, "wind": "15 mph, Out To CF"},
        projected_pa=4.8, weights=weights,
    )
    assert result["tier"] in {"high", "medium", "low"}
    # Avg hitter in neutral conditions should not be HIGH
    bland = project_hitter_points(
        season_rates=_avg_rates(), l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
    )
    assert bland["tier"] != "high"


def test_pa_clamp(weights, league):
    """Projected PA is clamped to [pa_floor, pa_ceil]."""
    season = _avg_rates()
    low = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=1.0, weights=weights,  # should clamp up to 3.0
    )
    high = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=9.0, weights=weights,  # should clamp down to 5.2
    )
    assert low["pa"] == pytest.approx(weights["pa_floor"])
    assert high["pa"] == pytest.approx(weights["pa_ceil"])


def test_derive_rates_from_stat_basic():
    """derive_rates_from_stat handles the real MLB Stats API shape."""
    stat = {
        "plateAppearances": "100",
        "atBats": 90,
        "hits": 27,
        "doubles": 6,
        "triples": 1,
        "homeRuns": 5,
        "baseOnBalls": 8,
        "hitByPitch": 2,
        "stolenBases": 3,
        "strikeouts": 20,
        "obp": ".350",
        "slg": ".478",
        "gamesPlayed": 25,
    }
    r = derive_rates_from_stat(stat)
    # singles = hits - 2B - 3B - HR = 27 - 6 - 1 - 5 = 15
    assert r.singles == pytest.approx(15 / 100)
    assert r.doubles == pytest.approx(6 / 100)
    assert r.triples == pytest.approx(1 / 100)
    assert r.home_runs == pytest.approx(5 / 100)
    assert r.bb_hbp == pytest.approx(10 / 100)
    assert r.sb_per_game == pytest.approx(3 / 25)
    assert r.obp == pytest.approx(0.350)
    assert r.slg == pytest.approx(0.478)
    assert r.pa == 100


def test_efp_scoring_sanity():
    """
    Hand-compute EFP for a simple case to sanity-check the PrizePicks
    scoring table is applied correctly. Uses whatever r_per_pa_coef /
    rbi_per_pa_coef the current calibrated weights specify so this
    test survives recalibration.

    Rates: .100 1B, 0 2B/3B/HR, 0 BB+HBP; PA=4; OBP .300; SLG .350; no SB.
        per_PA term = 3·0.1 + 2·(OBP·r_coef) + 2·(SLG·rbi_coef)
    """
    from app.services.fantasy import Rates as R
    season = R(
        singles=0.1, doubles=0.0, triples=0.0, home_runs=0.0,
        bb_hbp=0.0, obp=0.300, slg=0.350, sb_per_game=0.0, pa=500,
    )
    weights = load_weights()
    league = load_league_rates()
    result = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
    )
    r_coef = weights["r_per_pa_coef"]
    rbi_coef = weights["rbi_per_pa_coef"]
    expected = 4 * (3 * 0.1 + 2 * (0.300 * r_coef) + 2 * (0.350 * rbi_coef))
    assert result["efp"] == pytest.approx(expected, abs=0.01)


def test_pitcher_quality_neutral_when_unknown(weights, league):
    """No opposing pitcher rates → (1.0, 1.0), projection unchanged."""
    season = _avg_rates()
    with_pitcher = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
        pitcher_rates=None,
    )
    assert with_pitcher["multipliers"]["pitcher_hits"] == pytest.approx(1.0)
    assert with_pitcher["multipliers"]["pitcher_hr"] == pytest.approx(1.0)


def test_tough_pitcher_suppresses_rates(weights, league):
    """Pitcher allowing less than league average drags hit rates down."""
    season = _avg_rates()
    # League: h/bf ≈ 0.222, hr/bf ≈ 0.029. Ace allows .180 / .020 (stingy).
    ace = {"h_per_bf": 0.180, "hr_per_bf": 0.020, "bf": 600}
    result = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
        pitcher_rates=ace,
    )
    assert result["multipliers"]["pitcher_hits"] < 1.0
    assert result["multipliers"]["pitcher_hr"] < 1.0
    # Cap should hold — no worse than -30% on hits, -35% on HR
    assert result["multipliers"]["pitcher_hits"] >= 1.0 - 0.30
    assert result["multipliers"]["pitcher_hr"] >= 1.0 - 0.35


def test_bad_pitcher_amplifies_rates(weights, league):
    """Pitcher allowing MORE than league average boosts hit rates."""
    season = _avg_rates()
    batter_practice = {"h_per_bf": 0.290, "hr_per_bf": 0.050, "bf": 400}
    result = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
        pitcher_rates=batter_practice,
    )
    assert result["multipliers"]["pitcher_hits"] > 1.0
    assert result["multipliers"]["pitcher_hr"] > 1.0
    assert result["multipliers"]["pitcher_hits"] <= 1.30 + 1e-6
    assert result["multipliers"]["pitcher_hr"] <= 1.35 + 1e-6


def test_small_sample_pitcher_shrinks_toward_neutral(weights, league):
    """
    A pitcher with very few batters faced has their multiplier pulled
    toward 1.0 vs the same rates with a full sample. The extreme
    small-sample rates shouldn't produce as big a swing as a large-sample
    pitcher with the exact same ratios.
    """
    season = _avg_rates()
    # Same per-BF rates, different BF counts.
    small_sample = {"h_per_bf": 0.290, "hr_per_bf": 0.050, "bf": 20}
    full_sample  = {"h_per_bf": 0.290, "hr_per_bf": 0.050, "bf": 600}

    small = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
        pitcher_rates=small_sample,
    )
    full = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
        pitcher_rates=full_sample,
    )
    # Small-sample multipliers should be CLOSER to 1.0 than full-sample ones.
    assert abs(small["multipliers"]["pitcher_hits"] - 1.0) < abs(full["multipliers"]["pitcher_hits"] - 1.0)
    assert abs(small["multipliers"]["pitcher_hr"] - 1.0) < abs(full["multipliers"]["pitcher_hr"] - 1.0)


def test_lineup_slot_cleanup_boosts_rbi(weights, league):
    """Slot 4 (cleanup) boosts RBI production, slot 9 shrinks it."""
    season = _avg_rates()
    cleanup = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights, lineup_slot=4,
    )
    ninth = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights, lineup_slot=9,
    )
    assert cleanup["multipliers"]["slot_rbi"] > 1.0
    assert ninth["multipliers"]["slot_rbi"] < 1.0
    assert cleanup["per_event"]["rbi"] > ninth["per_event"]["rbi"]


def test_sb_boost_top_of_order(weights, league):
    """Leadoff's SB projection > slot 9's for the same speed baseline."""
    speed = Rates(
        singles=0.15, doubles=0.04, triples=0.01, home_runs=0.02,
        bb_hbp=0.11, obp=0.350, slg=0.400, sb_per_game=0.25, pa=500,
    )
    leadoff = project_hitter_points(
        season_rates=speed, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights, lineup_slot=1,
    )
    ninth = project_hitter_points(
        season_rates=speed, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights, lineup_slot=9,
    )
    assert leadoff["per_event"]["sb"] > ninth["per_event"]["sb"]


def test_sb_suppressed_vs_lhp(weights, league):
    """LHP on the mound drops SB projection ~20%."""
    speed = Rates(
        singles=0.15, doubles=0.04, triples=0.01, home_runs=0.02,
        bb_hbp=0.11, obp=0.350, slg=0.400, sb_per_game=0.25, pa=500,
    )
    vs_rhp = project_hitter_points(
        season_rates=speed, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
        pitcher_rates={"h_per_bf": 0.22, "hr_per_bf": 0.03, "bf": 500, "hand": "R"},
    )
    vs_lhp = project_hitter_points(
        season_rates=speed, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
        pitcher_rates={"h_per_bf": 0.22, "hr_per_bf": 0.03, "bf": 500, "hand": "L"},
    )
    # 20% hold
    assert vs_lhp["per_event"]["sb"] == pytest.approx(vs_rhp["per_event"]["sb"] * 0.80, abs=1e-3)


def test_lineup_slot_top_of_order_more_runs(weights, league):
    """Slot 1 boosts R production vs slot 9."""
    season = _avg_rates()
    leadoff = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights, lineup_slot=1,
    )
    ninth = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights, lineup_slot=9,
    )
    assert leadoff["multipliers"]["slot_r"] > ninth["multipliers"]["slot_r"]
    assert leadoff["per_event"]["r"] > ninth["per_event"]["r"]


def test_platoon_rates_blend_into_base(weights, league):
    """
    When platoon_rates are provided (batter's actual vs-hand split), the
    projection should move toward those rates by the platoon_blend weight.
    """
    season = _avg_rates()
    # Batter with much better vs-R split than his season average
    strong_vs_r = {
        "singles": 0.180,     # way up from .144
        "doubles": 0.060,     # up from .045
        "triples": 0.004,
        "home_runs": 0.060,   # up from .033
        "bb_hbp": 0.110,      # up
    }
    with_platoon = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
        platoon_rates=strong_vs_r,
    )
    without = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
    )
    # All the rates where the platoon is higher should tick up in projection
    assert with_platoon["rates"]["singles"] > without["rates"]["singles"]
    assert with_platoon["rates"]["home_runs"] > without["rates"]["home_runs"]
    # Specific check: platoon_blend = 0.20, so new = 0.8 * season + 0.2 * platoon
    pb = weights["platoon_blend"]
    expected = (1 - pb) * season.singles + pb * 0.180
    assert with_platoon["rates"]["singles"] == pytest.approx(expected, abs=5e-4)


def test_platoon_none_leaves_rates_untouched(weights, league):
    """platoon_rates=None → projection identical to baseline."""
    season = _avg_rates()
    with_none = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
        platoon_rates=None,
    )
    baseline = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
    )
    assert with_none["efp"] == pytest.approx(baseline["efp"], abs=1e-6)


def test_lineup_slot_none_is_neutral(weights, league):
    """When slot is unknown (no lineup posted yet) the multiplier is 1.0."""
    season = _avg_rates()
    result = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
    )
    assert result["multipliers"]["slot_r"] == 1.0
    assert result["multipliers"]["slot_rbi"] == 1.0


def test_weather_helper_various_wind_strings():
    # No handedness → neutral (averaged) values: 1.08 out-CF, 0.88 in-RF, etc.
    assert _weather_hr_multiplier({"temp": 72, "wind": "12 mph, Out To CF"}) == pytest.approx(1.08)
    assert _weather_hr_multiplier({"temp": 72, "wind": "10 mph, In From RF"}) == pytest.approx(0.88)
    assert _weather_hr_multiplier({"temp": 72, "wind": "5 mph, L To R"}) == pytest.approx(1.00)
    assert _weather_hr_multiplier(None) == 1.0
    assert _weather_hr_multiplier({}) == 1.0
    # Handedness flips the result for pull-side / oppo-field winds
    assert _weather_hr_multiplier(
        {"temp": 72, "wind": "12 mph, Out To RF"}, bat_side="L"
    ) == pytest.approx(1.15)
    assert _weather_hr_multiplier(
        {"temp": 72, "wind": "12 mph, Out To RF"}, bat_side="R"
    ) == pytest.approx(1.03)
    assert _weather_hr_multiplier(
        {"temp": 72, "wind": "10 mph, In From LF"}, bat_side="R"
    ) == pytest.approx(0.82)
    # 0 mph wind → no wind effect
    assert _weather_hr_multiplier({"temp": 72, "wind": "0 mph"}) == pytest.approx(1.0)
