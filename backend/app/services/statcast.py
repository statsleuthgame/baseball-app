import asyncio
from datetime import date, timedelta

import pandas as pd


async def get_hot_batters(team_roster_ids: list[int], days: int = 14) -> list[dict]:
    """Get batting stats for players over the last N days using pybaseball."""
    try:
        result = await asyncio.to_thread(_fetch_hot_batters, team_roster_ids, days)
        return result
    except Exception as e:
        print(f"Hot batters fetch failed: {e}")
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
        "playerName": player_name,
        "pa": total_pa,
        "ab": ab,
        "hits": total_hits,
        "doubles": doubles,
        "triples": triples,
        "homeRuns": home_runs,
        "walks": walks,
        "strikeouts": strikeouts,
        "avg": round(avg, 3),
        "obp": round(obp, 3),
        "slg": round(slg, 3),
        "ops": round(ops, 3),
        "photoUrl": (
            f"https://img.mlbstatic.com/mlb-photos/image/upload/"
            f"d_people:generic:headshot:67:current.png/"
            f"w_213,q_auto:best/v1/people/{player_id}/headshot/67/current"
        ),
    }


async def get_spray_chart_data(player_id: int, venue_id: int | None = None, season: int | None = None) -> dict:
    """Get batted ball data for spray chart visualization."""
    try:
        result = await asyncio.to_thread(_fetch_spray_data, player_id, venue_id, season)
        return result
    except Exception as e:
        print(f"Spray chart fetch failed: {e}")
        return {"hits": [], "summary": {}}


def _fetch_spray_data(player_id: int, venue_id: int | None, season: int | None) -> dict:
    from pybaseball import statcast_batter

    if season:
        start_dt = f"{season}-01-01"
        end_dt = f"{season}-12-31"
    else:
        # Default to all available data for career view
        start_dt = "2015-01-01"
        end_dt = date.today().isoformat()

    df = statcast_batter(start_dt, end_dt, player_id)
    if df is None or df.empty:
        return {"hits": [], "summary": {}}

    # Filter to batted balls with coordinates
    batted = df[df["hc_x"].notna() & df["hc_y"].notna() & df["events"].notna()].copy()

    if venue_id:
        # Filter by venue if we have that info (game_pk -> venue mapping would be needed)
        # For now, we'll include all data as venue filtering requires additional lookups
        pass

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
            "x": round(x, 1),
            "y": round(y, 1),
            "result": result_type,
            "event": event,
            "date": str(row.get("game_date", "")),
            "exitVelo": round(row["launch_speed"], 1) if pd.notna(row.get("launch_speed")) else None,
            "launchAngle": round(row["launch_angle"], 1) if pd.notna(row.get("launch_angle")) else None,
            "pitchType": row.get("pitch_type", ""),
            "hitDistance": round(row["hit_distance_sc"], 0) if pd.notna(row.get("hit_distance_sc")) else None,
        })

    return {"hits": hits, "summary": summary}
