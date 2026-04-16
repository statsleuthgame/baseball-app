import asyncio
import logging
import math
from datetime import date, timedelta

import pandas as pd

from app.config import get_current_season

logger = logging.getLogger(__name__)


def _safe_float(val, decimals=1):
    """Convert a value to a JSON-safe float, returning None for NaN/Inf."""
    if val is None or (isinstance(val, float) and (math.isnan(val) or math.isinf(val))):
        return None
    try:
        return round(float(val), decimals)
    except (TypeError, ValueError):
        return None


def _safe_str(val, default=""):
    """Return string value, handling NaN/None/NaT."""
    if val is None or (isinstance(val, float) and (val != val)):  # NaN check
        return default
    s = str(val)
    return default if s in ("NaT", "nan", "None") else s


async def get_hot_batters(team_roster_ids: list[int], days: int = 14) -> list[dict]:
    """Get batting stats for players over the last N days using pybaseball."""
    try:
        result = await asyncio.to_thread(_fetch_hot_batters, team_roster_ids, days)
        return result
    except Exception as e:
        logger.warning("Hot batters fetch failed: %s", e)
        return []


def _fetch_hot_batters(player_ids: list[int], days: int) -> list[dict]:
    from pybaseball import statcast_batter

    end_dt = date.today().isoformat()
    start_dt = (date.today() - timedelta(days=days)).isoformat()

    all_data = []
    for pid in player_ids:
        try:
            df = statcast_batter(start_dt, end_dt, pid)
            if df is not None and not df.empty:
                stats = _compute_batter_stats(df, pid)
                if stats and stats.get("pa", 0) >= 10:
                    all_data.append(stats)
        except Exception:
            continue

    # Enrich with FanGraphs rolling stats (wRC+, wOBA, K%, BB%)
    try:
        from pybaseball import batting_stats_range
        fg_df = batting_stats_range(start_dt, end_dt)
        if fg_df is not None and not fg_df.empty and "Name" in fg_df.columns:
            fg_lookup: dict = {}
            for _, row in fg_df.iterrows():
                name = str(row.get("Name", "")).lower()
                fg_lookup[name] = row

            for player in all_data:
                p_name = player.get("playerName", "").lower()
                if not p_name:
                    continue
                fg_row = fg_lookup.get(p_name)
                if fg_row is None:
                    # Try last-name match
                    last = p_name.split()[-1] if p_name else ""
                    for key, val in fg_lookup.items():
                        if key.endswith(last):
                            fg_row = val
                            break
                if fg_row is not None:
                    def _sf(v, d=1, pct=False):
                        try:
                            import math as _m
                            f = float(v)
                            if _m.isnan(f) or _m.isinf(f):
                                return None
                            if pct and f < 1:
                                f *= 100
                            return round(f, d)
                        except Exception:
                            return None
                    player["wrcPlus"] = _sf(fg_row.get("wRC+"), 0)
                    player["woba"] = _sf(fg_row.get("wOBA"), 3)
                    player["kPct"] = _sf(fg_row.get("K%"), 1, pct=True)
                    player["bbPct"] = _sf(fg_row.get("BB%"), 1, pct=True)
                    player["iso"] = _sf(fg_row.get("ISO"), 3)
    except Exception:
        pass  # FanGraphs enrichment is best-effort

    # Sort by OPS descending
    all_data.sort(key=lambda x: x.get("ops", 0), reverse=True)
    return all_data[:10]


def _compute_batter_stats(df: pd.DataFrame, player_id: int) -> dict:
    """Compute batting stats from statcast pitch-level data."""
    # Filter to at-bat ending events
    ab_events = df[df["events"].notna()].copy()
    if ab_events.empty:
        return {}

    total_pa = len(ab_events)
    hits = ab_events[ab_events["events"].isin(["single", "double", "triple", "home_run"])]
    singles = len(ab_events[ab_events["events"] == "single"])
    doubles = len(ab_events[ab_events["events"] == "double"])
    triples = len(ab_events[ab_events["events"] == "triple"])
    home_runs = len(ab_events[ab_events["events"] == "home_run"])
    total_hits = len(hits)

    # Walks and HBP don't count as ABs
    walks = len(ab_events[ab_events["events"].isin(["walk"])])
    hbp = len(ab_events[ab_events["events"] == "hit_by_pitch"])
    sac_flies = len(ab_events[ab_events["events"] == "sac_fly"])
    strikeouts = len(ab_events[ab_events["events"].isin(["strikeout", "strikeout_double_play"])])

    ab = total_pa - walks - hbp - sac_flies
    if ab == 0:
        return {}

    avg = total_hits / ab
    obp = (total_hits + walks + hbp) / total_pa if total_pa > 0 else 0
    slg = (singles + 2 * doubles + 3 * triples + 4 * home_runs) / ab
    ops = obp + slg

    # Get player name from the data
    player_name = ""
    if "player_name" in df.columns and not df["player_name"].empty:
        player_name = df["player_name"].iloc[0]

    return {
        "playerId": player_id,
        "playerName": _safe_str(player_name),
        "pa": total_pa,
        "ab": ab,
        "hits": total_hits,
        "doubles": doubles,
        "triples": triples,
        "homeRuns": home_runs,
        "walks": walks,
        "strikeouts": strikeouts,
        "avg": _safe_float(avg, 3),
        "obp": _safe_float(obp, 3),
        "slg": _safe_float(slg, 3),
        "ops": _safe_float(ops, 3),
        "photoUrl": (
            f"https://img.mlbstatic.com/mlb-photos/image/upload/"
            f"d_people:generic:headshot:67:current.png/"
            f"w_213,q_auto:best/v1/people/{player_id}/headshot/67/current"
        ),
    }


async def get_spray_chart_data(player_id: int, home_team: str | None = None, season: int | None = None) -> dict:
    """Get batted ball data for spray chart visualization, optionally filtered by park."""
    try:
        result = await asyncio.to_thread(_fetch_spray_data, player_id, home_team, season)
        return result
    except Exception as e:
        logger.warning("Spray chart fetch failed: %s", e)
        return {"hits": [], "summary": {}}


def _fetch_spray_data(player_id: int, home_team: str | None, season: int | None) -> dict:
    from pybaseball import statcast_batter

    if season:
        start_dt = f"{season}-03-01"
        end_dt = f"{season}-11-30"
    else:
        # Default to all available data for career view
        start_dt = "2015-01-01"
        end_dt = date.today().isoformat()

    df = statcast_batter(start_dt, end_dt, player_id)
    if df is None or df.empty:
        return {"hits": [], "summary": {}}

    # Filter to batted balls with coordinates
    batted = df[df["hc_x"].notna() & df["hc_y"].notna() & df["events"].notna()].copy()

    # Filter by park (home_team column tells us which park the game was at)
    if home_team and "home_team" in batted.columns:
        batted = batted[batted["home_team"] == home_team.upper()]

    if batted.empty:
        return {"hits": [], "summary": {"single": 0, "double": 0, "triple": 0, "home_run": 0, "out": 0, "total": 0}}

    hits = []
    summary = {"single": 0, "double": 0, "triple": 0, "home_run": 0, "out": 0, "total": 0}

    for _, row in batted.iterrows():
        event = row["events"]
        # Transform coordinates: center home plate at origin
        x = row["hc_x"] - 125.42
        y = 198.27 - row["hc_y"]

        result_type = event if event in ("single", "double", "triple", "home_run") else "out"
        summary[result_type] = summary.get(result_type, 0) + 1
        summary["total"] += 1

        hits.append({
            "x": _safe_float(x),
            "y": _safe_float(y),
            "result": result_type,
            "event": event,
            "date": _safe_str(row.get("game_date", "")),
            "exitVelo": _safe_float(row.get("launch_speed")),
            "launchAngle": _safe_float(row.get("launch_angle")),
            "pitchType": _safe_str(row.get("pitch_type", "")),
            "hitDistance": _safe_float(row.get("hit_distance_sc"), 0),
        })

    return {"hits": hits, "summary": summary}


async def get_pitch_arsenal(player_id: int, season: int | None = None) -> dict:
    """Get pitch type breakdown for a pitcher."""
    try:
        result = await asyncio.to_thread(_fetch_pitch_arsenal, player_id, season)
        return result
    except Exception as e:
        logger.warning("Pitch arsenal fetch failed: %s", e)
        return {"pitches": [], "totalPitches": 0}


def _fetch_pitch_arsenal(player_id: int, season: int | None) -> dict:
    from pybaseball import statcast_pitcher

    if season:
        start_dt = f"{season}-03-01"
        end_dt = f"{season}-11-30"
    else:
        start_dt = f"{get_current_season()}-03-01"
        end_dt = date.today().isoformat()

    df = statcast_pitcher(start_dt, end_dt, player_id)
    if df is None or df.empty:
        return {"pitches": [], "totalPitches": 0}

    # Filter to actual pitches (not intentional balls, etc.)
    pitches = df[df["pitch_type"].notna() & (df["pitch_type"] != "")].copy()
    if pitches.empty:
        return {"pitches": [], "totalPitches": 0}

    total = len(pitches)
    arsenal = []

    PITCH_NAMES = {
        "FF": "4-Seam Fastball", "SI": "Sinker", "FC": "Cutter",
        "SL": "Slider", "CU": "Curveball", "KC": "Knuckle Curve",
        "CH": "Changeup", "FS": "Splitter", "SV": "Sweeper",
        "ST": "Sweeping Curve", "KN": "Knuckleball",
        "CS": "Slow Curve", "EP": "Eephus", "SC": "Screwball",
        "FA": "Fastball", "IN": "Int. Ball", "PO": "Pitchout",
    }

    for pitch_type, group in pitches.groupby("pitch_type"):
        count = len(group)
        usage_pct = round(count / total * 100, 1)

        # Average velocity
        avg_velo = round(group["release_speed"].mean(), 1) if group["release_speed"].notna().any() else None

        # Average spin rate
        avg_spin = round(group["release_spin_rate"].mean(), 0) if "release_spin_rate" in group.columns and group["release_spin_rate"].notna().any() else None

        # Whiff rate: swinging strikes / swings
        swings = group[group["description"].isin([
            "swinging_strike", "swinging_strike_blocked", "foul", "foul_tip",
            "hit_into_play", "hit_into_play_no_out", "hit_into_play_score",
        ])]
        whiffs = group[group["description"].isin(["swinging_strike", "swinging_strike_blocked"])]
        whiff_rate = round(len(whiffs) / len(swings) * 100, 1) if len(swings) > 0 else None

        # Called strike + swinging strike rate (CSW%)
        strikes = group[group["description"].isin([
            "called_strike", "swinging_strike", "swinging_strike_blocked",
        ])]
        csw_pct = round(len(strikes) / count * 100, 1) if count > 0 else None

        # Put-away rate: strikeouts on this pitch / 2-strike counts with this pitch
        two_strike = group[(group["strikes"] == 2)]
        strikeout_events = two_strike[two_strike["events"].isin(["strikeout", "strikeout_double_play"])] if "events" in two_strike.columns else pd.DataFrame()
        putaway_rate = round(len(strikeout_events) / len(two_strike) * 100, 1) if len(two_strike) > 0 else None

        # Batting average against
        balls_in_play = group[group["events"].notna()]
        hits_against = balls_in_play[balls_in_play["events"].isin(["single", "double", "triple", "home_run"])]
        non_walk = balls_in_play[~balls_in_play["events"].isin(["walk", "hit_by_pitch", "sac_fly", "sac_bunt"])]
        ba_against = round(len(hits_against) / len(non_walk), 3) if len(non_walk) > 0 else None

        # Average horizontal and vertical movement
        avg_pfx_x = round(group["pfx_x"].mean() * 12, 1) if group["pfx_x"].notna().any() else None  # convert to inches
        avg_pfx_z = round(group["pfx_z"].mean() * 12, 1) if group["pfx_z"].notna().any() else None

        arsenal.append({
            "pitchType": _safe_str(pitch_type),
            "pitchName": PITCH_NAMES.get(pitch_type, _safe_str(pitch_type)),
            "count": count,
            "usagePct": _safe_float(usage_pct, 1),
            "avgVelo": _safe_float(avg_velo, 1),
            "avgSpin": int(avg_spin) if avg_spin else None,
            "whiffRate": _safe_float(whiff_rate, 1),
            "cswPct": _safe_float(csw_pct, 1),
            "putawayRate": _safe_float(putaway_rate, 1),
            "baAgainst": _safe_float(ba_against, 3),
            "horzBreak": _safe_float(avg_pfx_x, 1),
            "vertBreak": _safe_float(avg_pfx_z, 1),
        })

    arsenal.sort(key=lambda x: x["usagePct"], reverse=True)
    return {"pitches": arsenal, "totalPitches": total}


async def get_dominance_profile(player_id: int, season: int | None = None) -> dict:
    """Get pitcher dominance splits by batter handedness and batted ball type."""
    try:
        result = await asyncio.to_thread(_fetch_dominance_profile, player_id, season)
        return result
    except Exception as e:
        logger.warning("Dominance profile fetch failed: %s", e)
        return {}


def _fetch_dominance_profile(player_id: int, season: int | None) -> dict:
    from pybaseball import statcast_pitcher

    if season:
        start_dt = f"{season}-03-01"
        end_dt = f"{season}-11-30"
    else:
        start_dt = f"{get_current_season()}-03-01"
        end_dt = date.today().isoformat()

    df = statcast_pitcher(start_dt, end_dt, player_id)
    if df is None or df.empty:
        return {}

    result = {
        "byHandedness": _splits_by_handedness(df),
        "byBattedBallType": _splits_by_bb_type(df),
        "situational": _situational_stats(df),
    }
    return result


def _splits_by_handedness(df: pd.DataFrame) -> list[dict]:
    """Performance splits vs LHB and RHB."""
    splits = []
    for side, label in [("L", "vs LHB"), ("R", "vs RHB")]:
        sub = df[df["stand"] == side]
        if sub.empty:
            continue
        stats = _compute_pitcher_split_stats(sub)
        stats["label"] = label
        stats["side"] = side
        splits.append(stats)
    return splits


def _splits_by_bb_type(df: pd.DataFrame) -> list[dict]:
    """Batted ball type breakdown."""
    batted = df[df["bb_type"].notna()]
    if batted.empty:
        return []

    total_batted = len(batted)
    results = []
    BB_LABELS = {
        "ground_ball": "Ground Ball",
        "fly_ball": "Fly Ball",
        "line_drive": "Line Drive",
        "popup": "Popup",
    }

    for bb_type, label in BB_LABELS.items():
        sub = batted[batted["bb_type"] == bb_type]
        count = len(sub)
        if count == 0:
            continue
        pct = round(count / total_batted * 100, 1)

        # BA on this type
        hits = sub[sub["events"].isin(["single", "double", "triple", "home_run"])]
        non_walk = sub[~sub["events"].isin(["walk", "hit_by_pitch", "sac_fly", "sac_bunt"])]
        ba = round(len(hits) / len(non_walk), 3) if len(non_walk) > 0 else None

        # Average exit velocity
        avg_ev = round(sub["launch_speed"].mean(), 1) if sub["launch_speed"].notna().any() else None

        results.append({
            "type": bb_type,
            "label": label,
            "count": count,
            "pct": pct,
            "baAgainst": ba,
            "avgExitVelo": avg_ev,
        })

    return results


def _situational_stats(df: pd.DataFrame) -> dict:
    """Key situational metrics for the pitcher."""
    events = df[df["events"].notna()]
    if events.empty:
        return {}

    total_pa = len(events)
    strikeouts = len(events[events["events"].isin(["strikeout", "strikeout_double_play"])])
    walks = len(events[events["events"] == "walk"])
    home_runs = len(events[events["events"] == "home_run"])
    hits = len(events[events["events"].isin(["single", "double", "triple", "home_run"])])

    # K% and BB%
    k_pct = round(strikeouts / total_pa * 100, 1) if total_pa > 0 else 0
    bb_pct = round(walks / total_pa * 100, 1) if total_pa > 0 else 0
    hr_pct = round(home_runs / total_pa * 100, 1) if total_pa > 0 else 0

    # BABIP (hits - HR) / (AB - K - HR + SF)
    non_hr_hits = hits - home_runs
    sac_flies = len(events[events["events"] == "sac_fly"])
    ab = total_pa - walks - len(events[events["events"] == "hit_by_pitch"]) - sac_flies
    babip_denom = ab - strikeouts - home_runs + sac_flies
    babip = round(non_hr_hits / babip_denom, 3) if babip_denom > 0 else None

    # Average exit velocity against
    batted = df[df["launch_speed"].notna()]
    avg_ev = round(batted["launch_speed"].mean(), 1) if not batted.empty else None

    # Hard hit rate (>= 95 mph)
    hard_hit = batted[batted["launch_speed"] >= 95]
    hard_hit_pct = round(len(hard_hit) / len(batted) * 100, 1) if len(batted) > 0 else None

    # Barrel rate
    barrel = df[df.get("launch_speed_angle", pd.Series(dtype=float)) == 6] if "launch_speed_angle" in df.columns else pd.DataFrame()
    barrel_pct = round(len(barrel) / len(batted) * 100, 1) if len(batted) > 0 else None

    # First pitch strike %
    first_pitches = df[(df["balls"] == 0) & (df["strikes"] == 0)]
    first_strikes = first_pitches[first_pitches["description"].isin([
        "called_strike", "swinging_strike", "swinging_strike_blocked",
        "foul", "foul_tip", "hit_into_play", "hit_into_play_no_out", "hit_into_play_score",
    ])]
    fstrike_pct = round(len(first_strikes) / len(first_pitches) * 100, 1) if len(first_pitches) > 0 else None

    return {
        "kPct": _safe_float(k_pct, 1),
        "bbPct": _safe_float(bb_pct, 1),
        "hrPct": _safe_float(hr_pct, 1),
        "babip": _safe_float(babip, 3),
        "avgExitVelo": _safe_float(avg_ev, 1),
        "hardHitPct": _safe_float(hard_hit_pct, 1),
        "barrelPct": _safe_float(barrel_pct, 1),
        "fStrikePct": _safe_float(fstrike_pct, 1),
        "dominantAgainst": "LHB" if _is_more_dominant_vs(df, "L") else "RHB",
    }


def _is_more_dominant_vs(df: pd.DataFrame, side: str) -> bool:
    """Check if pitcher is more dominant vs given side (lower OPS)."""
    l_stats = _compute_pitcher_split_stats(df[df["stand"] == "L"])
    r_stats = _compute_pitcher_split_stats(df[df["stand"] == "R"])
    l_ops = l_stats.get("opsAgainst", 999)
    r_ops = r_stats.get("opsAgainst", 999)
    if side == "L":
        return l_ops < r_ops
    return r_ops < l_ops


def _compute_pitcher_split_stats(df: pd.DataFrame) -> dict:
    """Compute common pitcher stats from a filtered DataFrame."""
    events = df[df["events"].notna()]
    if events.empty:
        return {"pa": 0}

    total_pa = len(events)
    hits = events[events["events"].isin(["single", "double", "triple", "home_run"])]
    singles = len(events[events["events"] == "single"])
    doubles = len(events[events["events"] == "double"])
    triples = len(events[events["events"] == "triple"])
    home_runs = len(events[events["events"] == "home_run"])
    total_hits = len(hits)
    walks = len(events[events["events"] == "walk"])
    hbp = len(events[events["events"] == "hit_by_pitch"])
    sac_flies = len(events[events["events"] == "sac_fly"])
    strikeouts = len(events[events["events"].isin(["strikeout", "strikeout_double_play"])])

    ab = total_pa - walks - hbp - sac_flies
    if ab == 0:
        return {"pa": total_pa}

    ba = _safe_float(total_hits / ab, 3)
    obp = _safe_float((total_hits + walks + hbp) / total_pa, 3) if total_pa > 0 else 0
    slg = _safe_float((singles + 2 * doubles + 3 * triples + 4 * home_runs) / ab, 3)
    ops = _safe_float((obp or 0) + (slg or 0), 3)
    k_pct = _safe_float(strikeouts / total_pa * 100, 1)
    bb_pct = _safe_float(walks / total_pa * 100, 1)

    # Whiff rate across all pitches in this split
    all_pitches = df[df["description"].notna()]
    swings = all_pitches[all_pitches["description"].isin([
        "swinging_strike", "swinging_strike_blocked", "foul", "foul_tip",
        "hit_into_play", "hit_into_play_no_out", "hit_into_play_score",
    ])]
    whiffs = all_pitches[all_pitches["description"].isin(["swinging_strike", "swinging_strike_blocked"])]
    whiff_rate = round(len(whiffs) / len(swings) * 100, 1) if len(swings) > 0 else None

    return {
        "pa": total_pa,
        "ab": ab,
        "hits": total_hits,
        "hr": home_runs,
        "kPct": k_pct,
        "bbPct": bb_pct,
        "baAgainst": ba,
        "obpAgainst": obp,
        "slgAgainst": slg,
        "opsAgainst": ops,
        "whiffRate": whiff_rate,
    }


async def get_longest_home_runs(season: int | None = None, limit: int = 5) -> list[dict]:
    """Get the longest home runs of the season by hit distance."""
    try:
        result = await asyncio.to_thread(_fetch_longest_hrs, season or get_current_season(), limit)
        return result
    except Exception as e:
        logger.warning("Longest HR fetch failed: %s", e)
        return []


def _fetch_longest_hrs(season: int, limit: int) -> list[dict]:
    from pybaseball import statcast
    import requests

    start_dt = f"{season}-03-20"
    end_dt = date.today().isoformat()

    df = statcast(start_dt=start_dt, end_dt=end_dt)
    if df is None or df.empty:
        return []

    hrs = df[df["events"] == "home_run"].copy()
    hrs = hrs[hrs["hit_distance_sc"].notna()]
    hrs = hrs.sort_values("hit_distance_sc", ascending=False).head(limit)

    results = []
    for _, row in hrs.iterrows():
        batter_id = int(row["batter"])
        try:
            resp = requests.get(
                f"https://statsapi.mlb.com/api/v1/people/{batter_id}",
                timeout=5,
            )
            person = resp.json().get("people", [{}])[0]
            name = person.get("fullName", f"ID:{batter_id}")
            team_abbr = person.get("currentTeam", {}).get("abbreviation", "")
            team_id = person.get("currentTeam", {}).get("id")
        except Exception:
            name = f"ID:{batter_id}"
            team_abbr = ""
            team_id = None

        results.append({
            "rank": len(results) + 1,
            "value": int(row["hit_distance_sc"]),
            "player": {"id": batter_id, "name": name},
            "team": team_abbr,
            "teamId": team_id,
        })

    return results


async def get_batter_advanced_stats(player_id: int, season: int | None = None) -> dict:
    """Get advanced batting metrics from Statcast data."""
    try:
        result = await asyncio.to_thread(_fetch_batter_advanced, player_id, season)
        return result
    except Exception as e:
        logger.warning("Batter advanced stats failed: %s", e)
        return {}


def _fetch_batter_advanced(player_id: int, season: int | None) -> dict:
    from pybaseball import statcast_batter

    if season:
        start_dt = f"{season}-03-01"
        end_dt = f"{season}-11-30"
    else:
        start_dt = f"{get_current_season()}-03-01"
        end_dt = date.today().isoformat()

    df = statcast_batter(start_dt, end_dt, player_id)
    if df is None or df.empty:
        return {}

    events = df[df["events"].notna()]
    batted = df[df["launch_speed"].notna()]

    if events.empty:
        return {}

    # Exit velocity stats
    avg_ev = round(batted["launch_speed"].mean(), 1) if not batted.empty else None
    max_ev = round(batted["launch_speed"].max(), 1) if not batted.empty else None

    # Hard hit rate
    hard_hit = batted[batted["launch_speed"] >= 95]
    hard_hit_pct = round(len(hard_hit) / len(batted) * 100, 1) if len(batted) > 0 else None

    # Barrel rate
    barrel = df[df.get("launch_speed_angle", pd.Series(dtype=float)) == 6] if "launch_speed_angle" in df.columns else pd.DataFrame()
    barrel_pct = round(len(barrel) / len(batted) * 100, 1) if len(batted) > 0 else None

    # Average launch angle
    avg_la = round(batted["launch_angle"].mean(), 1) if batted["launch_angle"].notna().any() else None

    # Batted ball types
    bb_typed = df[df["bb_type"].notna()]
    total_bb = len(bb_typed)
    gb_pct = round(len(bb_typed[bb_typed["bb_type"] == "ground_ball"]) / total_bb * 100, 1) if total_bb > 0 else None
    fb_pct = round(len(bb_typed[bb_typed["bb_type"] == "fly_ball"]) / total_bb * 100, 1) if total_bb > 0 else None
    ld_pct = round(len(bb_typed[bb_typed["bb_type"] == "line_drive"]) / total_bb * 100, 1) if total_bb > 0 else None

    # Whiff rate
    all_pitches = df[df["description"].notna()]
    swings = all_pitches[all_pitches["description"].isin([
        "swinging_strike", "swinging_strike_blocked", "foul", "foul_tip",
        "hit_into_play", "hit_into_play_no_out", "hit_into_play_score",
    ])]
    whiffs = all_pitches[all_pitches["description"].isin(["swinging_strike", "swinging_strike_blocked"])]
    whiff_rate = round(len(whiffs) / len(swings) * 100, 1) if len(swings) > 0 else None

    # Chase rate (swings at pitches outside zone)
    outside_zone = all_pitches[all_pitches["zone"].isin([11, 12, 13, 14])] if "zone" in all_pitches.columns else pd.DataFrame()
    chases = outside_zone[outside_zone["description"].isin([
        "swinging_strike", "swinging_strike_blocked", "foul", "foul_tip",
        "hit_into_play", "hit_into_play_no_out", "hit_into_play_score",
    ])] if not outside_zone.empty else pd.DataFrame()
    chase_rate = round(len(chases) / len(outside_zone) * 100, 1) if len(outside_zone) > 0 else None

    # xBA, xSLG, xwOBA (if available in data)
    xba = round(events["estimated_ba_using_speedangle"].mean(), 3) if "estimated_ba_using_speedangle" in events.columns and events["estimated_ba_using_speedangle"].notna().any() else None
    xslg = round(events["estimated_slg_using_speedangle"].mean(), 3) if "estimated_slg_using_speedangle" in events.columns and events["estimated_slg_using_speedangle"].notna().any() else None
    xwoba = round(df["estimated_woba_using_speedangle"].mean(), 3) if "estimated_woba_using_speedangle" in df.columns and df["estimated_woba_using_speedangle"].notna().any() else None

    return {
        "avgExitVelo": _safe_float(avg_ev, 1),
        "maxExitVelo": _safe_float(max_ev, 1),
        "hardHitPct": _safe_float(hard_hit_pct, 1),
        "barrelPct": _safe_float(barrel_pct, 1),
        "avgLaunchAngle": _safe_float(avg_la, 1),
        "gbPct": _safe_float(gb_pct, 1),
        "fbPct": _safe_float(fb_pct, 1),
        "ldPct": _safe_float(ld_pct, 1),
        "whiffRate": _safe_float(whiff_rate, 1),
        "chaseRate": _safe_float(chase_rate, 1),
        "xBA": _safe_float(xba, 3),
        "xSLG": _safe_float(xslg, 3),
        "xwOBA": _safe_float(xwoba, 3),
    }
