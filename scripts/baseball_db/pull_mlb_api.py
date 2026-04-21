"""Pull MLB StatsAPI: schedules (all history) + boxscores/plays (2008+).

Async with a connection pool for throughput. Batches per-game JSONs into
one Parquet per year to avoid hundreds of thousands of tiny files.

- schedules: one JSON per year, all the way back to 1901
- boxscores: one Parquet per year (rows keyed by gamePk, payload JSON stored as string)
- plays:     one Parquet per year, same layout

2008 is the cutoff for structured play-by-play / rich boxscores in
StatsAPI. Earlier years return schedules but sparse game feeds — we skip
those endpoints to avoid burning hours on empty payloads.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from datetime import date
from pathlib import Path

import httpx
import pandas as pd

from .paths import raw

BASE = "https://statsapi.mlb.com/api/v1"
CONCURRENCY = 15
SCHEDULE_FIRST_YEAR = 1901
FEED_FIRST_YEAR = 2008  # plays/boxscores only reliable from here


async def _get(client: httpx.AsyncClient, url: str, sem: asyncio.Semaphore, retries: int = 3):
    for attempt in range(retries):
        try:
            async with sem:
                r = await client.get(url, timeout=30)
                r.raise_for_status()
                return r.json()
        except Exception as exc:
            if attempt == retries - 1:
                return {"_error": str(exc)}
            await asyncio.sleep(1.5 * (attempt + 1))
    return {"_error": "exhausted"}


async def pull_season_schedule(
    client: httpx.AsyncClient, sem: asyncio.Semaphore, year: int, force: bool
) -> list[int]:
    out = raw("mlb_api", "schedule") / f"year={year}.json"
    if out.exists() and not force:
        data = json.loads(out.read_text())
    else:
        url = f"{BASE}/schedule?sportId=1&startDate={year}-01-01&endDate={year}-12-31"
        data = await _get(client, url, sem)
        out.write_text(json.dumps(data))

    return [g["gamePk"] for d in data.get("dates", []) for g in d.get("games", []) if g.get("gamePk")]


async def pull_year_feeds(
    client: httpx.AsyncClient, sem: asyncio.Semaphore, year: int, force: bool
) -> None:
    box_out = raw("mlb_api", "boxscores") / f"year={year}.parquet"
    play_out = raw("mlb_api", "plays") / f"year={year}.parquet"
    if box_out.exists() and play_out.exists() and not force:
        return

    game_pks = await pull_season_schedule(client, sem, year, force=False)
    if not game_pks:
        return

    print(f"mlb {year}: fetching feeds for {len(game_pks)} games")

    async def fetch(pk: int, kind: str):
        url = f"{BASE}/game/{pk}/{kind}"
        return pk, await _get(client, url, sem)

    # Run box + plays together; asyncio.gather with semaphore throttles concurrency.
    box_tasks = [fetch(pk, "boxscore") for pk in game_pks]
    play_tasks = [fetch(pk, "playByPlay") for pk in game_pks]

    box_results = await asyncio.gather(*box_tasks)
    play_results = await asyncio.gather(*play_tasks)

    pd.DataFrame(
        [{"gamePk": pk, "payload": json.dumps(r)} for pk, r in box_results]
    ).to_parquet(box_out, index=False)
    pd.DataFrame(
        [{"gamePk": pk, "payload": json.dumps(r)} for pk, r in play_results]
    ).to_parquet(play_out, index=False)


async def _run(
    schedule_start: int,
    feed_start: int,
    force: bool,
    schedule_only: bool,
) -> None:
    end_year = date.today().year
    sem = asyncio.Semaphore(CONCURRENCY)
    limits = httpx.Limits(max_connections=CONCURRENCY, max_keepalive_connections=CONCURRENCY)
    headers = {"User-Agent": "baseball-db/1.0"}

    async with httpx.AsyncClient(limits=limits, headers=headers, http2=False) as client:
        # Schedules first, all history, sequential per year (fast — one request each).
        for year in range(schedule_start, end_year + 1):
            pks = await pull_season_schedule(client, sem, year, force=force)
            print(f"mlb schedule {year}: {len(pks)} games")

        if schedule_only:
            return

        # Feeds for the modern era, one season at a time so each year's Parquet
        # lands atomically and memory stays bounded.
        for year in range(max(feed_start, schedule_start), end_year + 1):
            await pull_year_feeds(client, sem, year, force=force)


def pull_all(start_year: int = SCHEDULE_FIRST_YEAR, force: bool = False) -> None:
    asyncio.run(
        _run(
            schedule_start=start_year,
            feed_start=FEED_FIRST_YEAR,
            force=force,
            schedule_only=False,
        )
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--schedule-start", type=int, default=SCHEDULE_FIRST_YEAR)
    ap.add_argument("--feed-start", type=int, default=FEED_FIRST_YEAR)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--schedule-only", action="store_true")
    args = ap.parse_args()

    asyncio.run(
        _run(
            schedule_start=args.schedule_start,
            feed_start=args.feed_start,
            force=args.force,
            schedule_only=args.schedule_only,
        )
    )


if __name__ == "__main__":
    main()
