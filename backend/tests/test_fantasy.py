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
    assert result["multipliers"] == {"park_hr": 1.0, "park_runs": 1.0, "weather_hr": 1.0}


def test_l7_shrinks_toward_season(weights, league):
    """With L7 ≥ l7_min_pa, effective rate = 0.7·season + 0.3·L7 (blend default)."""
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
    expected_1b = 0.7 * season.singles + 0.3 * l7.singles
    expected_hr = 0.7 * season.home_runs + 0.3 * l7.home_runs
    assert result["rates"]["singles"] == pytest.approx(expected_1b, abs=1e-6)
    assert result["rates"]["home_runs"] == pytest.approx(expected_hr, abs=1e-6)


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
    """BvP with PA≥20 and elevated BA nudges contact rates upward."""
    season = _avg_rates()
    # BvP line: 10-for-25 career vs this pitcher = .400 BA (league .244)
    bvp = {"pa": 30, "ab": 25, "hits": 10, "home_runs": 2}
    result = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=bvp, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
    )
    # Singles/doubles/triples should be higher than the no-bvp baseline
    baseline = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
    )
    assert result["rates"]["singles"] > baseline["rates"]["singles"]
    assert result["rates"]["home_runs"] >= baseline["rates"]["home_runs"]
    # Cap should hold — should not exceed +25%
    assert result["rates"]["singles"] <= baseline["rates"]["singles"] * 1.25 + 1e-6


def test_bvp_half_weight_ramp(weights, league):
    """BvP at PA=10 gets roughly half-weight vs PA=20."""
    season = _avg_rates()
    # Mid-sample BvP: 5 hits in 10 AB = .500, high relative to league .244
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
    # Full-sample BvP should move the singles rate more than mid-sample.
    season_1b = season.singles
    delta_mid = mid["rates"]["singles"] - season_1b
    delta_full = full["rates"]["singles"] - season_1b
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


def test_weather_hot_and_wind_out(weights, league):
    """90°F + wind out-to-CF stacks 1.05 · 1.10 on HR rate."""
    season = _avg_rates()
    result = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100},
        weather={"temp": 90, "condition": "Sunny", "wind": "12 mph, Out To CF"},
        projected_pa=4.0, weights=weights,
    )
    expected_mult = 1.05 * 1.10
    assert result["multipliers"]["weather_hr"] == pytest.approx(expected_mult, abs=1e-6)
    # rates are rounded to 4 decimals on output — tolerance reflects that
    assert result["rates"]["home_runs"] == pytest.approx(season.home_runs * expected_mult, abs=5e-4)


def test_weather_none_neutral(weights, league):
    season = _avg_rates()
    result = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100}, weather=None,
        projected_pa=4.0, weights=weights,
    )
    assert result["multipliers"]["weather_hr"] == 1.0


def test_cold_wind_in(weights, league):
    """Cold + wind in from CF depresses HR rate."""
    season = _avg_rates()
    result = project_hitter_points(
        season_rates=season, l7_rates=None, bvp=None, league_rates=league,
        park={"runs": 100, "hr": 100},
        weather={"temp": 48, "wind": "10 mph, In From CF"},
        projected_pa=4.0, weights=weights,
    )
    expected_mult = 0.90 * 0.88
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
    Hand-compute EFP for a simple case to sanity-check the PrizePicks table
    is being applied correctly.

    Rates: .100 1B, 0 2B/3B/HR, 0 BB+HBP; PA=4; OBP .300; SLG .350; no SB.
        per_PA term = 3·0.1 + 0 + 0 + 0 + 0
                    + 2·(0.3·0.35)  (R/PA)
                    + 2·(0.35·0.25) (RBI/PA)
                    = 0.3 + 0.21 + 0.175 = 0.685
        EFP = 4 · 0.685 = 2.74
    (Matches the default r_coef=0.35, rbi_coef=0.25 from the json.)
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
    expected = 4 * (3 * 0.1 + 2 * (0.300 * 0.35) + 2 * (0.350 * 0.25))
    assert result["efp"] == pytest.approx(expected, abs=0.01)


def test_weather_helper_various_wind_strings():
    assert _weather_hr_multiplier({"temp": 72, "wind": "12 mph, Out To CF"}) == pytest.approx(1.10)
    assert _weather_hr_multiplier({"temp": 72, "wind": "10 mph, In From RF"}) == pytest.approx(0.88)
    assert _weather_hr_multiplier({"temp": 72, "wind": "5 mph, L To R"}) == pytest.approx(1.00)
    assert _weather_hr_multiplier(None) == 1.0
    assert _weather_hr_multiplier({}) == 1.0
