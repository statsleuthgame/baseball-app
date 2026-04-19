#!/usr/bin/env python3
"""
Generate today's Hitter Fantasy Score projections as a static JSON file
the frontend can read directly — no backend needed at runtime.

Intended to be called by the daily GH Actions `refresh-data.yml`
workflow right after `generate_data.py`. Writes to
  frontend/public/data/fantasy/projections_today.json
so the frontend `fetchFantasyProjections()` can load it via the same
static-fetch pattern as every other page of the app.

Reuses the same `app.services.fantasy.project_slate` function that the
(local-dev-only) FastAPI endpoint serves — single source of truth for
the projection math.

Usage:
    python scripts/generate_fantasy_projections.py [--date YYYY-MM-DD]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from datetime import date as date_cls
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.services import fantasy, mlb_api  # noqa: E402


OUT_DIR = ROOT / "frontend" / "public" / "data" / "fantasy"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("generate_fantasy")


async def generate(date_iso: str | None) -> None:
    target = date_iso or date_cls.today().isoformat()
    logger.info("Building projections for %s", target)

    payload = await fantasy.project_slate(date_iso=target)

    payload["generated_at"] = datetime.now(timezone.utc).isoformat()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "projections_today.json"
    out_path.write_text(json.dumps(payload, indent=2) + "\n")

    logger.info(
        "Wrote %s — %d candidates scored, top %d saved (calibrated=%s, R²=%s)",
        out_path,
        payload.get("projection_count", 0),
        len(payload.get("projections", [])),
        payload.get("calibrated"),
        (payload.get("metrics") or {}).get("r2"),
    )

    await mlb_api.close_client()


def main():
    p = argparse.ArgumentParser(description="Generate today's fantasy projections JSON.")
    p.add_argument("--date", default=None, help="Target date YYYY-MM-DD (default today).")
    args = p.parse_args()
    asyncio.run(generate(args.date))


if __name__ == "__main__":
    main()
