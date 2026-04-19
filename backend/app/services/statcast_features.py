"""
Statcast expected-stats features for Tier 1 of the Fantasy model.

Reads the local parquet cache at `.statcast_cache/batter_{id}.parquet` and
`.statcast_cache/pitcher_{id}.parquet`, computes per-batter and per-pitcher
advanced features **as-of a given date** (no look-ahead bias), and returns
them as plain dicts that plug straight into `project_hitter_points`.

Why this module exists
----------------------
Raw L7 outcome rates (HR%, 1B%) are ~3-5× noisier than the underlying
skills that drive them (barrel%, xwOBA, K%). A guy with 3 HRs in 30 L7
PAs has a 10% HR rate — mostly noise. His L7 barrel% over those same 30
balls in play is ~3× more stable and actually predicts next-game HR
probability. Blending these "skill" rates into the model lets us
distinguish hot-on-luck from hot-on-skill streaks.

Pure function design: no network, no state, safe to call from both
the live endpoint AND the backtest without drift.
"""

from __future__ import annotations

import json
import logging
import math
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

import pandas as pd

logger = logging.getLogger(__name__)

# Parquet cache location (relative to project root).
_CACHE_DIR = Path(__file__).resolve().parent.parent.parent.parent / ".statcast_cache"
_DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# League-average sprint speed (Savant).
LEAGUE_SPRINT_SPEED = 27.0


def _nan_to_none(v):
    """Convert NaN/Inf to None. Everything else returned as-is."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


@lru_cache(maxsize=512)
def _load_batter_parquet(player_id: int) -> pd.DataFrame | None:
    path = _CACHE_DIR / f"batter_{player_id}.parquet"
    if not path.exists():
        return None
    try:
        df = pd.read_parquet(path)
    except Exception as e:
        logger.warning("statcast_features: failed to read %s: %s", path, e)
        return None
    if "game_date" in df.columns:
        # Normalize to datetime for fast comparison.
        df["game_date"] = pd.to_datetime(df["game_date"], errors="coerce")
    return df


@lru_cache(maxsize=512)
def _load_pitcher_parquet(player_id: int) -> pd.DataFrame | None:
    path = _CACHE_DIR / f"pitcher_{player_id}.parquet"
    if not path.exists():
        return None
    try:
        df = pd.read_parquet(path)
    except Exception as e:
        logger.warning("statcast_features: failed to read %s: %s", path, e)
        return None
    if "game_date" in df.columns:
        df["game_date"] = pd.to_datetime(df["game_date"], errors="coerce")
    return df


def _season_window(end_date: str | date, season: int | None = None) -> tuple[pd.Timestamp, pd.Timestamp]:
    """Return (start, end) timestamps for a season-to-date slice that ENDS the
    day BEFORE `end_date`. Using end_date - 1 guarantees no leakage from
    the day we're projecting."""
    if isinstance(end_date, str):
        end_dt = pd.to_datetime(end_date)
    else:
        end_dt = pd.to_datetime(end_date)
    # Project as-of yesterday.
    end_exclusive = end_dt - pd.Timedelta(days=1)
    yr = season if season is not None else end_dt.year
    start = pd.Timestamp(year=yr, month=3, day=1)
    return start, end_exclusive


def _l7_window(df: pd.DataFrame, end_date: str | date, games: int = 7) -> pd.DataFrame:
    """Return the rows from df that fall in the most-recent `games` unique
    game_dates STRICTLY before end_date. Returns empty DF if the batter
    has no prior games."""
    if df is None or df.empty or "game_date" not in df.columns:
        return df.iloc[0:0] if df is not None else pd.DataFrame()
    end_dt = pd.to_datetime(end_date)
    prior = df[df["game_date"] < end_dt]
    if prior.empty:
        return prior
    unique_dates = sorted(prior["game_date"].dropna().unique(), reverse=True)[:games]
    if not unique_dates:
        return prior.iloc[0:0]
    return prior[prior["game_date"].isin(unique_dates)]


def _compute_batter_features(df: pd.DataFrame) -> dict:
    """Compute expected + contact-quality features from a batter's
    pitch-level Statcast slice. Returns zeros/None when sample is empty."""
    if df is None or df.empty:
        return {
            "xwoba": None, "xba": None, "xslg": None,
            "barrel_pct": None, "hard_hit_pct": None,
            "k_pct": None, "bb_pct": None,
            "pa": 0, "bip": 0,
        }

    events = df[df["events"].notna()] if "events" in df.columns else df.iloc[0:0]
    total_pa = int(len(events))

    # xwOBA is per-PA — computed on ALL events including walks (MLB includes
    # BB in the xwOBA denominator via the "estimated_woba_using_speedangle"
    # field, which assigns expected values to each PA result).
    xwoba = None
    if "estimated_woba_using_speedangle" in events.columns and not events.empty:
        vals = events["estimated_woba_using_speedangle"].dropna()
        if len(vals) > 0:
            xwoba = float(vals.mean())

    # xBA and xSLG are per-batted-ball (estimated from speed + angle on
    # balls in play).
    xba = None
    xslg = None
    if "estimated_ba_using_speedangle" in events.columns:
        vals = events["estimated_ba_using_speedangle"].dropna()
        if len(vals) > 0:
            xba = float(vals.mean())
    if "estimated_slg_using_speedangle" in events.columns:
        vals = events["estimated_slg_using_speedangle"].dropna()
        if len(vals) > 0:
            xslg = float(vals.mean())

    # Barrel: Savant tags barrels via launch_speed_angle == 6. Count as
    # share of batted balls (events where launch_speed is populated).
    batted = df[df["launch_speed"].notna()] if "launch_speed" in df.columns else df.iloc[0:0]
    bip = int(len(batted))
    barrel_pct = None
    hard_hit_pct = None
    if bip > 0:
        if "launch_speed_angle" in df.columns:
            barrels = batted[batted["launch_speed_angle"] == 6]
            barrel_pct = len(barrels) / bip
        hard = batted[batted["launch_speed"] >= 95]
        hard_hit_pct = len(hard) / bip

    # K% and BB% — share of PAs ending in strikeout/walk.
    k_pct = None
    bb_pct = None
    if total_pa > 0 and "events" in events.columns:
        strikeouts = events[events["events"].isin(["strikeout", "strikeout_double_play"])]
        walks = events[events["events"] == "walk"]
        k_pct = len(strikeouts) / total_pa
        bb_pct = len(walks) / total_pa

    return {
        "xwoba": _nan_to_none(xwoba),
        "xba": _nan_to_none(xba),
        "xslg": _nan_to_none(xslg),
        "barrel_pct": _nan_to_none(barrel_pct),
        "hard_hit_pct": _nan_to_none(hard_hit_pct),
        "k_pct": _nan_to_none(k_pct),
        "bb_pct": _nan_to_none(bb_pct),
        "pa": total_pa,
        "bip": bip,
    }


def get_batter_features_as_of(
    player_id: int,
    end_date: str | date,
    season: int | None = None,
) -> dict:
    """Season-to-date expected-stats for a batter through the day BEFORE
    `end_date`. Returns a dict with xwOBA, xBA, xSLG, barrel%, hard-hit%,
    K%, BB%, plus sample sizes `pa` and `bip`.

    When the parquet cache is missing or the batter has no prior games in
    the season, all rate fields come back as None (caller treats as
    neutral multiplier)."""
    df = _load_batter_parquet(player_id)
    if df is None:
        return _compute_batter_features(None)
    start, end = _season_window(end_date, season)
    slice_df = df[(df["game_date"] >= start) & (df["game_date"] <= end)]
    return _compute_batter_features(slice_df)


def get_batter_l7_features_as_of(
    player_id: int,
    end_date: str | date,
    games: int = 7,
) -> dict:
    """Same as `get_batter_features_as_of` but restricted to the last
    `games` unique game_dates strictly before `end_date`. Used to
    distinguish hot-on-luck from hot-on-skill streaks."""
    df = _load_batter_parquet(player_id)
    if df is None:
        return _compute_batter_features(None)
    l7_df = _l7_window(df, end_date, games)
    return _compute_batter_features(l7_df)


def _compute_pitcher_features(df: pd.DataFrame) -> dict:
    """Compute GB%/FB%/LD%, K%, BB%, barrel% allowed, hard-hit% allowed
    from a pitcher's pitch-level Statcast slice."""
    if df is None or df.empty:
        return {
            "gb_pct": None, "fb_pct": None, "ld_pct": None,
            "k_pct": None, "bb_pct": None,
            "barrel_pct_allowed": None, "hard_hit_pct_allowed": None,
            "bf": 0, "bip": 0,
        }

    events = df[df["events"].notna()] if "events" in df.columns else df.iloc[0:0]
    bf = int(len(events))

    # Batted-ball mix
    bb_typed = df[df["bb_type"].notna()] if "bb_type" in df.columns else df.iloc[0:0]
    total_bb = int(len(bb_typed))
    gb_pct = fb_pct = ld_pct = None
    if total_bb > 0:
        gb_pct = len(bb_typed[bb_typed["bb_type"] == "ground_ball"]) / total_bb
        fb_pct = len(bb_typed[bb_typed["bb_type"] == "fly_ball"]) / total_bb
        ld_pct = len(bb_typed[bb_typed["bb_type"] == "line_drive"]) / total_bb

    # K%, BB%
    k_pct = bb_pct = None
    if bf > 0:
        strikeouts = events[events["events"].isin(["strikeout", "strikeout_double_play"])]
        walks = events[events["events"] == "walk"]
        k_pct = len(strikeouts) / bf
        bb_pct = len(walks) / bf

    # Contact quality allowed
    batted = df[df["launch_speed"].notna()] if "launch_speed" in df.columns else df.iloc[0:0]
    bip = int(len(batted))
    barrel_pct_allowed = None
    hard_hit_pct_allowed = None
    if bip > 0:
        if "launch_speed_angle" in df.columns:
            barrels = batted[batted["launch_speed_angle"] == 6]
            barrel_pct_allowed = len(barrels) / bip
        hard = batted[batted["launch_speed"] >= 95]
        hard_hit_pct_allowed = len(hard) / bip

    return {
        "gb_pct": _nan_to_none(gb_pct),
        "fb_pct": _nan_to_none(fb_pct),
        "ld_pct": _nan_to_none(ld_pct),
        "k_pct": _nan_to_none(k_pct),
        "bb_pct": _nan_to_none(bb_pct),
        "barrel_pct_allowed": _nan_to_none(barrel_pct_allowed),
        "hard_hit_pct_allowed": _nan_to_none(hard_hit_pct_allowed),
        "bf": bf,
        "bip": bip,
    }


def get_pitcher_features_as_of(
    player_id: int,
    end_date: str | date,
    season: int | None = None,
) -> dict:
    """Season-to-date Statcast features for a pitcher through the day
    BEFORE `end_date`. Includes batted-ball mix (GB/FB/LD%), K%, BB%,
    barrel% allowed, hard-hit% allowed."""
    df = _load_pitcher_parquet(player_id)
    if df is None:
        return _compute_pitcher_features(None)
    start, end = _season_window(end_date, season)
    slice_df = df[(df["game_date"] >= start) & (df["game_date"] <= end)]
    return _compute_pitcher_features(slice_df)


def clear_cache() -> None:
    """Test helper — drop cached parquet frames so tests can mutate the
    filesystem between cases."""
    _load_batter_parquet.cache_clear()
    _load_pitcher_parquet.cache_clear()


# ---------------------------------------------------------------------------
# Tier 2 — Sprint Speed
# ---------------------------------------------------------------------------

_sprint_cache: dict[int, dict[int, float]] = {}


def _sprint_cache_path(season: int) -> Path:
    return _DATA_DIR / f"sprint_speed_{season}.json"


def _load_sprint_speed_table(season: int) -> dict[int, float]:
    """Return {player_id: sprint_speed_ft_per_sec} for the season.

    First-time call pulls via pybaseball.statcast_sprint_speed, writes a
    JSON cache to `backend/app/data/sprint_speed_<season>.json`. Subsequent
    calls read the JSON directly. No look-ahead concern: sprint speed is
    extraordinarily stable year-over-year (r>0.9) so using end-of-season
    value for mid-season projection is acceptable (the leakage is
    essentially nil)."""
    if season in _sprint_cache:
        return _sprint_cache[season]

    path = _sprint_cache_path(season)
    if path.exists():
        try:
            with path.open() as f:
                raw = json.load(f)
            table = {int(k): float(v) for k, v in raw.items()}
            _sprint_cache[season] = table
            return table
        except Exception as e:
            logger.warning("sprint_speed: cache read failed %s: %s", path, e)

    try:
        from pybaseball import statcast_sprint_speed
        df = statcast_sprint_speed(year=season)
    except Exception as e:
        logger.warning("sprint_speed: pybaseball fetch failed %s: %s", season, e)
        _sprint_cache[season] = {}
        return {}
    if df is None or df.empty:
        _sprint_cache[season] = {}
        return {}

    # Savant columns: player_id, sprint_speed (ft/sec)
    table: dict[int, float] = {}
    for _, row in df.iterrows():
        try:
            pid = int(row.get("player_id"))
            speed = float(row.get("sprint_speed"))
            if not math.isnan(speed):
                table[pid] = speed
        except (TypeError, ValueError):
            continue

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as f:
        json.dump({str(k): v for k, v in table.items()}, f)
    _sprint_cache[season] = table
    logger.info("sprint_speed: loaded %d players for %d (cached to %s)",
                len(table), season, path.name)
    return table


def get_sprint_speed(player_id: int, season: int) -> float | None:
    """Return player's sprint speed (ft/sec) for the season, or None if
    not in the Savant leaderboard (likely a call-up or low-PA player)."""
    table = _load_sprint_speed_table(season)
    val = table.get(int(player_id))
    return float(val) if val is not None else None
