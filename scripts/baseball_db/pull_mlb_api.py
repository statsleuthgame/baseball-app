"""Pull MLB StatsAPI data: schedules, boxscores, play-by-play.

Schedules are one JSON per season. Boxscores and plays are one JSON per
gamePk under year=YYYY partitions. Idempotent via file existence checks.
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import date

import httpx

from .paths import raw

BASE = "https://statsapi.mlb.com/api/v1"
# StatsAPI has schedule data back to 1901, detailed feeds are richer post-2008.
FIRST_YEAR = 1901


def _get(client: httpx.Client, url: str, retries: int = 3) -> dict:
    for attempt in range(retries):
        try:
            r = client.get(url, timeout=30)
            r.raise_for_status()
            return r.json()
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(1.5 * (attempt + 1))
    return {}


def pull_season_schedule(client: httpx.Client, year: int, force: bool = False) -> list[int]:
    """Return the list of gamePks for the season; cache the schedule JSON."""
    out = raw("mlb_api", "schedule") / f"year={year}.json"
    if out.exists() and not force:
        data = json.loads(out.read_text())
    else:
        url = f"{BASE}/schedule?sportId=1&startDate={year}-01-01&endDate={year}-12-31"
        data = _get(client, url)
        out.write_text(json.dumps(data))

    game_pks: list[int] = []
    for d in data.get("dates", []):
        for g in d.get("games", []):
            pk = g.get("gamePk")
            if pk:
                game_pks.append(pk)
    return game_pks


def pull_game_feeds(
    client: httpx.Client, year: int, game_pks: list[int], force: bool = False
) -> None:
    box_dir = raw("mlb_api", "boxscores", f"year={year}")
    play_dir = raw("mlb_api", "plays", f"year={year}")

    for i, pk in enumerate(game_pks, 1):
        box_file = box_dir / f"{pk}.json"
        play_file = play_dir / f"{pk}.json"

        if not box_file.exists() or force:
            try:
                box = _get(client, f"{BASE}/game/{pk}/boxscore")
                box_file.write_text(json.dumps(box))
            except Exception as exc:
                print(f"mlb boxscore {pk}: {exc}")

        if not play_file.exists() or force:
            try:
                plays = _get(client, f"{BASE}/game/{pk}/playByPlay")
                play_file.write_text(json.dumps(plays))
            except Exception as exc:
                print(f"mlb plays {pk}: {exc}")

        if i % 200 == 0:
            print(f"mlb {year}: {i}/{len(game_pks)} games")


def pull_all(start_year: int = FIRST_YEAR, force: bool = False) -> None:
    end_year = date.today().year
    with httpx.Client(headers={"User-Agent": "baseball-db/1.0"}) as client:
        for year in range(start_year, end_year + 1):
            pks = pull_season_schedule(client, year, force=force)
            print(f"mlb schedule {year}: {len(pks)} games")
            pull_game_feeds(client, year, pks, force=force)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start-year", type=int, default=2008)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--schedule-only", action="store_true")
    args = ap.parse_args()

    if args.schedule_only:
        with httpx.Client(headers={"User-Agent": "baseball-db/1.0"}) as client:
            for year in range(args.start_year, date.today().year + 1):
                pks = pull_season_schedule(client, year, force=args.force)
                print(f"mlb schedule {year}: {len(pks)} games")
    else:
        pull_all(start_year=args.start_year, force=args.force)


if __name__ == "__main__":
    main()
