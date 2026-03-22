import httpx

from app.config import MLB_API_BASE

_client: httpx.AsyncClient | None = None


def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(base_url=MLB_API_BASE, timeout=15.0)
    return _client


async def close_client() -> None:
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
        _client = None


async def fetch(path: str, params: dict | None = None) -> dict:
    client = get_client()
    resp = await client.get(path, params=params)
    resp.raise_for_status()
    return resp.json()


async def get_team_info(team_id: int) -> dict:
    data = await fetch(f"/teams/{team_id}")
    teams = data.get("teams", [])
    if not teams:
        return {}
    t = teams[0]
    return {
        "id": t["id"],
        "name": t["name"],
        "abbreviation": t.get("abbreviation", ""),
        "teamName": t.get("teamName", ""),
        "venue": {
            "id": t.get("venue", {}).get("id"),
            "name": t.get("venue", {}).get("name", ""),
        },
        "league": t.get("league", {}).get("name", ""),
        "division": t.get("division", {}).get("name", ""),
        "logoUrl": f"https://www.mlbstatic.com/team-logos/{team_id}.svg",
    }


async def get_roster(team_id: int, season: int | None = None) -> list[dict]:
    params: dict = {"rosterType": "active"}
    if season:
        params["season"] = season
    data = await fetch(f"/teams/{team_id}/roster", params=params)
    players = []
    for entry in data.get("roster", []):
        p = entry.get("person", {})
        pos = entry.get("position", {})
        player_id = p.get("id")
        players.append({
            "id": player_id,
            "fullName": p.get("fullName", ""),
            "jerseyNumber": entry.get("jerseyNumber", ""),
            "position": {
                "code": pos.get("code", ""),
                "name": pos.get("name", ""),
                "type": pos.get("type", ""),
                "abbreviation": pos.get("abbreviation", ""),
            },
            "status": entry.get("status", {}).get("description", "Active"),
            "photoUrl": (
                f"https://img.mlbstatic.com/mlb-photos/image/upload/"
                f"d_people:generic:headshot:67:current.png/"
                f"w_213,q_auto:best/v1/people/{player_id}/headshot/67/current"
            ),
        })
    return players


async def get_player_detail(player_id: int) -> dict:
    data = await fetch(f"/people/{player_id}", params={"hydrate": "currentTeam"})
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
        "photoUrl": (
            f"https://img.mlbstatic.com/mlb-photos/image/upload/"
            f"d_people:generic:headshot:67:current.png/"
            f"w_213,q_auto:best/v1/people/{p['id']}/headshot/67/current"
        ),
    }


async def get_schedule(team_id: int, season: int) -> list[dict]:
    data = await fetch("/schedule", params={
        "sportId": 1,
        "teamId": team_id,
        "season": season,
        "hydrate": "team,linescore,probablePitcher",
        "gameType": "R",
    })
    games = []
    for date_entry in data.get("dates", []):
        for g in date_entry.get("games", []):
            away = g.get("teams", {}).get("away", {})
            home = g.get("teams", {}).get("home", {})
            away_team = away.get("team", {})
            home_team = home.get("team", {})
            games.append({
                "gamePk": g.get("gamePk"),
                "gameDate": g.get("gameDate", ""),
                "status": g.get("status", {}).get("detailedState", ""),
                "venue": {
                    "id": g.get("venue", {}).get("id"),
                    "name": g.get("venue", {}).get("name", ""),
                },
                "away": {
                    "id": away_team.get("id"),
                    "name": away_team.get("name", ""),
                    "abbreviation": away_team.get("abbreviation", ""),
                    "score": away.get("score"),
                    "isWinner": away.get("isWinner", False),
                    "probablePitcher": _extract_pitcher(away.get("probablePitcher")),
                    "logoUrl": f"https://www.mlbstatic.com/team-logos/{away_team.get('id')}.svg",
                },
                "home": {
                    "id": home_team.get("id"),
                    "name": home_team.get("name", ""),
                    "abbreviation": home_team.get("abbreviation", ""),
                    "score": home.get("score"),
                    "isWinner": home.get("isWinner", False),
                    "probablePitcher": _extract_pitcher(home.get("probablePitcher")),
                    "logoUrl": f"https://www.mlbstatic.com/team-logos/{home_team.get('id')}.svg",
                },
            })
    return games


async def get_today_game(team_id: int) -> dict | None:
    from datetime import date
    today = date.today().isoformat()
    data = await fetch("/schedule", params={
        "sportId": 1,
        "teamId": team_id,
        "date": today,
        "hydrate": "team,linescore,probablePitcher",
        "gameType": "R",
    })
    dates = data.get("dates", [])
    if not dates:
        return None
    games = dates[0].get("games", [])
    if not games:
        return None
    g = games[0]
    away = g.get("teams", {}).get("away", {})
    home = g.get("teams", {}).get("home", {})
    away_team = away.get("team", {})
    home_team = home.get("team", {})
    return {
        "gamePk": g.get("gamePk"),
        "gameDate": g.get("gameDate", ""),
        "status": g.get("status", {}).get("detailedState", ""),
        "venue": {
            "id": g.get("venue", {}).get("id"),
            "name": g.get("venue", {}).get("name", ""),
        },
        "away": {
            "id": away_team.get("id"),
            "name": away_team.get("name", ""),
            "abbreviation": away_team.get("abbreviation", ""),
            "score": away.get("score"),
            "probablePitcher": _extract_pitcher(away.get("probablePitcher")),
            "logoUrl": f"https://www.mlbstatic.com/team-logos/{away_team.get('id')}.svg",
        },
        "home": {
            "id": home_team.get("id"),
            "name": home_team.get("name", ""),
            "abbreviation": home_team.get("abbreviation", ""),
            "score": home.get("score"),
            "probablePitcher": _extract_pitcher(home.get("probablePitcher")),
            "logoUrl": f"https://www.mlbstatic.com/team-logos/{home_team.get('id')}.svg",
        },
    }


async def get_standings(season: int, league_id: int | None = None) -> list[dict]:
    params: dict = {"season": season, "sportId": 1, "leagueId": "103,104"}
    if league_id:
        params["leagueId"] = str(league_id)
    data = await fetch("/standings", params=params)
    divisions = []
    for record in data.get("records", []):
        div = record.get("division", {})
        teams = []
        for tr in record.get("teamRecords", []):
            t = tr.get("team", {})
            teams.append({
                "id": t.get("id"),
                "name": t.get("name", ""),
                "abbreviation": t.get("abbreviation", ""),
                "wins": tr.get("wins", 0),
                "losses": tr.get("losses", 0),
                "winPct": tr.get("winningPercentage", ".000"),
                "gamesBack": tr.get("gamesBack", "-"),
                "streakCode": tr.get("streak", {}).get("streakCode", ""),
                "last10": f"{tr.get('records', {}).get('splitRecords', [{}])[0].get('wins', 0)}-{tr.get('records', {}).get('splitRecords', [{}])[0].get('losses', 0)}" if tr.get("records", {}).get("splitRecords") else "",
                "logoUrl": f"https://www.mlbstatic.com/team-logos/{t.get('id')}.svg",
            })
        divisions.append({
            "divisionId": div.get("id"),
            "divisionName": div.get("name", ""),
            "teams": teams,
        })
    return divisions


async def get_player_season_stats(player_id: int, season: int, group: str = "hitting") -> dict:
    data = await fetch(f"/people/{player_id}/stats", params={
        "stats": "season",
        "season": season,
        "group": group,
    })
    stats_list = data.get("stats", [])
    if not stats_list:
        return {}
    splits = stats_list[0].get("splits", [])
    if not splits:
        return {}
    return splits[0].get("stat", {})


def _extract_pitcher(pitcher_data: dict | None) -> dict | None:
    if not pitcher_data:
        return None
    pid = pitcher_data.get("id")
    return {
        "id": pid,
        "fullName": pitcher_data.get("fullName", ""),
        "photoUrl": (
            f"https://img.mlbstatic.com/mlb-photos/image/upload/"
            f"d_people:generic:headshot:67:current.png/"
            f"w_213,q_auto:best/v1/people/{pid}/headshot/67/current"
        ),
    }
