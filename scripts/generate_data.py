"""
Daily data generation script.
Fetches all baseball data and writes static JSON files for the frontend.
Runs via GitHub Actions once per day.
"""

import json
import math
import os
import sys
import time
import traceback
from datetime import date, timedelta
from pathlib import Path

import httpx
import pandas as pd

# Where to write JSON files
OUTPUT_DIR = Path(__file__).parent.parent / "frontend" / "public" / "data"

MLB_API = "https://statsapi.mlb.com/api/v1"

TEAMS = {
    136: {"abbr": "SEA", "name": "Seattle Mariners", "divisionId": 200},
    144: {"abbr": "ATL", "name": "Atlanta Braves", "divisionId": 204},
}

SEASON = date.today().year


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def safe_json(obj):
    """Recursively replace NaN/Inf with None for JSON serialization."""
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, dict):
        return {k: safe_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [safe_json(v) for v in obj]
    return obj


def write_json(path: str, data):
    """Write data to a JSON file, creating directories as needed."""
    full = OUTPUT_DIR / path
    full.parent.mkdir(parents=True, exist_ok=True)
    with open(full, "w") as f:
        json.dump(safe_json(data), f, separators=(",", ":"), default=str)
    print(f"  wrote {full.relative_to(OUTPUT_DIR)} ({full.stat().st_size} bytes)")


def mlb_get(path: str, params: dict = None) -> dict:
    with httpx.Client(timeout=20) as client:
        r = client.get(f"{MLB_API}{path}", params=params)
        r.raise_for_status()
        return r.json()


def safe_float(val, decimals=1):
    if val is None:
        return None
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return None
        return round(f, decimals)
    except (TypeError, ValueError):
        return None


def extract_pitcher(p):
    if not p:
        return None
    pid = p.get("id")
    return {
        "id": pid,
        "fullName": p.get("fullName", ""),
        "photoUrl": f"https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/{pid}/headshot/67/current",
    }


# ---------------------------------------------------------------------------
# Data fetchers
# ---------------------------------------------------------------------------

def fetch_roster(team_id: int) -> list:
    print(f"  fetching roster for {TEAMS[team_id]['abbr']}...")
    data = mlb_get(f"/teams/{team_id}/roster", {"rosterType": "active", "season": SEASON})
    players = []
    for entry in data.get("roster", []):
        p = entry.get("person", {})
        pos = entry.get("position", {})
        pid = p.get("id")
        players.append({
            "id": pid,
            "fullName": p.get("fullName", ""),
            "jerseyNumber": entry.get("jerseyNumber", ""),
            "position": {
                "code": pos.get("code", ""),
                "name": pos.get("name", ""),
                "type": pos.get("type", ""),
                "abbreviation": pos.get("abbreviation", ""),
            },
            "status": entry.get("status", {}).get("description", "Active"),
            "photoUrl": f"https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/{pid}/headshot/67/current",
        })
    return players


def fetch_player_detail(player_id: int) -> dict:
    data = mlb_get(f"/people/{player_id}", {"hydrate": "currentTeam"})
    people = data.get("people", [])
    if not people:
        return {}
    p = people[0]
    return {
        "id": p["id"],
        "fullName": p.get("fullName", ""),
        "firstName": p.get("firstName", ""),
        "lastName": p.get("lastName", ""),
        "primaryNumber": p.get("primaryNumber", ""),
        "birthDate": p.get("birthDate", ""),
        "age": p.get("currentAge"),
        "height": p.get("height", ""),
        "weight": p.get("weight"),
        "batSide": p.get("batSide", {}).get("code", ""),
        "pitchHand": p.get("pitchHand", {}).get("code", ""),
        "primaryPosition": p.get("primaryPosition", {}).get("abbreviation", ""),
        "mlbDebutDate": p.get("mlbDebutDate", ""),
        "currentTeam": p.get("currentTeam", {}).get("name", ""),
        "photoUrl": f"https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/{p['id']}/headshot/67/current",
    }


def fetch_player_stats(player_id: int, group: str = "hitting") -> dict:
    data = mlb_get(f"/people/{player_id}/stats", {"stats": "season", "season": SEASON, "group": group})
    stats_list = data.get("stats", [])
    if not stats_list:
        return {}
    splits = stats_list[0].get("splits", [])
    if not splits:
        return {}
    return splits[0].get("stat", {})


def fetch_schedule(team_id: int) -> list:
    print(f"  fetching schedule for {TEAMS[team_id]['abbr']}...")
    data = mlb_get("/schedule", {
        "sportId": 1, "teamId": team_id, "season": SEASON,
        "hydrate": "team,linescore,probablePitcher", "gameType": "R",
    })
    games = []
    for date_entry in data.get("dates", []):
        for g in date_entry.get("games", []):
            away = g.get("teams", {}).get("away", {})
            home = g.get("teams", {}).get("home", {})
            at = away.get("team", {})
            ht = home.get("team", {})
            games.append({
                "gamePk": g.get("gamePk"),
                "gameDate": g.get("gameDate", ""),
                "status": g.get("status", {}).get("detailedState", ""),
                "venue": {"id": g.get("venue", {}).get("id"), "name": g.get("venue", {}).get("name", "")},
                "away": {
                    "id": at.get("id"), "name": at.get("name", ""), "abbreviation": at.get("abbreviation", ""),
                    "score": away.get("score"), "isWinner": away.get("isWinner", False),
                    "probablePitcher": extract_pitcher(away.get("probablePitcher")),
                    "logoUrl": f"https://www.mlbstatic.com/team-logos/{at.get('id')}.svg",
                },
                "home": {
                    "id": ht.get("id"), "name": ht.get("name", ""), "abbreviation": ht.get("abbreviation", ""),
                    "score": home.get("score"), "isWinner": home.get("isWinner", False),
                    "probablePitcher": extract_pitcher(home.get("probablePitcher")),
                    "logoUrl": f"https://www.mlbstatic.com/team-logos/{ht.get('id')}.svg",
                },
            })
    return games


def fetch_standings() -> list:
    print("  fetching standings...")
    data = mlb_get("/standings", {"season": SEASON, "sportId": 1, "leagueId": "103,104"})
    divisions = []
    for record in data.get("records", []):
        div = record.get("division", {})
        teams = []
        for tr in record.get("teamRecords", []):
            t = tr.get("team", {})
            teams.append({
                "id": t.get("id"), "name": t.get("name", ""), "abbreviation": t.get("abbreviation", ""),
                "wins": tr.get("wins", 0), "losses": tr.get("losses", 0),
                "winPct": tr.get("winningPercentage", ".000"),
                "gamesBack": tr.get("gamesBack", "-"),
                "streakCode": tr.get("streak", {}).get("streakCode", ""),
                "logoUrl": f"https://www.mlbstatic.com/team-logos/{t.get('id')}.svg",
            })
        divisions.append({"divisionId": div.get("id"), "divisionName": div.get("name", ""), "teams": teams})
    return divisions


def fetch_spray_chart(player_id: int, home_team: str) -> dict:
    """Fetch spray chart data for a player at a specific park."""
    from pybaseball import statcast_batter

    try:
        df = statcast_batter(f"{SEASON}-03-01", date.today().isoformat(), player_id)
        if df is None or df.empty:
            return {"hits": [], "summary": {"single": 0, "double": 0, "triple": 0, "home_run": 0, "out": 0, "total": 0}}

        batted = df[df["hc_x"].notna() & df["hc_y"].notna() & df["events"].notna()].copy()
        if "home_team" in batted.columns:
            batted = batted[batted["home_team"] == home_team.upper()]

        if batted.empty:
            return {"hits": [], "summary": {"single": 0, "double": 0, "triple": 0, "home_run": 0, "out": 0, "total": 0}}

        hits = []
        summary = {"single": 0, "double": 0, "triple": 0, "home_run": 0, "out": 0, "total": 0}

        for _, row in batted.iterrows():
            event = row["events"]
            x = row["hc_x"] - 125.42
            y = 198.27 - row["hc_y"]
            result_type = event if event in ("single", "double", "triple", "home_run") else "out"
            summary[result_type] = summary.get(result_type, 0) + 1
            summary["total"] += 1
            hits.append({
                "x": safe_float(x), "y": safe_float(y), "result": result_type, "event": event,
                "date": str(row.get("game_date", "")),
                "exitVelo": safe_float(row.get("launch_speed")),
                "launchAngle": safe_float(row.get("launch_angle")),
                "pitchType": row.get("pitch_type", "") if pd.notna(row.get("pitch_type")) else "",
                "hitDistance": safe_float(row.get("hit_distance_sc"), 0),
            })

        return {"hits": hits, "summary": summary}
    except Exception as e:
        print(f"    spray chart error for {player_id} at {home_team}: {e}")
        return {"hits": [], "summary": {"single": 0, "double": 0, "triple": 0, "home_run": 0, "out": 0, "total": 0}}


def fetch_pitch_arsenal(player_id: int) -> dict:
    """Fetch pitch arsenal for a pitcher."""
    from pybaseball import statcast_pitcher

    PITCH_NAMES = {
        "FF": "4-Seam Fastball", "SI": "Sinker", "FC": "Cutter",
        "SL": "Slider", "CU": "Curveball", "KC": "Knuckle Curve",
        "CH": "Changeup", "FS": "Splitter", "SV": "Sweeper",
        "ST": "Sweeping Curve", "KN": "Knuckleball",
    }

    try:
        df = statcast_pitcher(f"{SEASON}-03-01", date.today().isoformat(), player_id)
        if df is None or df.empty:
            return {"pitches": [], "totalPitches": 0}

        pitches = df[df["pitch_type"].notna() & (df["pitch_type"] != "")]
        if pitches.empty:
            return {"pitches": [], "totalPitches": 0}

        total = len(pitches)
        arsenal = []

        for pitch_type, group in pitches.groupby("pitch_type"):
            count = len(group)
            usage_pct = round(count / total * 100, 1)
            avg_velo = safe_float(group["release_speed"].mean()) if group["release_speed"].notna().any() else None
            avg_spin = int(group["release_spin_rate"].mean()) if "release_spin_rate" in group.columns and group["release_spin_rate"].notna().any() else None

            swings = group[group["description"].isin(["swinging_strike", "swinging_strike_blocked", "foul", "foul_tip", "hit_into_play", "hit_into_play_no_out", "hit_into_play_score"])]
            whiffs = group[group["description"].isin(["swinging_strike", "swinging_strike_blocked"])]
            whiff_rate = round(len(whiffs) / len(swings) * 100, 1) if len(swings) > 0 else None

            balls_in_play = group[group["events"].notna()]
            hits_against = balls_in_play[balls_in_play["events"].isin(["single", "double", "triple", "home_run"])]
            non_walk = balls_in_play[~balls_in_play["events"].isin(["walk", "hit_by_pitch", "sac_fly", "sac_bunt"])]
            ba_against = round(len(hits_against) / len(non_walk), 3) if len(non_walk) > 0 else None

            avg_pfx_x = safe_float(group["pfx_x"].mean() * 12) if group["pfx_x"].notna().any() else None
            avg_pfx_z = safe_float(group["pfx_z"].mean() * 12) if group["pfx_z"].notna().any() else None

            arsenal.append({
                "pitchType": pitch_type, "pitchName": PITCH_NAMES.get(pitch_type, pitch_type),
                "count": count, "usagePct": usage_pct, "avgVelo": avg_velo, "avgSpin": avg_spin,
                "whiffRate": whiff_rate, "baAgainst": ba_against,
                "horzBreak": avg_pfx_x, "vertBreak": avg_pfx_z,
            })

        arsenal.sort(key=lambda x: x["usagePct"], reverse=True)
        return {"pitches": arsenal, "totalPitches": total}
    except Exception as e:
        print(f"    arsenal error for {player_id}: {e}")
        return {"pitches": [], "totalPitches": 0}


def fetch_batter_advanced(player_id: int) -> dict:
    """Fetch Statcast advanced metrics for a batter."""
    from pybaseball import statcast_batter

    try:
        df = statcast_batter(f"{SEASON}-03-01", date.today().isoformat(), player_id)
        if df is None or df.empty:
            return {}

        batted = df[df["launch_speed"].notna()]
        events = df[df["events"].notna()]
        if events.empty:
            return {}

        avg_ev = safe_float(batted["launch_speed"].mean()) if not batted.empty else None
        max_ev = safe_float(batted["launch_speed"].max()) if not batted.empty else None
        hard_hit = batted[batted["launch_speed"] >= 95]
        hard_hit_pct = round(len(hard_hit) / len(batted) * 100, 1) if len(batted) > 0 else None
        avg_la = safe_float(batted["launch_angle"].mean()) if batted["launch_angle"].notna().any() else None

        bb_typed = df[df["bb_type"].notna()]
        total_bb = len(bb_typed)
        gb_pct = round(len(bb_typed[bb_typed["bb_type"] == "ground_ball"]) / total_bb * 100, 1) if total_bb > 0 else None
        fb_pct = round(len(bb_typed[bb_typed["bb_type"] == "fly_ball"]) / total_bb * 100, 1) if total_bb > 0 else None
        ld_pct = round(len(bb_typed[bb_typed["bb_type"] == "line_drive"]) / total_bb * 100, 1) if total_bb > 0 else None

        all_pitches = df[df["description"].notna()]
        swings = all_pitches[all_pitches["description"].isin(["swinging_strike", "swinging_strike_blocked", "foul", "foul_tip", "hit_into_play", "hit_into_play_no_out", "hit_into_play_score"])]
        whiffs = all_pitches[all_pitches["description"].isin(["swinging_strike", "swinging_strike_blocked"])]
        whiff_rate = round(len(whiffs) / len(swings) * 100, 1) if len(swings) > 0 else None

        xba = safe_float(events["estimated_ba_using_speedangle"].mean(), 3) if "estimated_ba_using_speedangle" in events.columns and events["estimated_ba_using_speedangle"].notna().any() else None
        xslg = safe_float(events["estimated_slg_using_speedangle"].mean(), 3) if "estimated_slg_using_speedangle" in events.columns and events["estimated_slg_using_speedangle"].notna().any() else None
        xwoba = safe_float(df["estimated_woba_using_speedangle"].mean(), 3) if "estimated_woba_using_speedangle" in df.columns and df["estimated_woba_using_speedangle"].notna().any() else None

        return {
            "avgExitVelo": avg_ev, "maxExitVelo": max_ev, "hardHitPct": hard_hit_pct,
            "avgLaunchAngle": avg_la, "gbPct": gb_pct, "fbPct": fb_pct, "ldPct": ld_pct,
            "whiffRate": whiff_rate, "xBA": xba, "xSLG": xslg, "xwOBA": xwoba,
        }
    except Exception as e:
        print(f"    advanced error for {player_id}: {e}")
        return {}


def fetch_batter_career_statcast(player_id: int) -> dict:
    """Fetch career statcast data for a batter, compute BvP for all pitchers faced."""
    from pybaseball import statcast_batter

    try:
        # Try current season first, fall back to last 3 seasons for career data
        df = statcast_batter("2022-03-01", date.today().isoformat(), player_id)
        if df is None or df.empty:
            return {}

        events = df[df["events"].notna()]
        if events.empty:
            return {}

        # Group by pitcher to create BvP lookup
        bvp = {}
        for pitcher_id, group in events.groupby("pitcher"):
            pa = len(group)
            if pa < 1:
                continue

            hits_df = group[group["events"].isin(["single", "double", "triple", "home_run"])]
            singles = len(group[group["events"] == "single"])
            doubles = len(group[group["events"] == "double"])
            triples = len(group[group["events"] == "triple"])
            home_runs = len(group[group["events"] == "home_run"])
            total_hits = len(hits_df)
            walks = len(group[group["events"] == "walk"])
            hbp = len(group[group["events"] == "hit_by_pitch"])
            strikeouts = len(group[group["events"].isin(["strikeout", "strikeout_double_play"])])
            sac_flies = len(group[group["events"] == "sac_fly"])

            ab = pa - walks - hbp - sac_flies
            avg = round(total_hits / ab, 3) if ab > 0 else None
            obp = round((total_hits + walks + hbp) / pa, 3) if pa > 0 else None
            slg = round((singles + 2 * doubles + 3 * triples + 4 * home_runs) / ab, 3) if ab > 0 else None
            ops = round(obp + slg, 3) if obp is not None and slg is not None else None

            bvp[str(int(pitcher_id))] = {
                "pa": pa, "ab": ab, "hits": total_hits,
                "singles": singles, "doubles": doubles, "triples": triples,
                "homeRuns": home_runs, "walks": walks, "strikeouts": strikeouts,
                "avg": avg, "obp": obp, "slg": slg, "ops": ops,
            }

        return bvp
    except Exception as e:
        print(f"    career statcast error for {player_id}: {e}")
        return {}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Generating data for {SEASON} season...")
    print(f"Output: {OUTPUT_DIR}\n")

    # ---- Standings ----
    print("[1/5] Standings")
    standings = fetch_standings()
    write_json("standings.json", standings)

    # ---- Per-team data ----
    for team_id, team_info in TEAMS.items():
        abbr = team_info["abbr"]
        print(f"\n[2/5] Team: {abbr}")

        # Roster
        roster = fetch_roster(team_id)
        write_json(f"teams/{abbr}/roster.json", roster)

        # Schedule
        schedule = fetch_schedule(team_id)
        write_json(f"teams/{abbr}/schedule.json", schedule)

        # Player details and stats
        print(f"  fetching player details and stats...")
        for player in roster:
            pid = player["id"]
            try:
                detail = fetch_player_detail(pid)
                is_pitcher = detail.get("primaryPosition") == "P"

                stats = fetch_player_stats(pid, "pitching" if is_pitcher else "hitting")

                player_data = {
                    "detail": detail,
                    "stats": {"season": SEASON, "group": "pitching" if is_pitcher else "hitting", "stats": stats},
                }
                write_json(f"players/{pid}/info.json", player_data)
            except Exception as e:
                print(f"    error for player {pid}: {e}")

        # Statcast data
        print(f"  fetching Statcast data (this takes a while)...")
        position_players = [p for p in roster if p["position"]["type"] != "Pitcher"]
        pitchers = [p for p in roster if p["position"]["type"] == "Pitcher"]

        for player in pitchers:
            pid = player["id"]
            try:
                arsenal = fetch_pitch_arsenal(pid)
                write_json(f"players/{pid}/arsenal.json", arsenal)
                print(f"    {player['fullName']} (P) - arsenal done")
            except Exception as e:
                print(f"    statcast error for {player['fullName']}: {e}")
            time.sleep(1)

        for player in position_players:
            pid = player["id"]
            try:
                # Advanced stats
                advanced = fetch_batter_advanced(pid)
                write_json(f"players/{pid}/advanced.json", advanced)

                # Career BvP data (lookup by pitcher ID)
                bvp = fetch_batter_career_statcast(pid)
                write_json(f"players/{pid}/bvp.json", bvp)

                # Spray chart at home park
                spray = fetch_spray_chart(pid, abbr)
                write_json(f"players/{pid}/spray/{abbr}.json", spray)

                print(f"    {player['fullName']} - advanced + bvp + spray done")
            except Exception as e:
                print(f"    statcast error for {player['fullName']}: {e}")
            time.sleep(1)

    # ---- Venues list ----
    print("\n[3/5] Venues")
    venues = [
        {"abbr": "ARI", "name": "Chase Field", "dimensions": {"LF": 330, "LCF": 374, "CF": 407, "RCF": 374, "RF": 334}},
        {"abbr": "ATL", "name": "Truist Park", "dimensions": {"LF": 335, "LCF": 385, "CF": 400, "RCF": 375, "RF": 325}},
        {"abbr": "BAL", "name": "Camden Yards", "dimensions": {"LF": 333, "LCF": 364, "CF": 400, "RCF": 373, "RF": 318}},
        {"abbr": "BOS", "name": "Fenway Park", "dimensions": {"LF": 310, "LCF": 379, "CF": 390, "RCF": 380, "RF": 302}},
        {"abbr": "CHC", "name": "Wrigley Field", "dimensions": {"LF": 355, "LCF": 368, "CF": 400, "RCF": 368, "RF": 353}},
        {"abbr": "CWS", "name": "Guaranteed Rate Field", "dimensions": {"LF": 330, "LCF": 375, "CF": 400, "RCF": 375, "RF": 335}},
        {"abbr": "CIN", "name": "Great American Ball Park", "dimensions": {"LF": 328, "LCF": 379, "CF": 404, "RCF": 370, "RF": 325}},
        {"abbr": "CLE", "name": "Progressive Field", "dimensions": {"LF": 325, "LCF": 370, "CF": 400, "RCF": 375, "RF": 325}},
        {"abbr": "COL", "name": "Coors Field", "dimensions": {"LF": 347, "LCF": 390, "CF": 415, "RCF": 375, "RF": 350}},
        {"abbr": "DET", "name": "Comerica Park", "dimensions": {"LF": 345, "LCF": 370, "CF": 420, "RCF": 365, "RF": 330}},
        {"abbr": "HOU", "name": "Minute Maid Park", "dimensions": {"LF": 315, "LCF": 366, "CF": 409, "RCF": 373, "RF": 326}},
        {"abbr": "KC", "name": "Kauffman Stadium", "dimensions": {"LF": 330, "LCF": 387, "CF": 410, "RCF": 387, "RF": 330}},
        {"abbr": "LAA", "name": "Angel Stadium", "dimensions": {"LF": 330, "LCF": 387, "CF": 400, "RCF": 370, "RF": 330}},
        {"abbr": "LAD", "name": "Dodger Stadium", "dimensions": {"LF": 330, "LCF": 385, "CF": 395, "RCF": 385, "RF": 330}},
        {"abbr": "MIA", "name": "LoanDepot Park", "dimensions": {"LF": 344, "LCF": 386, "CF": 407, "RCF": 392, "RF": 335}},
        {"abbr": "MIL", "name": "American Family Field", "dimensions": {"LF": 344, "LCF": 371, "CF": 400, "RCF": 374, "RF": 345}},
        {"abbr": "MIN", "name": "Target Field", "dimensions": {"LF": 339, "LCF": 377, "CF": 404, "RCF": 367, "RF": 328}},
        {"abbr": "NYM", "name": "Citi Field", "dimensions": {"LF": 335, "LCF": 379, "CF": 408, "RCF": 375, "RF": 330}},
        {"abbr": "NYY", "name": "Yankee Stadium", "dimensions": {"LF": 318, "LCF": 399, "CF": 408, "RCF": 385, "RF": 314}},
        {"abbr": "OAK", "name": "Oakland Coliseum", "dimensions": {"LF": 330, "LCF": 362, "CF": 400, "RCF": 362, "RF": 330}},
        {"abbr": "PHI", "name": "Citizens Bank Park", "dimensions": {"LF": 329, "LCF": 374, "CF": 401, "RCF": 369, "RF": 330}},
        {"abbr": "PIT", "name": "PNC Park", "dimensions": {"LF": 325, "LCF": 383, "CF": 399, "RCF": 375, "RF": 320}},
        {"abbr": "SD", "name": "Petco Park", "dimensions": {"LF": 336, "LCF": 390, "CF": 396, "RCF": 382, "RF": 322}},
        {"abbr": "SF", "name": "Oracle Park", "dimensions": {"LF": 339, "LCF": 382, "CF": 399, "RCF": 365, "RF": 309}},
        {"abbr": "SEA", "name": "T-Mobile Park", "dimensions": {"LF": 331, "LCF": 378, "CF": 405, "RCF": 381, "RF": 326}},
        {"abbr": "STL", "name": "Busch Stadium", "dimensions": {"LF": 336, "LCF": 375, "CF": 400, "RCF": 375, "RF": 335}},
        {"abbr": "TB", "name": "Tropicana Field", "dimensions": {"LF": 315, "LCF": 370, "CF": 404, "RCF": 370, "RF": 322}},
        {"abbr": "TEX", "name": "Globe Life Field", "dimensions": {"LF": 329, "LCF": 372, "CF": 407, "RCF": 374, "RF": 326}},
        {"abbr": "TOR", "name": "Rogers Centre", "dimensions": {"LF": 328, "LCF": 375, "CF": 400, "RCF": 375, "RF": 328}},
        {"abbr": "WSH", "name": "Nationals Park", "dimensions": {"LF": 336, "LCF": 377, "CF": 402, "RCF": 370, "RF": 335}},
    ]
    write_json("venues.json", venues)

    # ---- Metadata (timestamp) ----
    print("\n[4/5] Metadata")
    write_json("meta.json", {
        "lastUpdated": date.today().isoformat(),
        "season": SEASON,
    })

    print("\n[5/5] Done!")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\nFATAL ERROR: {e}")
        traceback.print_exc()
        sys.exit(1)
