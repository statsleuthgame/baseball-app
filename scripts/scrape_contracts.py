#!/usr/bin/env python3
"""Scrape MLB active-roster contract data from Spotrac.

Writes a single JSON file at frontend/public/data/contracts.json that the
frontend ContractCard reads. Manual-run only — not wired to any cron.

Usage:
  python scripts/scrape_contracts.py
  python scripts/scrape_contracts.py --team NYY   # single team test

Data flow:
  1. For each of 30 MLB teams: fetch /cap page, parse active roster table,
     pull player name + Spotrac player URL for each row.
  2. For each unique player URL, fetch the player page, parse:
       - Current contract year-by-year salary table
       - Average salary (AAV)
       - Free agent year
       - Signing bonus (if any)
  3. Derive: total value (sum of yearly), years (count of yearly), contract
     start/end year.
  4. Write consolidated JSON keyed by normalized name + team.

Respectful scraping:
  - curl_cffi (Chrome 120 fingerprint) to pass Cloudflare
  - 1.2s sleep between player pages
  - total runtime ~20 min for all 30 teams
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup
from curl_cffi import requests as cffi

ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT / "frontend" / "public" / "data" / "contracts.json"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("scrape_contracts")

# Spotrac team slug → MLB 3-letter abbr used across the app
TEAMS = [
    ("new-york-yankees", "NYY"),
    ("boston-red-sox", "BOS"),
    ("toronto-blue-jays", "TOR"),
    ("baltimore-orioles", "BAL"),
    ("tampa-bay-rays", "TB"),
    ("chicago-white-sox", "CWS"),
    ("cleveland-guardians", "CLE"),
    ("detroit-tigers", "DET"),
    ("kansas-city-royals", "KC"),
    ("minnesota-twins", "MIN"),
    ("houston-astros", "HOU"),
    ("los-angeles-angels", "LAA"),
    ("athletics", "ATH"),        # formerly Oakland
    ("seattle-mariners", "SEA"),
    ("texas-rangers", "TEX"),
    ("atlanta-braves", "ATL"),
    ("miami-marlins", "MIA"),
    ("new-york-mets", "NYM"),
    ("philadelphia-phillies", "PHI"),
    ("washington-nationals", "WSH"),
    ("chicago-cubs", "CHC"),
    ("cincinnati-reds", "CIN"),
    ("milwaukee-brewers", "MIL"),
    ("pittsburgh-pirates", "PIT"),
    ("st-louis-cardinals", "STL"),
    ("arizona-diamondbacks", "AZ"),
    ("colorado-rockies", "COL"),
    ("los-angeles-dodgers", "LAD"),
    ("san-diego-padres", "SD"),
    ("san-francisco-giants", "SF"),
]

IMPERSONATES = ("chrome120", "safari17_0", "chrome110", "safari15_5")


def _normalize(name: str) -> str:
    """Same normalization used across the app for player matching."""
    if not name:
        return ""
    nfd = unicodedata.normalize("NFD", name)
    ascii_only = "".join(c for c in nfd if not unicodedata.combining(c))
    out = ascii_only.lower()
    for junk in [".", ",", "'", "`", "-"]:
        out = out.replace(junk, "")
    for suffix in [" jr", " sr", " ii", " iii", " iv"]:
        if out.endswith(suffix):
            out = out[: -len(suffix)]
    return " ".join(out.split())


def _fetch(url: str, retries: int = 3) -> str | None:
    """curl_cffi GET with TLS-fingerprint rotation on 403."""
    last_err = None
    for i, imp in enumerate(IMPERSONATES[:retries]):
        try:
            r = cffi.get(url, impersonate=imp, timeout=25, allow_redirects=True)
            if r.status_code == 200:
                return r.text
            logger.warning("%s → %s (imp=%s)", url, r.status_code, imp)
            if r.status_code == 404:
                return None
        except Exception as e:
            last_err = e
            logger.warning("%s → err (%s), imp=%s", url, e, imp)
        time.sleep(1.5 * (i + 1))
    logger.error("giving up on %s: %s", url, last_err)
    return None


def parse_active_roster(html: str, team_abbr: str) -> list[dict]:
    """Return [{name, spotrac_url, current_salary}, ...] for the active roster
    table (table index 0 on a team /cap page)."""
    soup = BeautifulSoup(html, "html.parser")
    tables = soup.find_all("table")
    if not tables:
        return []
    table = tables[0]  # active roster
    body = table.find("tbody")
    if not body:
        return []
    roster = []
    for tr in body.find_all("tr"):
        cells = tr.find_all("td")
        if not cells:
            continue
        a = cells[0].find("a")
        if not a or not a.get("href"):
            continue
        href = a["href"]
        if not href.startswith("http"):
            href = "https://www.spotrac.com" + href
        # The name is in a span with the full name inside <a>
        spans = cells[0].find_all(["span", "a"])
        full_name = None
        for s in spans:
            txt = s.get_text(strip=True)
            # Full name has a space and isn't just the surname; the surname
            # alone comes first as a styled prefix.
            if txt and " " in txt and len(txt) > 4:
                full_name = txt
                break
        if not full_name:
            # Fallback: just concatenated text, take all after the first name-ish chunk
            full_name = cells[0].get_text(" ", strip=True)
        # Current year salary is typically the 6th column ("Payroll Salary")
        cur_salary = None
        if len(cells) > 5:
            s = cells[5].get_text(strip=True)
            m = re.search(r"\$[\d,]+", s)
            if m:
                cur_salary = int(m.group(0).replace("$", "").replace(",", ""))
        roster.append({
            "name": full_name,
            "normalized_name": _normalize(full_name),
            "team": team_abbr,
            "spotrac_url": href,
            "current_salary": cur_salary,
        })
    return roster


_DOLLAR_RE = re.compile(r"\$?([\d,]+)")


def _to_int(s: str) -> int | None:
    if not s:
        return None
    m = _DOLLAR_RE.search(s)
    if not m:
        return None
    try:
        return int(m.group(1).replace(",", ""))
    except ValueError:
        return None


def parse_player_contract(html: str) -> dict:
    """Extract the current contract from a Spotrac player page.

    Returns:
      {
        "aav": int or None,
        "signing_bonus": int or None,
        "free_agent_year": int or None,
        "total_value": int or None,
        "years": int or None,
        "start_year": int or None,
        "end_year": int or None,
        "yearly": [{"year": 2026, "salary": 40000000, "age": 34}, ...]
      }
    """
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text("\n", strip=True)

    out = {
        "aav": None, "signing_bonus": None, "free_agent_year": None,
        "total_value": None, "years": None,
        "start_year": None, "end_year": None,
        "yearly": [],
    }

    # Average salary
    m = re.search(r"Average Salary[:\s]+\$?([\d,]+)", text, re.I)
    if m:
        out["aav"] = _to_int(m.group(1))

    # Signing bonus (N/A if none)
    m = re.search(r"Signing Bonus[:\s]+\$?([\d,]+|N/A|-)", text, re.I)
    if m and not re.match(r"N/A|-", m.group(1), re.I):
        out["signing_bonus"] = _to_int(m.group(1))

    # Free agent year
    m = re.search(r"Free Agent[:\s]+(\d{4}|\(CURRENT\))", text, re.I)
    if m:
        raw = m.group(1)
        if raw != "(CURRENT)":
            try:
                out["free_agent_year"] = int(raw)
            except ValueError:
                pass

    # Year-by-year breakdown from the first table (current contract)
    tables = soup.find_all("table")
    if tables:
        t0 = tables[0]
        head = t0.find("thead")
        cols = []
        if head:
            cols = [c.get_text(strip=True) for c in head.find_all(["th", "td"])]
        # Find "Year" index + a salary index (PayrollAnnual, Cash, Base, or similar)
        year_idx = None
        age_idx = None
        salary_idx = None
        for i, c in enumerate(cols):
            cl = c.lower()
            if year_idx is None and cl == "year":
                year_idx = i
            elif age_idx is None and cl == "age":
                age_idx = i
            elif salary_idx is None and ("payroll" in cl or "cashannual" in cl or "base" in cl):
                salary_idx = i
        body = t0.find("tbody")
        if body and year_idx is not None and salary_idx is not None:
            for row in body.find_all("tr"):
                cells = [c.get_text(strip=True) for c in row.find_all(["td", "th"])]
                if len(cells) <= max(year_idx, salary_idx):
                    continue
                year_raw = cells[year_idx]
                # Year may contain extra text — grab leading 4-digit
                ym = re.search(r"\b(\d{4})\b", year_raw)
                if not ym:
                    continue
                year = int(ym.group(1))
                sal = _to_int(cells[salary_idx])
                if sal is None or sal == 0:
                    # Skip totals / separator rows
                    continue
                age = None
                if age_idx is not None and age_idx < len(cells):
                    try:
                        age = int(cells[age_idx].split()[0])
                    except (ValueError, IndexError):
                        age = None
                out["yearly"].append({"year": year, "salary": sal, "age": age})

    if out["yearly"]:
        out["start_year"] = min(r["year"] for r in out["yearly"])
        out["end_year"] = max(r["year"] for r in out["yearly"])
        out["years"] = len(out["yearly"])
        out["total_value"] = sum(r["salary"] for r in out["yearly"])

    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--team", help="Only scrape this team abbr (e.g. NYY) for testing")
    ap.add_argument("--delay", type=float, default=1.2,
                    help="Seconds to wait between player-page fetches (default 1.2)")
    ap.add_argument("--out", type=Path, default=OUT_PATH)
    args = ap.parse_args()

    target_teams = TEAMS
    if args.team:
        target_teams = [(s, a) for s, a in TEAMS if a == args.team.upper()]
        if not target_teams:
            logger.error("team %s not recognized", args.team)
            return 1

    all_players: list[dict] = []
    # Phase 1: collect active rosters + player URLs
    for slug, abbr in target_teams:
        url = f"https://www.spotrac.com/mlb/{slug}/cap"
        logger.info("team roster: %s (%s)", abbr, url)
        html = _fetch(url)
        if not html:
            logger.warning("  skipped: no HTML")
            continue
        roster = parse_active_roster(html, abbr)
        logger.info("  %s: %d active roster players", abbr, len(roster))
        all_players.extend(roster)
        time.sleep(args.delay)

    logger.info("total active-roster players: %d (fetching contracts)", len(all_players))

    # Phase 2: fetch each player's contract page
    for i, p in enumerate(all_players, 1):
        html = _fetch(p["spotrac_url"])
        if not html:
            p["contract"] = None
            continue
        p["contract"] = parse_player_contract(html)
        if i % 25 == 0:
            logger.info("  [%d/%d] %s %s: aav=%s yrs=%s total=%s",
                        i, len(all_players), p["team"], p["name"],
                        p["contract"]["aav"], p["contract"]["years"],
                        p["contract"]["total_value"])
        time.sleep(args.delay)

    # Write output
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "spotrac.com (active rosters)",
        "player_count": len(all_players),
        "players": all_players,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    logger.info("wrote %s (%d players)", args.out, len(all_players))


if __name__ == "__main__":
    sys.exit(main() or 0)
