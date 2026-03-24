"""
Umpire intelligence service using pybaseballstats umpire scorecards.
Provides umpire accuracy, zone tendencies, and historical run impact.
Data available back to 2008.
"""

import asyncio
import math
from datetime import date, timedelta

import pandas as pd


def _sf(val, decimals=1):
    """Safe float: return None for NaN/Inf."""
    if val is None:
        return None
    try:
        f = float(val)
        return None if (math.isnan(f) or math.isinf(f)) else round(f, decimals)
    except (TypeError, ValueError):
        return None


def _fetch_umpire_game_log(umpire_name: str, seasons: int = 3) -> pd.DataFrame | None:
    """
    Fetch game-by-game umpire scorecard data for the last N seasons.
    Uses pybaseballstats umpire_scorecards module.
    """
    try:
        from pybaseballstats.umpire_scorecards import umpire_game_log

        current_year = date.today().year
        frames = []
        for year in range(current_year - seasons + 1, current_year + 1):
            try:
                df = umpire_game_log(year)
                if df is not None and not df.empty:
                    # Filter to this umpire
                    name_col = None
                    for c in ["umpire_name", "umpire", "hp_umpire", "name"]:
                        if c in df.columns:
                            name_col = c
                            break
                    if name_col:
                        filtered = df[df[name_col].str.lower().str.contains(
                            umpire_name.split()[-1].lower(), na=False
                        )]
                        if not filtered.empty:
                            frames.append(filtered)
            except Exception:
                continue

        if frames:
            return pd.concat(frames, ignore_index=True)
    except ImportError:
        pass
    return None


def _fetch_umpire_summary(umpire_name: str) -> pd.DataFrame | None:
    """
    Fetch aggregated umpire career stats.
    """
    try:
        from pybaseballstats.umpire_scorecards import umpire_stats

        current_year = date.today().year
        frames = []
        for year in range(current_year - 2, current_year + 1):
            try:
                df = umpire_stats(year)
                if df is not None and not df.empty:
                    name_col = None
                    for c in ["umpire_name", "umpire", "hp_umpire", "name"]:
                        if c in df.columns:
                            name_col = c
                            break
                    if name_col:
                        filtered = df[df[name_col].str.lower().str.contains(
                            umpire_name.split()[-1].lower(), na=False
                        )]
                        if not filtered.empty:
                            frames.append(filtered)
            except Exception:
                continue

        if frames:
            return pd.concat(frames, ignore_index=True)
    except ImportError:
        pass
    return None


def _compute_umpire_profile(umpire_name: str) -> dict:
    """
    Build a full umpire profile with accuracy, tendencies, and run impact.
    Tries multiple pybaseballstats API shapes gracefully.
    """
    profile = {
        "name": umpire_name,
        "found": False,
        "gamesUmpired": None,
        "correctCallPct": None,
        "extraStrikesPer9": None,    # false strikes called (pitcher-friendly)
        "missedStrikesPer9": None,   # balls called on strikes (batter-friendly)
        "avgRunImpact": None,        # net run impact per game (+ favors home team)
        "pitcherFriendly": None,     # True if strikes > balls biased
        "zoneSizePct": None,         # strike zone size relative to average (100 = avg)
        "recentTrend": None,         # last 30 days accuracy
        "summary": None,             # human-readable summary
    }

    try:
        from pybaseballstats import umpire_scorecards as usc

        # Try different function signatures that pybaseballstats may expose
        current_year = date.today().year
        all_games = []

        for year in range(current_year - 2, current_year + 1):
            try:
                # Try umpire_game_log style
                if hasattr(usc, "umpire_game_log"):
                    df = usc.umpire_game_log(year)
                elif hasattr(usc, "get_umpire_scorecards"):
                    df = usc.get_umpire_scorecards(year)
                elif hasattr(usc, "scrape_umpire_scorecards"):
                    df = usc.scrape_umpire_scorecards(year)
                else:
                    # Try the module-level call pattern
                    import pybaseballstats
                    if hasattr(pybaseballstats, "umpire_game_log"):
                        df = pybaseballstats.umpire_game_log(year)
                    else:
                        break

                if df is None or df.empty:
                    continue

                # Convert Polars to Pandas if needed
                if hasattr(df, "to_pandas"):
                    df = df.to_pandas()

                # Find umpire name column
                name_col = None
                for c in ["umpire_name", "umpire", "hp_umpire", "name", "Umpire"]:
                    if c in df.columns:
                        name_col = c
                        break

                if name_col:
                    last_name = umpire_name.split()[-1].lower()
                    filtered = df[df[name_col].str.lower().str.contains(last_name, na=False)]
                    if not filtered.empty:
                        all_games.append(filtered)

            except Exception:
                continue

        if not all_games:
            return profile

        combined = pd.concat(all_games, ignore_index=True)
        n_games = len(combined)
        if n_games == 0:
            return profile

        profile["found"] = True
        profile["gamesUmpired"] = n_games

        # Correct call percentage
        for col in ["correct_calls_pct", "accuracy", "pct_correct", "correct_pct", "correct_call_rate"]:
            if col in combined.columns and combined[col].notna().any():
                profile["correctCallPct"] = _sf(combined[col].mean() * 100 if combined[col].mean() < 2 else combined[col].mean(), 1)
                break

        # Extra strikes (false strikes — pitcher-friendly calls)
        for col in ["extra_strikes", "extra_calls", "incorrect_calls_favor_pitcher"]:
            if col in combined.columns and combined[col].notna().any():
                # Normalize to per-9 innings estimate (avg ~30 PA per game)
                profile["extraStrikesPer9"] = _sf(combined[col].mean(), 2)
                break

        # Missed strikes (false balls — batter-friendly calls)
        for col in ["missed_strikes", "incorrect_calls_favor_batter", "favor_batter"]:
            if col in combined.columns and combined[col].notna().any():
                profile["missedStrikesPer9"] = _sf(combined[col].mean(), 2)
                break

        # Run impact
        for col in ["run_impact", "avg_run_impact", "net_run_impact", "total_run_impact"]:
            if col in combined.columns and combined[col].notna().any():
                profile["avgRunImpact"] = _sf(combined[col].mean(), 2)
                break

        # Zone size (relative to average)
        for col in ["zone_size", "strike_zone_size", "zone_pct"]:
            if col in combined.columns and combined[col].notna().any():
                avg_val = combined[col].mean()
                # Normalize to percentage relative to average
                profile["zoneSizePct"] = _sf(avg_val * 100 if avg_val < 2 else avg_val, 1)
                break

        # Determine pitcher-friendly bias
        extra = profile.get("extraStrikesPer9") or 0
        missed = profile.get("missedStrikesPer9") or 0
        if extra > 0 or missed > 0:
            profile["pitcherFriendly"] = extra > missed

        # Recent 30-day trend (if date column available)
        date_col = None
        for c in ["date", "game_date", "Date"]:
            if c in combined.columns:
                date_col = c
                break
        if date_col and profile.get("correctCallPct") is not None:
            try:
                combined[date_col] = pd.to_datetime(combined[date_col], errors="coerce")
                cutoff = pd.Timestamp(date.today() - timedelta(days=30))
                recent = combined[combined[date_col] >= cutoff]
                if not recent.empty:
                    for col in ["correct_calls_pct", "accuracy", "pct_correct", "correct_pct"]:
                        if col in recent.columns and recent[col].notna().any():
                            val = recent[col].mean()
                            profile["recentTrend"] = _sf(val * 100 if val < 2 else val, 1)
                            break
            except Exception:
                pass

        # Build human-readable summary
        acc = profile.get("correctCallPct")
        friendly = profile.get("pitcherFriendly")
        zone = profile.get("zoneSizePct")

        parts = []
        if acc is not None:
            parts.append(f"{acc}% accuracy")
        if friendly is True:
            parts.append("tends to favor pitchers (expanded zone)")
        elif friendly is False:
            parts.append("tends to favor batters (tight zone)")
        if zone is not None:
            if zone > 105:
                parts.append("large strike zone")
            elif zone < 95:
                parts.append("small strike zone")

        profile["summary"] = "; ".join(parts) if parts else "Data available but metrics unavailable"

    except ImportError:
        profile["summary"] = "pybaseballstats not installed"
    except Exception as e:
        profile["summary"] = f"Error fetching umpire data: {e}"

    return profile


async def get_umpire_profile(umpire_name: str) -> dict:
    """Async wrapper for umpire profile fetch."""
    return await asyncio.to_thread(_compute_umpire_profile, umpire_name)


# ---------------------------------------------------------------------------
# Umpire data for generate_data.py (static generation)
# ---------------------------------------------------------------------------

def fetch_umpire_for_game(umpire_name: str) -> dict:
    """
    Synchronous version for use in generate_data.py.
    Returns umpire profile for embedding in game data.
    """
    return _compute_umpire_profile(umpire_name)
