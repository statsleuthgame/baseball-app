"""
FanGraphs season stats via pybaseball.
Provides WAR, wRC+, FIP, xFIP, SIERA, K-BB%, ISO, and more
for batters and pitchers by season.
"""

import asyncio
import logging
import math
from datetime import date

import pandas as pd

logger = logging.getLogger(__name__)


def _sf(val, decimals=1):
    """Safe float: return None for NaN/Inf."""
    if val is None:
        return None
    try:
        f = float(val)
        return None if (math.isnan(f) or math.isinf(f)) else round(f, decimals)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Player ID cross-reference (MLBAM ↔ FanGraphs)
# ---------------------------------------------------------------------------

_id_cache: dict = {}  # "lastname_firstname" -> {"mlbam": int, "fangraphs": str, ...}


def lookup_player_ids(last: str, first: str) -> dict:
    """Return cross-reference IDs for a player (cached)."""
    key = f"{last.lower()}_{first.lower()}"
    if key in _id_cache:
        return _id_cache[key]
    try:
        from pybaseball import playerid_lookup
        df = playerid_lookup(last, first)
        if df is None or df.empty:
            return {}
        row = df.iloc[0]
        result = {
            "mlbam": int(row.get("key_mlbam")) if pd.notna(row.get("key_mlbam")) else None,
            "fangraphs": str(row.get("key_fangraphs")) if pd.notna(row.get("key_fangraphs")) else None,
            "bref": str(row.get("key_bbref")) if pd.notna(row.get("key_bbref")) else None,
            "retro": str(row.get("key_retro")) if pd.notna(row.get("key_retro")) else None,
        }
        _id_cache[key] = result
        return result
    except Exception:
        return {}


_chadwick_map: dict | None = None  # mlbam_id -> fangraphs_id


def _get_chadwick_map() -> dict:
    """
    Load the Chadwick Bureau player ID cross-reference table (cached).
    Maps MLBAM ID -> FanGraphs ID for all players in history.
    """
    global _chadwick_map
    if _chadwick_map is not None:
        return _chadwick_map
    try:
        from pybaseball.datasources.chadwick_register import get_chadwick_register
        df = get_chadwick_register()
        if df is not None and not df.empty:
            _chadwick_map = {}
            for _, row in df.iterrows():
                mlbam = row.get("key_mlbam")
                fg = row.get("key_fangraphs")
                if pd.notna(mlbam) and pd.notna(fg):
                    try:
                        _chadwick_map[int(mlbam)] = str(int(fg))
                    except (ValueError, TypeError):
                        pass
    except Exception:
        pass
    if _chadwick_map is None:
        _chadwick_map = {}
    return _chadwick_map


def mlbam_to_fangraphs_id(mlbam_id: int) -> str | None:
    """Convert an MLBAM player ID to a FanGraphs player ID via Chadwick Register."""
    m = _get_chadwick_map()
    return m.get(mlbam_id)


# ---------------------------------------------------------------------------
# Season-level FanGraphs batting stats
# ---------------------------------------------------------------------------

_batting_cache: dict = {}  # season -> DataFrame


def _get_batting_df(season: int) -> pd.DataFrame | None:
    if season in _batting_cache:
        return _batting_cache[season]
    try:
        from pybaseball import batting_stats
        df = batting_stats(season, qual=1)
        if df is not None and not df.empty:
            _batting_cache[season] = df
            return df
    except Exception as e:
        logger.warning("FanGraphs batting_stats(%d) failed: %s", season, e)
    return None


def _get_batting_range_df(start_dt: str, end_dt: str) -> pd.DataFrame | None:
    try:
        from pybaseball import batting_stats_range
        df = batting_stats_range(start_dt, end_dt)
        return df if df is not None and not df.empty else None
    except Exception as e:
        logger.warning("FanGraphs batting_stats_range failed: %s", e)
        return None


def get_batter_fangraphs(player_name: str, season: int) -> dict:
    """
    Fetch FanGraphs season batting stats for a player by full name.
    Returns WAR, wRC+, wOBA, K%, BB%, K-BB%, ISO, BABIP, O-Swing%, and more.
    """
    df = _get_batting_df(season)
    if df is None:
        return {}

    # FanGraphs uses "Name" column
    name_col = "Name" if "Name" in df.columns else None
    if name_col is None:
        return {}

    row = df[df[name_col].str.lower() == player_name.lower()]
    if row.empty:
        # Try partial match (last name)
        parts = player_name.split()
        if len(parts) >= 2:
            last = parts[-1]
            row = df[df[name_col].str.lower().str.contains(last.lower(), na=False)]
    if row.empty:
        return {}

    r = row.iloc[0]

    def col(name, dec=1):
        return _sf(r.get(name), dec)

    return {
        "war": col("WAR", 1),
        "wrcPlus": col("wRC+", 0),
        "woba": col("wOBA", 3),
        "obp": col("OBP", 3),
        "slg": col("SLG", 3),
        "iso": col("ISO", 3),
        "babip": col("BABIP", 3),
        "kPct": col("K%", 1),
        "bbPct": col("BB%", 1),
        "kBbPct": col("K-BB%", 1),
        "oSwingPct": col("O-Swing%", 1),
        "zContactPct": col("Z-Contact%", 1),
        "swstrPct": col("SwStr%", 1),
        "spd": col("Spd", 1),
        "offWar": col("Off", 1),
        "defWar": col("Def", 1),
        "pa": int(r.get("PA", 0)) if pd.notna(r.get("PA", None)) else None,
    }


async def get_batter_fangraphs_async(player_name: str, season: int) -> dict:
    return await asyncio.to_thread(get_batter_fangraphs, player_name, season)


# ---------------------------------------------------------------------------
# Recent rolling batting stats (date range)
# ---------------------------------------------------------------------------

def get_batter_recent_fangraphs(player_name: str, days: int = 14) -> dict:
    """Get recent FanGraphs batting stats for a player over the last N days."""
    end_dt = date.today().isoformat()
    start_dt = (date.today().__class__.fromordinal(date.today().toordinal() - days)).isoformat()
    df = _get_batting_range_df(start_dt, end_dt)
    if df is None:
        return {}

    name_col = "Name" if "Name" in df.columns else None
    if name_col is None:
        return {}

    row = df[df[name_col].str.lower() == player_name.lower()]
    if row.empty:
        parts = player_name.split()
        if len(parts) >= 2:
            last = parts[-1]
            row = df[df[name_col].str.lower().str.contains(last.lower(), na=False)]
    if row.empty:
        return {}

    r = row.iloc[0]

    def col(name, dec=1):
        return _sf(r.get(name), dec)

    return {
        "wrcPlus": col("wRC+", 0),
        "woba": col("wOBA", 3),
        "iso": col("ISO", 3),
        "kPct": col("K%", 1),
        "bbPct": col("BB%", 1),
        "babip": col("BABIP", 3),
    }


# ---------------------------------------------------------------------------
# Season-level FanGraphs pitching stats
# ---------------------------------------------------------------------------

_pitching_cache: dict = {}  # season -> DataFrame


def _get_pitching_df(season: int) -> pd.DataFrame | None:
    if season in _pitching_cache:
        return _pitching_cache[season]
    try:
        from pybaseball import pitching_stats
        df = pitching_stats(season, qual=1)
        if df is not None and not df.empty:
            _pitching_cache[season] = df
            return df
    except Exception as e:
        logger.warning("FanGraphs pitching_stats(%d) failed: %s", season, e)
    return None


def get_pitcher_fangraphs(player_name: str, season: int) -> dict:
    """
    Fetch FanGraphs season pitching stats for a player by full name.
    Returns WAR, FIP, xFIP, SIERA, ERA-, K%, BB%, K-BB%, GB%, LOB%, and more.
    """
    df = _get_pitching_df(season)
    if df is None:
        return {}

    name_col = "Name" if "Name" in df.columns else None
    if name_col is None:
        return {}

    row = df[df[name_col].str.lower() == player_name.lower()]
    if row.empty:
        parts = player_name.split()
        if len(parts) >= 2:
            last = parts[-1]
            row = df[df[name_col].str.lower().str.contains(last.lower(), na=False)]
    if row.empty:
        return {}

    r = row.iloc[0]

    def col(name, dec=1):
        return _sf(r.get(name), dec)

    era = col("ERA", 2)
    fip = col("FIP", 2)
    era_fip_diff = _sf((era or 0) - (fip or 0), 2) if era is not None and fip is not None else None
    regression_alert = None
    if era_fip_diff is not None:
        if era_fip_diff > 1.0:
            regression_alert = "ERA significantly higher than FIP — ERA likely to improve"
        elif era_fip_diff < -1.0:
            regression_alert = "ERA significantly lower than FIP — ERA likely to worsen"

    return {
        "war": col("WAR", 1),
        "era": era,
        "fip": fip,
        "xfip": col("xFIP", 2),
        "siera": col("SIERA", 2),
        "eraMinus": col("ERA-", 0),
        "fipMinus": col("FIP-", 0),
        "kPct": col("K%", 1),
        "bbPct": col("BB%", 1),
        "kBbPct": col("K-BB%", 1),
        "hrPer9": col("HR/9", 2),
        "gbPct": col("GB%", 1),
        "lobPct": col("LOB%", 1),
        "whip": col("WHIP", 2),
        "babip": col("BABIP", 3),
        "swstrPct": col("SwStr%", 1),
        "ip": col("IP", 1),
        "eraMinus_fip_diff": era_fip_diff,
        "regressionAlert": regression_alert,
    }


async def get_pitcher_fangraphs_async(player_name: str, season: int) -> dict:
    return await asyncio.to_thread(get_pitcher_fangraphs, player_name, season)


# ---------------------------------------------------------------------------
# League-wide leaderboards
# ---------------------------------------------------------------------------

def get_league_batting_leaderboard(season: int) -> list[dict]:
    """All qualified batters ranked by wRC+."""
    df = _get_batting_df(season)
    if df is None:
        return []

    rows = []
    for _, r in df.iterrows():
        rows.append({
            "name": r.get("Name", ""),
            "team": r.get("Team", ""),
            "pa": int(r.get("PA", 0)) if pd.notna(r.get("PA", None)) else None,
            "war": _sf(r.get("WAR"), 1),
            "wrcPlus": _sf(r.get("wRC+"), 0),
            "woba": _sf(r.get("wOBA"), 3),
            "iso": _sf(r.get("ISO"), 3),
            "kPct": _sf(r.get("K%"), 1),
            "bbPct": _sf(r.get("BB%"), 1),
            "kBbPct": _sf(r.get("K-BB%"), 1),
            "babip": _sf(r.get("BABIP"), 3),
            "avg": _sf(r.get("AVG"), 3),
            "obp": _sf(r.get("OBP"), 3),
            "slg": _sf(r.get("SLG"), 3),
        })

    rows.sort(key=lambda x: (x.get("wrcPlus") or 0), reverse=True)
    return rows


def get_league_pitching_leaderboard(season: int) -> list[dict]:
    """All qualified pitchers ranked by FIP."""
    df = _get_pitching_df(season)
    if df is None:
        return []

    rows = []
    for _, r in df.iterrows():
        era = _sf(r.get("ERA"), 2)
        fip = _sf(r.get("FIP"), 2)
        era_fip_diff = _sf((era or 0) - (fip or 0), 2) if era is not None and fip is not None else None
        rows.append({
            "name": r.get("Name", ""),
            "team": r.get("Team", ""),
            "ip": _sf(r.get("IP"), 1),
            "war": _sf(r.get("WAR"), 1),
            "era": era,
            "fip": fip,
            "xfip": _sf(r.get("xFIP"), 2),
            "siera": _sf(r.get("SIERA"), 2),
            "eraMinus": _sf(r.get("ERA-"), 0),
            "kPct": _sf(r.get("K%"), 1),
            "bbPct": _sf(r.get("BB%"), 1),
            "kBbPct": _sf(r.get("K-BB%"), 1),
            "gbPct": _sf(r.get("GB%"), 1),
            "whip": _sf(r.get("WHIP"), 2),
            "eraMinus_fip_diff": era_fip_diff,
        })

    rows.sort(key=lambda x: (x.get("fip") or 99))
    return rows


def get_kbb_leaderboard(season: int, top_n: int = 25) -> dict:
    """Top and bottom K-BB% pitchers."""
    df = _get_pitching_df(season)
    if df is None:
        return {"top": [], "bottom": []}

    rows = []
    for _, r in df.iterrows():
        kbb = _sf(r.get("K-BB%"), 1)
        if kbb is None:
            continue
        rows.append({
            "name": r.get("Name", ""),
            "team": r.get("Team", ""),
            "ip": _sf(r.get("IP"), 1),
            "kBbPct": kbb,
            "kPct": _sf(r.get("K%"), 1),
            "bbPct": _sf(r.get("BB%"), 1),
            "era": _sf(r.get("ERA"), 2),
            "fip": _sf(r.get("FIP"), 2),
            "war": _sf(r.get("WAR"), 1),
        })

    rows.sort(key=lambda x: (x.get("kBbPct") or -99), reverse=True)
    return {
        "top": rows[:top_n],
        "bottom": rows[-top_n:][::-1],
    }


async def get_kbb_leaderboard_async(season: int) -> dict:
    return await asyncio.to_thread(get_kbb_leaderboard, season)


async def get_league_batting_leaderboard_async(season: int) -> list[dict]:
    return await asyncio.to_thread(get_league_batting_leaderboard, season)


async def get_league_pitching_leaderboard_async(season: int) -> list[dict]:
    return await asyncio.to_thread(get_league_pitching_leaderboard, season)


# ---------------------------------------------------------------------------
# Percentile rankings across all qualified players
# ---------------------------------------------------------------------------

def compute_batter_percentiles(season: int) -> dict:
    """
    Compute per-metric percentile ranks for all qualified batters.
    Returns {player_name: {metric: percentile_0_to_100, ...}, ...}
    """
    df = _get_batting_df(season)
    if df is None:
        return {}

    metrics = {
        "wrcPlus": ("wRC+", True),   # higher is better
        "woba": ("wOBA", True),
        "iso": ("ISO", True),
        "kPct": ("K%", False),        # lower is better
        "bbPct": ("BB%", True),
        "babip": ("BABIP", True),
        "war": ("WAR", True),
        "obp": ("OBP", True),
        "slg": ("SLG", True),
    }

    result = {}
    for _, r in df.iterrows():
        name = r.get("Name", "")
        if not name:
            continue
        player_pcts = {}
        for key, (col_name, higher_is_better) in metrics.items():
            if col_name not in df.columns:
                continue
            val = r.get(col_name)
            if pd.isna(val):
                continue
            col_series = df[col_name].dropna()
            if col_series.empty:
                continue
            rank = (col_series < val).sum() / len(col_series) * 100
            if not higher_is_better:
                rank = 100 - rank
            player_pcts[key] = round(rank, 0)
        result[name] = player_pcts

    return result


def compute_pitcher_percentiles(season: int) -> dict:
    """
    Compute per-metric percentile ranks for all qualified pitchers.
    """
    df = _get_pitching_df(season)
    if df is None:
        return {}

    metrics = {
        "war": ("WAR", True),
        "era": ("ERA", False),         # lower is better
        "fip": ("FIP", False),
        "xfip": ("xFIP", False),
        "siera": ("SIERA", False),
        "kPct": ("K%", True),
        "bbPct": ("BB%", False),
        "kBbPct": ("K-BB%", True),
        "gbPct": ("GB%", True),
        "whip": ("WHIP", False),
        "swstrPct": ("SwStr%", True),
    }

    result = {}
    for _, r in df.iterrows():
        name = r.get("Name", "")
        if not name:
            continue
        player_pcts = {}
        for key, (col_name, higher_is_better) in metrics.items():
            if col_name not in df.columns:
                continue
            val = r.get(col_name)
            if pd.isna(val):
                continue
            col_series = df[col_name].dropna()
            if col_series.empty:
                continue
            rank = (col_series < val).sum() / len(col_series) * 100
            if not higher_is_better:
                rank = 100 - rank
            player_pcts[key] = round(rank, 0)
        result[name] = player_pcts

    return result


# ---------------------------------------------------------------------------
# Team-level batting/pitching stats
# ---------------------------------------------------------------------------

def get_team_batting_stats(season: int) -> list[dict]:
    """All 30 teams' batting stats from FanGraphs."""
    try:
        from pybaseball import team_batting
        df = team_batting(season)
        if df is None or df.empty:
            return []

        rows = []
        for _, r in df.iterrows():
            rows.append({
                "team": r.get("Team", ""),
                "pa": int(r.get("PA", 0)) if pd.notna(r.get("PA", None)) else None,
                "avg": _sf(r.get("AVG"), 3),
                "obp": _sf(r.get("OBP"), 3),
                "slg": _sf(r.get("SLG"), 3),
                "ops": _sf(r.get("OPS"), 3),
                "wrcPlus": _sf(r.get("wRC+"), 0),
                "woba": _sf(r.get("wOBA"), 3),
                "iso": _sf(r.get("ISO"), 3),
                "war": _sf(r.get("WAR"), 1),
                "kPct": _sf(r.get("K%"), 1),
                "bbPct": _sf(r.get("BB%"), 1),
                "babip": _sf(r.get("BABIP"), 3),
            })

        rows.sort(key=lambda x: (x.get("wrcPlus") or 0), reverse=True)
        for i, row in enumerate(rows):
            row["rank"] = i + 1
        return rows
    except Exception as e:
        logger.warning("team_batting(%d) failed: %s", season, e)
        return []


def get_team_pitching_stats(season: int) -> list[dict]:
    """All 30 teams' pitching stats from FanGraphs."""
    try:
        from pybaseball import team_pitching
        df = team_pitching(season)
        if df is None or df.empty:
            return []

        rows = []
        for _, r in df.iterrows():
            rows.append({
                "team": r.get("Team", ""),
                "ip": _sf(r.get("IP"), 1),
                "era": _sf(r.get("ERA"), 2),
                "fip": _sf(r.get("FIP"), 2),
                "xfip": _sf(r.get("xFIP"), 2),
                "war": _sf(r.get("WAR"), 1),
                "kPct": _sf(r.get("K%"), 1),
                "bbPct": _sf(r.get("BB%"), 1),
                "kBbPct": _sf(r.get("K-BB%"), 1),
                "gbPct": _sf(r.get("GB%"), 1),
                "whip": _sf(r.get("WHIP"), 2),
                "hrPer9": _sf(r.get("HR/9"), 2),
                "lobPct": _sf(r.get("LOB%"), 1),
            })

        rows.sort(key=lambda x: (x.get("fip") or 99))
        for i, row in enumerate(rows):
            row["rank"] = i + 1
        return rows
    except Exception as e:
        logger.warning("team_pitching(%d) failed: %s", season, e)
        return []
