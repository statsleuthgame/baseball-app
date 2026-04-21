"""Pull Retrosheet archives directly from retrosheet.org.

Retrosheet publishes per-season zips of event files plus multi-decade
zips of game logs. We download the raw zips (tiny, a few MB each) into
raw/retrosheet/zips/ and leave parsing for a later pass — the Chadwick
`cwevent` binary is the canonical parser and isn't a Python dep we want
to force here.
"""

from __future__ import annotations

import argparse
from datetime import date

import httpx

from .paths import raw

EVENTS_URL = "https://www.retrosheet.org/events/{year}eve.zip"
GAMELOG_URL = "https://www.retrosheet.org/gamelogs/gl{year}.zip"
FIRST_YEAR = 1921  # Retrosheet event coverage starts getting dense here


def _download(client: httpx.Client, url: str, dest) -> bool:
    try:
        r = client.get(url, timeout=60, follow_redirects=True)
        if r.status_code != 200 or not r.content:
            return False
        dest.write_bytes(r.content)
        return True
    except Exception as exc:
        print(f"retrosheet {url}: {exc}")
        return False


def pull_events(start_year: int = FIRST_YEAR, force: bool = False) -> None:
    out_dir = raw("retrosheet", "zips", "events")
    out_dir.mkdir(parents=True, exist_ok=True)
    end_year = date.today().year - 1
    with httpx.Client(headers={"User-Agent": "baseball-db/1.0"}) as client:
        for year in range(start_year, end_year + 1):
            dest = out_dir / f"{year}eve.zip"
            if dest.exists() and not force:
                continue
            ok = _download(client, EVENTS_URL.format(year=year), dest)
            print(f"retrosheet events {year}: {'ok' if ok else 'missing'}")


def pull_gamelogs(start_year: int = 1871, force: bool = False) -> None:
    out_dir = raw("retrosheet", "zips", "gamelogs")
    out_dir.mkdir(parents=True, exist_ok=True)
    end_year = date.today().year - 1
    with httpx.Client(headers={"User-Agent": "baseball-db/1.0"}) as client:
        for year in range(start_year, end_year + 1):
            dest = out_dir / f"gl{year}.zip"
            if dest.exists() and not force:
                continue
            ok = _download(client, GAMELOG_URL.format(year=year), dest)
            if ok:
                print(f"retrosheet gamelogs {year}: ok")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start-year", type=int, default=FIRST_YEAR)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--skip-gamelogs", action="store_true")
    args = ap.parse_args()
    pull_events(start_year=args.start_year, force=args.force)
    if not args.skip_gamelogs:
        pull_gamelogs(force=args.force)


if __name__ == "__main__":
    main()
