import asyncio
import logging

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

from app.config import TEAM_META

FANGRAPHS_PLAYOFF_URL = "https://www.fangraphs.com/standings/playoff-odds"

# Map FanGraphs team names to our team IDs
TEAM_NAME_MAP = {
    "Mariners": 136,
    "Seattle Mariners": 136,
    "SEA": 136,
    "Braves": 144,
    "Atlanta Braves": 144,
    "ATL": 144,
}


async def scrape_playoff_odds() -> list[dict]:
    try:
        result = await asyncio.to_thread(_fetch_and_parse_odds)
        return result
    except Exception as e:
        logger.warning("FanGraphs scraping failed: %s", e)
        return []


def _fetch_and_parse_odds() -> list[dict]:
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }

    with httpx.Client(timeout=15.0, follow_redirects=True) as client:
        resp = client.get(FANGRAPHS_PLAYOFF_URL, headers=headers)
        resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")
    odds = []

    tables = soup.find_all("table")
    for table in tables:
        headers_row = table.find("thead")
        if not headers_row:
            continue

        th_cells = headers_row.find_all("th")
        col_names = [th.get_text(strip=True).lower() for th in th_cells]

        # Look for columns that contain playoff-related headers
        team_col = None
        div_col = None
        playoff_col = None
        ws_col = None

        for i, name in enumerate(col_names):
            if "team" in name:
                team_col = i
            elif "div" in name and ("%" in name or "win" in name):
                div_col = i
            elif "playoff" in name or "po" in name:
                playoff_col = i
            elif "ws" in name or "world" in name:
                ws_col = i

        if team_col is None:
            continue

        tbody = table.find("tbody")
        if not tbody:
            continue

        for row in tbody.find_all("tr"):
            cells = row.find_all("td")
            if len(cells) <= team_col:
                continue

            team_text = cells[team_col].get_text(strip=True)

            # Check if this is one of our teams
            team_id = None
            for key, tid in TEAM_NAME_MAP.items():
                if key.lower() in team_text.lower():
                    team_id = tid
                    break

            if team_id is None:
                continue

            entry = {
                "teamId": team_id,
                "teamName": TEAM_META.get(team_id, {}).get("name", f"Team {team_id}"),
                "winDivision": _safe_cell(cells, div_col),
                "makePlayoffs": _safe_cell(cells, playoff_col),
                "winWorldSeries": _safe_cell(cells, ws_col),
            }
            odds.append(entry)

    return odds


def _safe_cell(cells: list, idx: int | None) -> str:
    if idx is None or idx >= len(cells):
        return "—"
    text = cells[idx].get_text(strip=True)
    return text if text else "—"
