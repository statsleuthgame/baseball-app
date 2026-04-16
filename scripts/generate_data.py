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
import unicodedata
from datetime import date, timedelta
from pathlib import Path

import httpx
import pandas as pd

# Where to write JSON files
OUTPUT_DIR = Path(__file__).parent.parent / "frontend" / "public" / "data"
# Parquet cache for incremental Statcast fetches
CACHE_DIR = Path(__file__).parent.parent / ".statcast_cache"

MLB_API = "https://statsapi.mlb.com/api/v1"

TEAMS = {
    109: {"abbr": "AZ", "name": "Arizona Diamondbacks", "divisionId": 203},
    144: {"abbr": "ATL", "name": "Atlanta Braves", "divisionId": 204},
    110: {"abbr": "BAL", "name": "Baltimore Orioles", "divisionId": 201},
    111: {"abbr": "BOS", "name": "Boston Red Sox", "divisionId": 201},
    112: {"abbr": "CHC", "name": "Chicago Cubs", "divisionId": 205},
    145: {"abbr": "CWS", "name": "Chicago White Sox", "divisionId": 202},
    113: {"abbr": "CIN", "name": "Cincinnati Reds", "divisionId": 205},
    114: {"abbr": "CLE", "name": "Cleveland Guardians", "divisionId": 202},
    115: {"abbr": "COL", "name": "Colorado Rockies", "divisionId": 203},
    116: {"abbr": "DET", "name": "Detroit Tigers", "divisionId": 202},
    117: {"abbr": "HOU", "name": "Houston Astros", "divisionId": 200},
    118: {"abbr": "KC", "name": "Kansas City Royals", "divisionId": 202},
    108: {"abbr": "LAA", "name": "Los Angeles Angels", "divisionId": 200},
    119: {"abbr": "LAD", "name": "Los Angeles Dodgers", "divisionId": 203},
    146: {"abbr": "MIA", "name": "Miami Marlins", "divisionId": 204},
    158: {"abbr": "MIL", "name": "Milwaukee Brewers", "divisionId": 205},
    142: {"abbr": "MIN", "name": "Minnesota Twins", "divisionId": 202},
    121: {"abbr": "NYM", "name": "New York Mets", "divisionId": 204},
    147: {"abbr": "NYY", "name": "New York Yankees", "divisionId": 201},
    133: {"abbr": "ATH", "name": "Oakland Athletics", "divisionId": 200},
    143: {"abbr": "PHI", "name": "Philadelphia Phillies", "divisionId": 204},
    134: {"abbr": "PIT", "name": "Pittsburgh Pirates", "divisionId": 205},
    135: {"abbr": "SD", "name": "San Diego Padres", "divisionId": 203},
    137: {"abbr": "SF", "name": "San Francisco Giants", "divisionId": 203},
    136: {"abbr": "SEA", "name": "Seattle Mariners", "divisionId": 200},
    138: {"abbr": "STL", "name": "St. Louis Cardinals", "divisionId": 205},
    139: {"abbr": "TB", "name": "Tampa Bay Rays", "divisionId": 201},
    140: {"abbr": "TEX", "name": "Texas Rangers", "divisionId": 200},
    141: {"abbr": "TOR", "name": "Toronto Blue Jays", "divisionId": 201},
    120: {"abbr": "WSH", "name": "Washington Nationals", "divisionId": 204},
}

SEASON = date.today().year


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def strip_accents(s: str) -> str:
    """Remove diacritics/accents from a string for fuzzy name matching."""
    return "".join(
        c for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )


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


def safe_float(val, decimals=1, pct=False):
    if val is None:
        return None
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return None
        if pct and f < 1:
            f *= 100
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
        "currentTeamId": p.get("currentTeam", {}).get("id"),
        "photoUrl": f"https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/{p['id']}/headshot/67/current",
    }


def fetch_player_stats(player_id: int, group: str = "hitting") -> dict:
    """Fetch current season stats, falling back to previous season if empty."""
    # Try current season first
    data = mlb_get(f"/people/{player_id}/stats", {"stats": "season", "season": SEASON, "group": group})
    stats_list = data.get("stats", [])
    current = {}
    if stats_list:
        splits = stats_list[0].get("splits", [])
        if splits:
            current = splits[0].get("stat", {})

    # Also fetch previous season
    prev_data = mlb_get(f"/people/{player_id}/stats", {"stats": "season", "season": SEASON - 1, "group": group})
    prev_list = prev_data.get("stats", [])
    previous = {}
    if prev_list:
        prev_splits = prev_list[0].get("splits", [])
        if prev_splits:
            previous = prev_splits[0].get("stat", {})

    return {"current": current, "previous": previous}


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
                    "logoUrl": f"https://www.mlbstatic.com/team-logos/team-cap-on-dark/{at.get('id')}.svg",
                },
                "home": {
                    "id": ht.get("id"), "name": ht.get("name", ""), "abbreviation": ht.get("abbreviation", ""),
                    "score": home.get("score"), "isWinner": home.get("isWinner", False),
                    "probablePitcher": extract_pitcher(home.get("probablePitcher")),
                    "logoUrl": f"https://www.mlbstatic.com/team-logos/team-cap-on-dark/{ht.get('id')}.svg",
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
                "logoUrl": f"https://www.mlbstatic.com/team-logos/team-cap-on-dark/{t.get('id')}.svg",
            })
        divisions.append({"divisionId": div.get("id"), "divisionName": div.get("name", ""), "teams": teams})
    return divisions


def _lookup_pitcher_names(pitcher_ids: list[int]) -> dict[int, str]:
    """Batch lookup pitcher names from MLB API. Returns {pitcher_id: 'First Last'}."""
    names = {}
    for pid in pitcher_ids:
        try:
            data = mlb_get(f"/people/{pid}")
            people = data.get("people", [])
            if people:
                names[pid] = people[0].get("fullName", "")
        except Exception as e:
            print(f"        failed to lookup pitcher {pid}: {e}")
    return names


# ---------------------------------------------------------------------------
# Statcast caching — single fetch per player, incremental updates
# ---------------------------------------------------------------------------

def _cache_path(player_id: int, kind: str = "batter") -> Path:
    return CACHE_DIR / f"{kind}_{player_id}.parquet"


def fetch_statcast_cached(player_id: int, kind: str = "batter", years_back: int = 5) -> pd.DataFrame:
    """
    Fetch Statcast data with parquet cache.
    First run: full fetch. Subsequent runs: load cache + fetch only new data.
    """
    from pybaseball import statcast_batter, statcast_pitcher
    fetcher = statcast_batter if kind == "batter" else statcast_pitcher

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = _cache_path(player_id, kind)
    today_str = date.today().isoformat()
    earliest = f"{SEASON - years_back}-01-01"

    cached_df = None
    last_date = None

    if cache_file.exists():
        try:
            cached_df = pd.read_parquet(cache_file)
            if cached_df is not None and not cached_df.empty and "game_date" in cached_df.columns:
                last_date = pd.to_datetime(cached_df["game_date"], errors="coerce").max()
                if pd.notna(last_date):
                    last_date = last_date.strftime("%Y-%m-%d")
        except Exception:
            cached_df = None

    if cached_df is not None and last_date:
        # Incremental: fetch only from day after last cached date
        fetch_start = (pd.Timestamp(last_date) + timedelta(days=1)).strftime("%Y-%m-%d")
        if fetch_start > today_str:
            print(f"      cache hit (up to date) for {kind}_{player_id}")
            return cached_df

        print(f"      cache hit, fetching delta {fetch_start} to {today_str}")
        try:
            delta = fetcher(fetch_start, today_str, player_id)
            if delta is not None and not delta.empty:
                combined = pd.concat([cached_df, delta], ignore_index=True)
                combined = combined.drop_duplicates(subset=["game_pk", "at_bat_number", "pitch_number"], keep="last")
                combined.to_parquet(cache_file, index=False)
                return combined
            else:
                # No new data, cache is current
                return cached_df
        except Exception as e:
            print(f"      delta fetch failed ({e}), using cache")
            return cached_df
    else:
        # Full fetch
        print(f"      full fetch {earliest} to {today_str}")
        try:
            df = fetcher(earliest, today_str, player_id)
            if df is not None and not df.empty:
                df.to_parquet(cache_file, index=False)
                return df
            return pd.DataFrame()
        except Exception as e:
            print(f"      statcast fetch failed: {e}")
            return pd.DataFrame()


def fetch_all_spray_charts(player_id: int, df: pd.DataFrame = None) -> dict[str, dict]:
    """Build spray chart data from a pre-fetched DataFrame (2020+). Returns dict keyed by team abbr."""
    empty_summary = {"single": 0, "double": 0, "triple": 0, "home_run": 0, "out": 0, "total": 0}

    try:
        if df is None or df.empty:
            return {}

        # Filter to 2020+ for spray charts
        if "game_date" in df.columns:
            df = df[pd.to_datetime(df["game_date"], errors="coerce") >= "2020-01-01"]
        if df.empty:
            return {}

        batted = df[df["hc_x"].notna() & df["hc_y"].notna() & df["events"].notna()].copy()
        if batted.empty or "home_team" not in batted.columns:
            return {}

        # Lookup pitcher names ONLY for home runs to limit API calls
        hr_rows = batted[batted["events"] == "home_run"]
        hr_pitcher_ids = list(set(int(pid) for pid in hr_rows["pitcher"].dropna().unique()))
        print(f"      looking up {len(hr_pitcher_ids)} pitcher names for HRs...")
        pitcher_names = _lookup_pitcher_names(hr_pitcher_ids)

        results = {}
        for home_team, group in batted.groupby("home_team"):
            hits = []
            summary = dict(empty_summary)

            for _, row in group.iterrows():
                event = row["events"]
                x = row["hc_x"] - 125.42
                y = 198.27 - row["hc_y"]
                result_type = event if event in ("single", "double", "triple", "home_run") else "out"
                summary[result_type] = summary.get(result_type, 0) + 1
                summary["total"] += 1
                # Determine opponent team using inning_topbot
                ht = row.get("home_team", "")
                at = row.get("away_team", "")
                is_batter_home = str(row.get("inning_topbot", "")).strip().lower() == "bot"
                opponent = at if is_batter_home else ht

                # Look up pitcher name from ID (player_name is the batter, not the pitcher)
                pid = int(row["pitcher"]) if pd.notna(row.get("pitcher")) else None
                pitcher_name = pitcher_names.get(pid, "") if pid else ""

                hits.append({
                    "x": safe_float(x), "y": safe_float(y), "result": result_type, "event": event,
                    "date": str(row.get("game_date", "")),
                    "exitVelo": safe_float(row.get("launch_speed")),
                    "launchAngle": safe_float(row.get("launch_angle")),
                    "pitchType": row.get("pitch_type", "") if pd.notna(row.get("pitch_type")) else "",
                    "hitDistance": safe_float(row.get("hit_distance_sc"), 0),
                    "pitcher": pid,
                    "pitcherName": pitcher_name,
                    "opponent": opponent if pd.notna(opponent) else "",
                })

            results[home_team] = {"hits": hits, "summary": summary}

        return results
    except Exception as e:
        print(f"    spray chart error for {player_id}: {e}")
        return {}


def fetch_pitch_arsenal(player_id: int, df: pd.DataFrame = None) -> dict:
    """Build pitch arsenal from a pre-fetched pitcher DataFrame."""
    PITCH_NAMES = {
        "FF": "4-Seam Fastball", "SI": "Sinker", "FC": "Cutter",
        "SL": "Slider", "CU": "Curveball", "KC": "Knuckle Curve",
        "CH": "Changeup", "FS": "Splitter", "SV": "Sweeper",
        "ST": "Sweeping Curve", "KN": "Knuckleball",
    }

    try:
        if df is None or df.empty:
            return {"pitches": [], "totalPitches": 0}

        # Filter to last 2 seasons for arsenal
        cutoff = f"{SEASON - 1}-03-01"
        if "game_date" in df.columns:
            df = df[pd.to_datetime(df["game_date"], errors="coerce") >= cutoff]
        if df.empty:
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


def fetch_batter_advanced(player_id: int, df: pd.DataFrame = None) -> dict:
    """Build Statcast advanced metrics from a pre-fetched batter DataFrame."""
    try:
        if df is None or df.empty:
            return {}

        # Filter to last 2 seasons for advanced stats
        cutoff = f"{SEASON - 1}-03-01"
        if "game_date" in df.columns:
            df = df[pd.to_datetime(df["game_date"], errors="coerce") >= cutoff]
        if df.empty:
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

        # Barrel rate
        barrel = batted[batted["launch_speed_angle"] == 6] if "launch_speed_angle" in batted.columns else pd.DataFrame()
        barrel_pct = round(len(barrel) / len(batted) * 100, 1) if len(batted) > 0 else None

        # Chase rate (swings at pitches outside zone)
        outside_zone = all_pitches[all_pitches["zone"].isin([11, 12, 13, 14])] if "zone" in all_pitches.columns else pd.DataFrame()
        chases = outside_zone[outside_zone["description"].isin([
            "swinging_strike", "swinging_strike_blocked", "foul", "foul_tip",
            "hit_into_play", "hit_into_play_no_out", "hit_into_play_score",
        ])] if not outside_zone.empty else pd.DataFrame()
        chase_rate = round(len(chases) / len(outside_zone) * 100, 1) if len(outside_zone) > 0 else None

        return {
            "avgExitVelo": avg_ev, "maxExitVelo": max_ev, "hardHitPct": hard_hit_pct,
            "barrelPct": barrel_pct, "avgLaunchAngle": avg_la,
            "whiffRate": whiff_rate, "chaseRate": chase_rate,
            "gbPct": gb_pct, "fbPct": fb_pct, "ldPct": ld_pct,
            "xBA": xba, "xSLG": xslg, "xwOBA": xwoba,
        }
    except Exception as e:
        print(f"    advanced error for {player_id}: {e}")
        return {}


def fetch_batter_career_statcast(player_id: int, df: pd.DataFrame = None) -> dict:
    """Build BvP data from a pre-fetched batter DataFrame (last 3 seasons)."""
    try:
        if df is None or df.empty:
            return {}

        # Filter to last ~3 seasons for BvP
        if "game_date" in df.columns:
            df = df[pd.to_datetime(df["game_date"], errors="coerce") >= "2022-03-01"]
        if df.empty:
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
# FanGraphs season stats (pybaseball)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Missed umpire calls (balls/strikes)
# ---------------------------------------------------------------------------

PLATE_HALF_WIDTH = 0.83  # 17" plate + ball radius, in feet

def fetch_missed_calls(player_id: int, df: pd.DataFrame = None) -> dict:
    """Identify incorrect ball/strike calls from a pre-fetched batter DataFrame."""
    try:
        if df is None or df.empty:
            return {}

        # Keep only called balls and called strikes
        called = df[df["description"].isin(["called_strike", "ball"])].copy()
        required = ["plate_x", "plate_z", "sz_top", "sz_bot"]
        called = called.dropna(subset=required)
        if called.empty:
            return {}

        total_called = len(called)

        # Determine if each pitch is in the zone
        in_zone = (
            (called["plate_x"].abs() <= PLATE_HALF_WIDTH) &
            (called["plate_z"] >= called["sz_bot"]) &
            (called["plate_z"] <= called["sz_top"])
        )

        # Squeezed: pitch in zone but called ball (hurts batter)
        squeezed_mask = (called["description"] == "ball") & in_zone
        # Gifted: pitch outside zone but called strike (hurts batter)
        gifted_mask = (called["description"] == "called_strike") & ~in_zone

        def build_pitches(mask):
            rows = called[mask]
            pitches = []
            for _, r in rows.iterrows():
                game_date = ""
                if pd.notna(r.get("game_date")):
                    game_date = str(r["game_date"])[:10]
                pitches.append({
                    "px": round(float(r["plate_x"]), 3),
                    "pz": round(float(r["plate_z"]), 3),
                    "szTop": round(float(r["sz_top"]), 2),
                    "szBot": round(float(r["sz_bot"]), 2),
                    "date": game_date,
                    "pitchType": r.get("pitch_type", ""),
                    "velo": safe_float(r.get("release_speed"), 1),
                    "balls": int(r["balls"]) if pd.notna(r.get("balls")) else None,
                    "strikes": int(r["strikes"]) if pd.notna(r.get("strikes")) else None,
                    "inning": int(r["inning"]) if pd.notna(r.get("inning")) else None,
                })
            return pitches

        squeezed_pitches = build_pitches(squeezed_mask)
        gifted_pitches = build_pitches(gifted_mask)
        total_missed = len(squeezed_pitches) + len(gifted_pitches)

        # By-year breakdown
        by_year = {}
        if "game_date" in called.columns:
            called["year"] = pd.to_datetime(called["game_date"], errors="coerce").dt.year
            for yr, grp in called.groupby("year"):
                if pd.isna(yr):
                    continue
                yr_str = str(int(yr))
                yr_in_zone = (
                    (grp["plate_x"].abs() <= PLATE_HALF_WIDTH) &
                    (grp["plate_z"] >= grp["sz_bot"]) &
                    (grp["plate_z"] <= grp["sz_top"])
                )
                by_year[yr_str] = {
                    "called": len(grp),
                    "squeezed": int(((grp["description"] == "ball") & yr_in_zone).sum()),
                    "gifted": int(((grp["description"] == "called_strike") & ~yr_in_zone).sum()),
                }

        # Average zone dimensions for the SVG reference box
        avg_sz_top = round(float(called["sz_top"].mean()), 2)
        avg_sz_bot = round(float(called["sz_bot"].mean()), 2)

        return {
            "totalCalled": total_called,
            "missedCalls": total_missed,
            "missedPct": round(total_missed / total_called * 100, 1) if total_called > 0 else 0,
            "avgSzTop": avg_sz_top,
            "avgSzBot": avg_sz_bot,
            "squeezed": {"count": len(squeezed_pitches), "pitches": squeezed_pitches},
            "gifted": {"count": len(gifted_pitches), "pitches": gifted_pitches},
            "byYear": by_year,
        }
    except Exception as e:
        print(f"    missed calls error: {e}")
        return {}


# ---- FanGraphs league-wide cache ----
# Downloading the full leaderboard per player is expensive and triggers FanGraphs
# rate-limiting (403s). Fetch once per (season, kind) and reuse for all lookups.
# If the first fetch fails, set a flag so subsequent calls skip the network
# entirely (avoids 1500+ wasted HTTP retries per run).
_FG_DF_CACHE: dict = {}
_FG_BLOCKED: dict = {"batters": False, "pitchers": False}


def _fg_get_df(season: int, is_pitcher: bool):
    """Return cached FanGraphs leaderboard df for (season, kind). None if blocked or failed."""
    key = (season, "pit" if is_pitcher else "bat")
    if key in _FG_DF_CACHE:
        return _FG_DF_CACHE[key]
    kind = "pitchers" if is_pitcher else "batters"
    if _FG_BLOCKED[kind]:
        return None
    try:
        if is_pitcher:
            from pybaseball import pitching_stats
            df = pitching_stats(season, qual=1)
            if df is None or df.empty:
                df = pitching_stats(season, qual=0)
        else:
            from pybaseball import batting_stats
            df = batting_stats(season, qual=1)
            if df is None or df.empty:
                df = batting_stats(season, qual=0)
        if df is None or df.empty:
            _FG_DF_CACHE[key] = None
            return None
        # Pre-compute normalized name column for fast player lookup
        if "Name" in df.columns:
            df = df.copy()
            df["_norm_name"] = df["Name"].apply(lambda x: strip_accents(str(x)).lower())
        _FG_DF_CACHE[key] = df
        return df
    except Exception as e:
        print(f"    FanGraphs {kind} {season} league fetch failed: {e} — skipping FG {kind} for remainder of run")
        _FG_BLOCKED[kind] = True
        _FG_DF_CACHE[key] = None
        return None


def fetch_fangraphs_for_player(full_name: str, is_pitcher: bool) -> dict:
    """Fetch FanGraphs season stats for a player by name, using cached league df."""
    try:
        df = None
        for season in [SEASON, SEASON - 1]:
            df = _fg_get_df(season, is_pitcher)
            if df is not None and not df.empty:
                break

        if df is None or df.empty:
            return {}

        name_col = "Name" if "Name" in df.columns else None
        if not name_col:
            return {}

        # Normalize accents for matching (e.g. Rodríguez -> Rodriguez)
        # _norm_name is pre-computed by _fg_get_df; compute it here only as a fallback
        norm_name = strip_accents(full_name).lower()
        if "_norm_name" not in df.columns:
            df = df.copy()
            df["_norm_name"] = df[name_col].apply(lambda x: strip_accents(str(x)).lower())

        row = df[df["_norm_name"] == norm_name]
        if row.empty:
            # Try matching on last name
            last = strip_accents(full_name.split()[-1]).lower()
            row = df[df["_norm_name"].str.endswith(last)]
        if row.empty:
            return {}

        r = row.iloc[0]

        def col(name, dec=1, pct=False):
            v = r.get(name)
            if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
                return None
            try:
                f = float(v)
                if math.isnan(f) or math.isinf(f):
                    return None
                if pct and f < 1:
                    f *= 100
                return round(f, dec)
            except (TypeError, ValueError):
                return None

        if is_pitcher:
            era = col("ERA", 2)
            fip = col("FIP", 2)
            era_fip_diff = round((era or 0) - (fip or 0), 2) if era is not None and fip is not None else None
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
                "kPct": col("K%", 1, pct=True),
                "bbPct": col("BB%", 1, pct=True),
                "kBbPct": col("K-BB%", 1, pct=True),
                "hrPer9": col("HR/9", 2),
                "gbPct": col("GB%", 1, pct=True),
                "lobPct": col("LOB%", 1, pct=True),
                "whip": col("WHIP", 2),
                "babip": col("BABIP", 3),
                "swstrPct": col("SwStr%", 1, pct=True),
                "ip": col("IP", 1),
                "eraFipDiff": era_fip_diff,
                "regressionAlert": regression_alert,
            }
        else:
            return {
                "war": col("WAR", 1),
                "wrcPlus": col("wRC+", 0),
                "woba": col("wOBA", 3),
                "obp": col("OBP", 3),
                "slg": col("SLG", 3),
                "iso": col("ISO", 3),
                "babip": col("BABIP", 3),
                "kPct": col("K%", 1, pct=True),
                "bbPct": col("BB%", 1, pct=True),
                "kBbPct": col("K-BB%", 1, pct=True),
                "oSwingPct": col("O-Swing%", 1, pct=True),
                "zContactPct": col("Z-Contact%", 1, pct=True),
                "swstrPct": col("SwStr%", 1, pct=True),
            }
    except Exception as e:
        print(f"    FanGraphs stats error for {full_name}: {e}")
        return {}


def fetch_league_fangraphs(season: int) -> dict:
    """Fetch league-wide FanGraphs data: team batting/pitching, K-BB% leaderboard, percentiles."""
    result = {}

    # Team batting
    try:
        from pybaseball import team_batting
        df = team_batting(season)
        if df is not None and not df.empty:
            rows = []
            for _, r in df.iterrows():
                rows.append({
                    "team": r.get("Team", ""),
                    "pa": int(r.get("PA", 0)) if pd.notna(r.get("PA", None)) else None,
                    "avg": safe_float(r.get("AVG"), 3),
                    "obp": safe_float(r.get("OBP"), 3),
                    "slg": safe_float(r.get("SLG"), 3),
                    "ops": safe_float(r.get("OPS"), 3),
                    "wrcPlus": safe_float(r.get("wRC+"), 0),
                    "woba": safe_float(r.get("wOBA"), 3),
                    "iso": safe_float(r.get("ISO"), 3),
                    "war": safe_float(r.get("WAR"), 1),
                    "kPct": safe_float(r.get("K%"), 1, pct=True),
                    "bbPct": safe_float(r.get("BB%"), 1, pct=True),
                    "babip": safe_float(r.get("BABIP"), 3),
                })
            rows.sort(key=lambda x: (x.get("wrcPlus") or 0), reverse=True)
            for i, row in enumerate(rows):
                row["rank"] = i + 1
            result["teamBatting"] = rows
            print(f"    team batting: {len(rows)} teams")
    except Exception as e:
        print(f"    team_batting error: {e}")

    # Team pitching
    try:
        from pybaseball import team_pitching
        df = team_pitching(season)
        if df is not None and not df.empty:
            rows = []
            for _, r in df.iterrows():
                rows.append({
                    "team": r.get("Team", ""),
                    "ip": safe_float(r.get("IP"), 1),
                    "era": safe_float(r.get("ERA"), 2),
                    "fip": safe_float(r.get("FIP"), 2),
                    "xfip": safe_float(r.get("xFIP"), 2),
                    "war": safe_float(r.get("WAR"), 1),
                    "kPct": safe_float(r.get("K%"), 1, pct=True),
                    "bbPct": safe_float(r.get("BB%"), 1, pct=True),
                    "kBbPct": safe_float(r.get("K-BB%"), 1, pct=True),
                    "gbPct": safe_float(r.get("GB%"), 1, pct=True),
                    "whip": safe_float(r.get("WHIP"), 2),
                    "hrPer9": safe_float(r.get("HR/9"), 2),
                    "lobPct": safe_float(r.get("LOB%"), 1, pct=True),
                })
            rows.sort(key=lambda x: (x.get("fip") or 99))
            for i, row in enumerate(rows):
                row["rank"] = i + 1
            result["teamPitching"] = rows
            print(f"    team pitching: {len(rows)} teams")
    except Exception as e:
        print(f"    team_pitching error: {e}")

    # K-BB% leaderboard (pitchers)
    try:
        from pybaseball import pitching_stats
        df = pitching_stats(season, qual=1)
        if df is not None and not df.empty:
            kbb_rows = []
            for _, r in df.iterrows():
                kbb = safe_float(r.get("K-BB%"), 1, pct=True)
                if kbb is None:
                    continue
                kbb_rows.append({
                    "name": r.get("Name", ""),
                    "team": r.get("Team", ""),
                    "ip": safe_float(r.get("IP"), 1),
                    "kBbPct": kbb,
                    "kPct": safe_float(r.get("K%"), 1, pct=True),
                    "bbPct": safe_float(r.get("BB%"), 1, pct=True),
                    "era": safe_float(r.get("ERA"), 2),
                    "fip": safe_float(r.get("FIP"), 2),
                    "war": safe_float(r.get("WAR"), 1),
                })
            kbb_rows.sort(key=lambda x: (x.get("kBbPct") or -99), reverse=True)
            result["kBbLeaderboard"] = {"top": kbb_rows[:25], "bottom": kbb_rows[-25:][::-1]}
            print(f"    K-BB% leaderboard: {len(kbb_rows)} pitchers")
    except Exception as e:
        print(f"    K-BB% leaderboard error: {e}")

    # Batter percentiles
    try:
        from pybaseball import batting_stats
        df = batting_stats(season, qual=1)
        if df is not None and not df.empty:
            metrics = {
                "wrcPlus": ("wRC+", True),
                "woba": ("wOBA", True),
                "iso": ("ISO", True),
                "kPct": ("K%", False),
                "bbPct": ("BB%", True),
                "babip": ("BABIP", True),
                "war": ("WAR", True),
                "obp": ("OBP", True),
                "slg": ("SLG", True),
            }
            batter_pcts = {}
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
                    rank = float((col_series < val).sum()) / len(col_series) * 100
                    if not higher_is_better:
                        rank = 100 - rank
                    player_pcts[key] = round(rank, 0)
                batter_pcts[name] = player_pcts
            result["batterPercentiles"] = batter_pcts
            print(f"    batter percentiles: {len(batter_pcts)} players")
    except Exception as e:
        print(f"    batter percentiles error: {e}")

    # Pitcher percentiles
    try:
        from pybaseball import pitching_stats
        df = pitching_stats(season, qual=1)
        if df is not None and not df.empty:
            metrics = {
                "war": ("WAR", True),
                "era": ("ERA", False),
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
            pitcher_pcts = {}
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
                    rank = float((col_series < val).sum()) / len(col_series) * 100
                    if not higher_is_better:
                        rank = 100 - rank
                    player_pcts[key] = round(rank, 0)
                pitcher_pcts[name] = player_pcts
            result["pitcherPercentiles"] = pitcher_pcts
            print(f"    pitcher percentiles: {len(pitcher_pcts)} players")
    except Exception as e:
        print(f"    pitcher percentiles error: {e}")

    return result


# ---------------------------------------------------------------------------
# Season game log (pybaseball schedule_and_record)
# ---------------------------------------------------------------------------


# Baseball Reference uses slightly different abbreviations than MLB API for some teams.
BREF_ABBR = {
    "CWS": "CHW", "KC": "KCR", "TB": "TBR", "SD": "SDP",
    "SF": "SFG", "MIA": "FLA",  # FLA pre-2012, MIA 2012+
}


def fetch_season_gamelog(team_abbr: str, season: int) -> list:
    """Fetch game-by-game results for a team using pybaseball schedule_and_record."""
    try:
        from pybaseball import schedule_and_record
        # Convert MLB API abbr to Baseball Reference abbr if needed
        bref_abbr = BREF_ABBR.get(team_abbr, team_abbr)
        df = schedule_and_record(season, bref_abbr)
        if df is None or df.empty:
            return []

        games = []
        wins = 0
        losses = 0

        for _, row in df.iterrows():
            # Only include completed games
            win_loss = str(row.get("W/L", "")).strip()
            if not win_loss or win_loss not in ("W", "L", "W-wo", "L-wo"):
                continue

            won = win_loss.startswith("W")
            if won:
                wins += 1
            else:
                losses += 1

            total = wins + losses
            run_diff_raw = row.get("R", 0) or 0
            run_against_raw = row.get("RA", 0) or 0

            games.append({
                "date": str(row.get("Date", "")),
                "opponent": str(row.get("Opp", "")),
                "homeAway": "home" if not str(row.get("Unnamed: 4", "")).startswith("@") else "away",
                "runsScored": int(run_diff_raw) if pd.notna(run_diff_raw) else None,
                "runsAllowed": int(run_against_raw) if pd.notna(run_against_raw) else None,
                "result": "W" if won else "L",
                "wins": wins,
                "losses": losses,
                "winPct": round(wins / total, 3) if total > 0 else None,
                "streak": str(row.get("Streak", "")),
            })

        return games
    except Exception as e:
        print(f"    season gamelog error for {team_abbr}: {e}")
        return []


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def process_team(team_id, team_info):
    """Process all data for a single team. Safe to run in parallel."""
    abbr = team_info["abbr"]
    print(f"[{abbr}] Starting...")

    # Roster
    roster = fetch_roster(team_id)
    write_json(f"teams/{abbr}/roster.json", roster)

    # Schedule
    schedule = fetch_schedule(team_id)
    write_json(f"teams/{abbr}/schedule.json", schedule)

    # Player details and stats
    print(f"[{abbr}] fetching player details and stats...")
    for player in roster:
        pid = player["id"]
        try:
            detail = fetch_player_detail(pid)
            is_pitcher = detail.get("primaryPosition") == "P"

            group = "pitching" if is_pitcher else "hitting"
            stats = fetch_player_stats(pid, group)

            player_data = {
                "detail": detail,
                "stats": {
                    "season": SEASON,
                    "group": group,
                    "stats": stats.get("current", {}),
                    "prevSeason": SEASON - 1,
                    "prevStats": stats.get("previous", {}),
                },
            }
            write_json(f"players/{pid}/info.json", player_data)
        except Exception as e:
            print(f"[{abbr}]   error for player {pid}: {e}")

    # Statcast data
    print(f"[{abbr}] fetching Statcast data...")
    position_players = [p for p in roster if p["position"]["type"] != "Pitcher"]
    pitchers = [p for p in roster if p["position"]["type"] == "Pitcher"]

    for player in pitchers:
        pid = player["id"]
        full_name = player.get("fullName", "")
        try:
            pitcher_df = fetch_statcast_cached(pid, kind="pitcher", years_back=2)
            arsenal = fetch_pitch_arsenal(pid, df=pitcher_df)
            write_json(f"players/{pid}/arsenal.json", arsenal)

            fg_stats = fetch_fangraphs_for_player(full_name, is_pitcher=True)
            write_json(f"players/{pid}/advanced.json", fg_stats)

            batter_df = fetch_statcast_cached(pid, kind="batter", years_back=5)
            missed = fetch_missed_calls(pid, df=batter_df)
            if missed:
                write_json(f"players/{pid}/missed_calls.json", missed)

            print(f"[{abbr}]   {full_name} (P) done")
        except Exception as e:
            print(f"[{abbr}]   statcast error for {full_name}: {e}")
        time.sleep(0.5)

    for player in position_players:
        pid = player["id"]
        full_name = player.get("fullName", "")
        try:
            batter_df = fetch_statcast_cached(pid, kind="batter", years_back=5)

            advanced = fetch_batter_advanced(pid, df=batter_df.copy())
            fg_stats = fetch_fangraphs_for_player(full_name, is_pitcher=False)
            advanced.update(fg_stats)
            write_json(f"players/{pid}/advanced.json", advanced)

            bvp = fetch_batter_career_statcast(pid, df=batter_df.copy())
            write_json(f"players/{pid}/bvp.json", bvp)

            all_sprays = fetch_all_spray_charts(pid, df=batter_df.copy())
            for park_abbr, spray_data in all_sprays.items():
                write_json(f"players/{pid}/spray/{park_abbr}.json", spray_data)

            missed = fetch_missed_calls(pid, df=batter_df)
            if missed:
                write_json(f"players/{pid}/missed_calls.json", missed)

            print(f"[{abbr}]   {full_name} - done ({len(all_sprays)} parks)")
        except Exception as e:
            print(f"[{abbr}]   statcast error for {full_name}: {e}")
        time.sleep(0.5)

    # Season game log
    try:
        gamelog = fetch_season_gamelog(abbr, SEASON)
        write_json(f"teams/{abbr}/gamelogs.json", gamelog)
        print(f"[{abbr}]   {len(gamelog)} games logged")
    except Exception as e:
        print(f"[{abbr}]   gamelog error: {e}")

    print(f"[{abbr}] Done!")
    return abbr


def main():
    from concurrent.futures import ThreadPoolExecutor, as_completed

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Allow running a subset: python generate_data.py SEA ATL
    # Or all teams: python generate_data.py
    requested = [a.upper() for a in sys.argv[1:]] if len(sys.argv) > 1 else []
    teams_to_run = {
        tid: info for tid, info in TEAMS.items()
        if not requested or info["abbr"] in requested
    }

    max_workers = int(os.environ.get("DATA_WORKERS", 4))
    print(f"Generating data for {SEASON} season...")
    print(f"Teams: {len(teams_to_run)} | Workers: {max_workers}")
    print(f"Output: {OUTPUT_DIR}\n")

    # ---- Standings ----
    print("[1/4] Standings")
    standings = fetch_standings()
    write_json("standings.json", standings)

    # ---- Per-team data (parallel) ----
    print(f"\n[2/4] Processing {len(teams_to_run)} teams...")
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(process_team, tid, info): info["abbr"]
            for tid, info in teams_to_run.items()
        }
        completed = 0
        for future in as_completed(futures):
            completed += 1
            abbr = futures[future]
            try:
                future.result()
                print(f"  [{completed}/{len(teams_to_run)}] {abbr} complete")
            except Exception as e:
                print(f"  [{completed}/{len(teams_to_run)}] {abbr} FAILED: {e}")

    # ---- League FanGraphs data ----
    print("\n[3/4] League FanGraphs (team rankings + K-BB% + percentiles)")
    try:
        league_data = fetch_league_fangraphs(SEASON)
        if not league_data:
            print(f"    {SEASON} empty, trying {SEASON - 1}")
            league_data = fetch_league_fangraphs(SEASON - 1)
        if league_data.get("teamBatting"):
            write_json("league/team_batting.json", league_data["teamBatting"])
        if league_data.get("teamPitching"):
            write_json("league/team_pitching.json", league_data["teamPitching"])
        if league_data.get("kBbLeaderboard"):
            write_json("leaderboards/k_bb_pct.json", league_data["kBbLeaderboard"])
        if league_data.get("batterPercentiles") or league_data.get("pitcherPercentiles"):
            write_json(f"fangraphs/percentiles_{SEASON}.json", {
                "batters": league_data.get("batterPercentiles", {}),
                "pitchers": league_data.get("pitcherPercentiles", {}),
            })
    except Exception as e:
        print(f"  league FanGraphs error: {e}")

    # ---- Venues list ----
    print("\n[4/4] Venues")
    venues = [
        {"abbr": "ARI", "team": "Diamondbacks", "name": "Chase Field", "dimensions": {"LF": 330, "LCF": 374, "CF": 407, "RCF": 374, "RF": 334}},
        {"abbr": "ATL", "team": "Braves", "name": "Truist Park", "dimensions": {"LF": 335, "LCF": 385, "CF": 400, "RCF": 375, "RF": 325}},
        {"abbr": "BAL", "team": "Orioles", "name": "Camden Yards", "dimensions": {"LF": 333, "LCF": 364, "CF": 400, "RCF": 373, "RF": 318}},
        {"abbr": "BOS", "team": "Red Sox", "name": "Fenway Park", "dimensions": {"LF": 310, "LCF": 379, "CF": 390, "RCF": 380, "RF": 302}},
        {"abbr": "CHC", "team": "Cubs", "name": "Wrigley Field", "dimensions": {"LF": 355, "LCF": 368, "CF": 400, "RCF": 368, "RF": 353}},
        {"abbr": "CWS", "team": "White Sox", "name": "Guaranteed Rate Field", "dimensions": {"LF": 330, "LCF": 375, "CF": 400, "RCF": 375, "RF": 335}},
        {"abbr": "CIN", "team": "Reds", "name": "Great American Ball Park", "dimensions": {"LF": 328, "LCF": 379, "CF": 404, "RCF": 370, "RF": 325}},
        {"abbr": "CLE", "team": "Guardians", "name": "Progressive Field", "dimensions": {"LF": 325, "LCF": 370, "CF": 400, "RCF": 375, "RF": 325}},
        {"abbr": "COL", "team": "Rockies", "name": "Coors Field", "dimensions": {"LF": 347, "LCF": 390, "CF": 415, "RCF": 375, "RF": 350}},
        {"abbr": "DET", "team": "Tigers", "name": "Comerica Park", "dimensions": {"LF": 345, "LCF": 370, "CF": 420, "RCF": 365, "RF": 330}},
        {"abbr": "HOU", "team": "Astros", "name": "Minute Maid Park", "dimensions": {"LF": 315, "LCF": 366, "CF": 409, "RCF": 373, "RF": 326}},
        {"abbr": "KC", "team": "Royals", "name": "Kauffman Stadium", "dimensions": {"LF": 330, "LCF": 387, "CF": 410, "RCF": 387, "RF": 330}},
        {"abbr": "LAA", "team": "Angels", "name": "Angel Stadium", "dimensions": {"LF": 330, "LCF": 387, "CF": 400, "RCF": 370, "RF": 330}},
        {"abbr": "LAD", "team": "Dodgers", "name": "Dodger Stadium", "dimensions": {"LF": 330, "LCF": 385, "CF": 395, "RCF": 385, "RF": 330}},
        {"abbr": "MIA", "team": "Marlins", "name": "LoanDepot Park", "dimensions": {"LF": 344, "LCF": 386, "CF": 407, "RCF": 392, "RF": 335}},
        {"abbr": "MIL", "team": "Brewers", "name": "American Family Field", "dimensions": {"LF": 344, "LCF": 371, "CF": 400, "RCF": 374, "RF": 345}},
        {"abbr": "MIN", "team": "Twins", "name": "Target Field", "dimensions": {"LF": 339, "LCF": 377, "CF": 404, "RCF": 367, "RF": 328}},
        {"abbr": "NYM", "team": "Mets", "name": "Citi Field", "dimensions": {"LF": 335, "LCF": 379, "CF": 408, "RCF": 375, "RF": 330}},
        {"abbr": "NYY", "team": "Yankees", "name": "Yankee Stadium", "dimensions": {"LF": 318, "LCF": 399, "CF": 408, "RCF": 385, "RF": 314}},
        {"abbr": "OAK", "team": "Athletics", "name": "Oakland Coliseum", "dimensions": {"LF": 330, "LCF": 362, "CF": 400, "RCF": 362, "RF": 330}},
        {"abbr": "PHI", "team": "Phillies", "name": "Citizens Bank Park", "dimensions": {"LF": 329, "LCF": 374, "CF": 401, "RCF": 369, "RF": 330}},
        {"abbr": "PIT", "team": "Pirates", "name": "PNC Park", "dimensions": {"LF": 325, "LCF": 383, "CF": 399, "RCF": 375, "RF": 320}},
        {"abbr": "SD", "team": "Padres", "name": "Petco Park", "dimensions": {"LF": 336, "LCF": 390, "CF": 396, "RCF": 382, "RF": 322}},
        {"abbr": "SF", "team": "Giants", "name": "Oracle Park", "dimensions": {"LF": 339, "LCF": 382, "CF": 399, "RCF": 365, "RF": 309}},
        {"abbr": "SEA", "team": "Mariners", "name": "T-Mobile Park", "dimensions": {"LF": 331, "LCF": 378, "CF": 405, "RCF": 381, "RF": 326}},
        {"abbr": "STL", "team": "Cardinals", "name": "Busch Stadium", "dimensions": {"LF": 336, "LCF": 375, "CF": 400, "RCF": 375, "RF": 335}},
        {"abbr": "TB", "team": "Rays", "name": "Tropicana Field", "dimensions": {"LF": 315, "LCF": 370, "CF": 404, "RCF": 370, "RF": 322}},
        {"abbr": "TEX", "team": "Rangers", "name": "Globe Life Field", "dimensions": {"LF": 329, "LCF": 372, "CF": 407, "RCF": 374, "RF": 326}},
        {"abbr": "TOR", "team": "Blue Jays", "name": "Rogers Centre", "dimensions": {"LF": 328, "LCF": 375, "CF": 400, "RCF": 375, "RF": 328}},
        {"abbr": "WSH", "team": "Nationals", "name": "Nationals Park", "dimensions": {"LF": 336, "LCF": 377, "CF": 402, "RCF": 370, "RF": 335}},
    ]
    write_json("venues.json", venues)

    # ---- Metadata (timestamp) ----
    print("\nMetadata")
    write_json("meta.json", {
        "lastUpdated": date.today().isoformat(),
        "season": SEASON,
    })

    print("\nDone!")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\nFATAL ERROR: {e}")
        traceback.print_exc()
        sys.exit(1)
