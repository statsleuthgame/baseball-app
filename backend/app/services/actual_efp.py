"""
Compute the *actual* PrizePicks fantasy score a hitter produced in a past
game, from the MLB Stats API boxscore. Used by the backtest pipeline to
measure projection error.

Scoring (PrizePicks official): 1B=3 · 2B=5 · 3B=8 · HR=10 · R=2 · RBI=2 ·
BB=2 · HBP=2 · SB=5. No K penalty for batters.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.services.fantasy import PP_SCORING


def score_from_stat(stat: dict[str, Any]) -> float:
    """Apply the PrizePicks scoring table to a single batter's game stat row."""
    if not stat:
        return 0.0

    def i(key: str) -> int:
        v = stat.get(key)
        if v is None or v == "":
            return 0
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0

    hits = i("hits")
    doubles = i("doubles")
    triples = i("triples")
    hr = i("homeRuns")
    singles = max(0, hits - doubles - triples - hr)
    runs = i("runs")
    rbi = i("rbi")
    bb = i("baseOnBalls")
    hbp = i("hitByPitch")
    sb = i("stolenBases")

    return (
        PP_SCORING["single"] * singles
        + PP_SCORING["double"] * doubles
        + PP_SCORING["triple"] * triples
        + PP_SCORING["home_run"] * hr
        + PP_SCORING["run"] * runs
        + PP_SCORING["rbi"] * rbi
        + PP_SCORING["walk"] * bb
        + PP_SCORING["hbp"] * hbp
        + PP_SCORING["sb"] * sb
    )


def extract_batter_lines(boxscore: dict) -> list[dict]:
    """
    Walk an MLB /game/{gamePk}/boxscore response, return a list of batter
    rows: { player_id, name, team_id, team_abbr, side ('away'|'home'),
            stat (raw dict), efp (scored), pa (actual plate appearances) }.
    """
    rows: list[dict] = []
    teams = (boxscore or {}).get("teams") or {}
    for side in ("away", "home"):
        t = teams.get(side) or {}
        team = t.get("team") or {}
        team_id = team.get("id")
        team_abbr = team.get("abbreviation") or team.get("teamName") or ""
        players = t.get("players") or {}
        for key, p in players.items():
            # ID keys look like "ID547989" — skip anything else.
            if not key.startswith("ID"):
                continue
            person = p.get("person") or {}
            # Only include batters who actually batted this game.
            stats = (p.get("stats") or {}).get("batting") or {}
            if not stats or not stats.get("plateAppearances"):
                continue
            try:
                pa = int(float(stats.get("plateAppearances") or 0))
            except (TypeError, ValueError):
                pa = 0
            if pa <= 0:
                continue
            rows.append({
                "player_id": person.get("id"),
                "name": person.get("fullName") or "",
                "team_id": team_id,
                "team_abbr": team_abbr,
                "side": side,
                "stat": stats,
                "efp": round(score_from_stat(stats), 2),
                "pa": pa,
            })
    return rows


async def fetch_boxscore(client: httpx.AsyncClient, gamePk: int) -> dict:
    """Fetch a single game's boxscore. Caller is responsible for throttling."""
    resp = await client.get(f"/game/{gamePk}/boxscore")
    resp.raise_for_status()
    return resp.json()
