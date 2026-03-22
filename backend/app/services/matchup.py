import asyncio
from datetime import date

import pandas as pd


async def get_batter_vs_pitcher(batter_id: int, pitcher_id: int) -> dict:
    """Historical batter vs pitcher matchup from Statcast."""
    try:
        result = await asyncio.to_thread(_fetch_bvp, batter_id, pitcher_id)
        return result
    except Exception as e:
        print(f"BvP fetch failed: {e}")
        return {}


def _fetch_bvp(batter_id: int, pitcher_id: int) -> dict:
    from pybaseball import statcast_batter

    # Get all available data (2015+)
    df = statcast_batter("2015-01-01", date.today().isoformat(), batter_id)
    if df is None or df.empty:
        return {"pa": 0}

    # Filter to this specific pitcher
    matchup = df[df["pitcher"] == pitcher_id]
    events = matchup[matchup["events"].notna()]

    if events.empty:
        return {"pa": 0, "message": "No prior matchups"}

    total_pa = len(events)
    hits_df = events[events["events"].isin(["single", "double", "triple", "home_run"])]
    singles = len(events[events["events"] == "single"])
    doubles = len(events[events["events"] == "double"])
    triples = len(events[events["events"] == "triple"])
    home_runs = len(events[events["events"] == "home_run"])
    total_hits = len(hits_df)
    walks = len(events[events["events"] == "walk"])
    hbp = len(events[events["events"] == "hit_by_pitch"])
    strikeouts = len(events[events["events"].isin(["strikeout", "strikeout_double_play"])])
    sac_flies = len(events[events["events"] == "sac_fly"])

    ab = total_pa - walks - hbp - sac_flies
    avg = round(total_hits / ab, 3) if ab > 0 else None
    obp = round((total_hits + walks + hbp) / total_pa, 3) if total_pa > 0 else None
    slg = round((singles + 2 * doubles + 3 * triples + 4 * home_runs) / ab, 3) if ab > 0 else None
    ops = round(obp + slg, 3) if obp is not None and slg is not None else None

    # Average exit velocity on contact
    batted = matchup[matchup["launch_speed"].notna()]
    avg_ev = round(batted["launch_speed"].mean(), 1) if not batted.empty else None

    return {
        "pa": total_pa,
        "ab": ab,
        "hits": total_hits,
        "singles": singles,
        "doubles": doubles,
        "triples": triples,
        "homeRuns": home_runs,
        "walks": walks,
        "strikeouts": strikeouts,
        "avg": avg,
        "obp": obp,
        "slg": slg,
        "ops": ops,
        "avgExitVelo": avg_ev,
    }


async def get_batter_vs_pitch_types(batter_id: int, pitcher_id: int) -> list[dict]:
    """How the batter fares against each of the pitcher's pitch types."""
    try:
        result = await asyncio.to_thread(_fetch_pitch_type_matchup, batter_id, pitcher_id)
        return result
    except Exception as e:
        print(f"Pitch type matchup fetch failed: {e}")
        return []


def _fetch_pitch_type_matchup(batter_id: int, pitcher_id: int) -> list[dict]:
    from pybaseball import statcast_batter

    df = statcast_batter("2015-01-01", date.today().isoformat(), batter_id)
    if df is None or df.empty:
        return []

    # Filter to this pitcher
    matchup = df[df["pitcher"] == pitcher_id]
    if matchup.empty:
        return []

    PITCH_NAMES = {
        "FF": "4-Seam", "SI": "Sinker", "FC": "Cutter",
        "SL": "Slider", "CU": "Curve", "KC": "K-Curve",
        "CH": "Change", "FS": "Splitter", "SV": "Sweeper",
        "ST": "Sweep Curve", "KN": "Knuckle",
    }

    results = []
    pitches = matchup[matchup["pitch_type"].notna() & (matchup["pitch_type"] != "")]

    for pitch_type, group in pitches.groupby("pitch_type"):
        total = len(group)
        events = group[group["events"].notna()]
        pa = len(events)

        if pa == 0:
            # No at-bat-ending events on this pitch, still show pitch count
            results.append({
                "pitchType": pitch_type,
                "pitchName": PITCH_NAMES.get(pitch_type, pitch_type),
                "seen": total,
                "pa": 0,
                "avg": None,
                "whiffRate": _calc_whiff(group),
            })
            continue

        hits = events[events["events"].isin(["single", "double", "triple", "home_run"])]
        non_walk = events[~events["events"].isin(["walk", "hit_by_pitch", "sac_fly", "sac_bunt"])]
        ab = len(non_walk)
        avg = round(len(hits) / ab, 3) if ab > 0 else None
        hr = len(events[events["events"] == "home_run"])
        k = len(events[events["events"].isin(["strikeout", "strikeout_double_play"])])

        results.append({
            "pitchType": pitch_type,
            "pitchName": PITCH_NAMES.get(pitch_type, pitch_type),
            "seen": total,
            "pa": pa,
            "ab": ab,
            "hits": len(hits),
            "hr": hr,
            "k": k,
            "avg": avg,
            "whiffRate": _calc_whiff(group),
        })

    results.sort(key=lambda x: x["seen"], reverse=True)
    return results


def _calc_whiff(group: pd.DataFrame) -> float | None:
    swings = group[group["description"].isin([
        "swinging_strike", "swinging_strike_blocked", "foul", "foul_tip",
        "hit_into_play", "hit_into_play_no_out", "hit_into_play_score",
    ])]
    whiffs = group[group["description"].isin(["swinging_strike", "swinging_strike_blocked"])]
    return round(len(whiffs) / len(swings) * 100, 1) if len(swings) > 0 else None


async def get_team_park_history(team_id: int, venue_id: int) -> dict:
    """Team's record at a specific ballpark from MLB API schedule data."""
    from app.services import mlb_api

    current_year = date.today().year
    wins = 0
    losses = 0
    games_list = []

    # Look at last 3 seasons
    for year in range(current_year - 2, current_year + 1):
        try:
            schedule = await mlb_api.get_schedule(team_id, year)
            for game in schedule:
                if game.get("status") != "Final":
                    continue
                if game.get("venue", {}).get("id") != venue_id:
                    continue

                is_home = game["home"]["id"] == team_id
                our_side = game["home"] if is_home else game["away"]
                if our_side.get("isWinner"):
                    wins += 1
                else:
                    losses += 1

                games_list.append({
                    "date": game["gameDate"],
                    "opponent": game["away"]["abbreviation"] if is_home else game["home"]["abbreviation"],
                    "score": f"{game['home'].get('score', 0)}-{game['away'].get('score', 0)}",
                    "won": our_side.get("isWinner", False),
                })
        except Exception:
            continue

    return {
        "venueId": venue_id,
        "wins": wins,
        "losses": losses,
        "winPct": round(wins / (wins + losses), 3) if (wins + losses) > 0 else None,
        "recentGames": games_list[-10:],  # Last 10 games at this park
    }


async def get_prior_matchups(team1_id: int, team2_id: int, season: int | None = None) -> dict:
    """Prior meeting results between two teams this season."""
    from app.services import mlb_api

    if season is None:
        season = date.today().year

    try:
        schedule = await mlb_api.get_schedule(team1_id, season)
    except Exception:
        return {"games": [], "record": {"wins": 0, "losses": 0}}

    matchups = []
    wins = 0
    losses = 0

    for game in schedule:
        if game.get("status") != "Final":
            continue
        is_home = game["home"]["id"] == team1_id
        opponent_id = game["away"]["id"] if is_home else game["home"]["id"]
        if opponent_id != team2_id:
            continue

        our_side = game["home"] if is_home else game["away"]
        won = our_side.get("isWinner", False)
        if won:
            wins += 1
        else:
            losses += 1

        matchups.append({
            "gamePk": game["gamePk"],
            "date": game["gameDate"],
            "homeAbbr": game["home"]["abbreviation"],
            "awayAbbr": game["away"]["abbreviation"],
            "homeScore": game["home"].get("score", 0),
            "awayScore": game["away"].get("score", 0),
            "won": won,
        })

    return {
        "games": matchups,
        "record": {"wins": wins, "losses": losses},
    }
