"""Fantasy score projections endpoint."""

from __future__ import annotations

import logging
from datetime import date as date_cls

from fastapi import APIRouter, HTTPException, Query

from app.services import fantasy
from app.config import get_current_season

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/api/fantasy/projections")
async def get_fantasy_projections(
    date: str | None = Query(
        default=None,
        description="Target date (YYYY-MM-DD). Defaults to today.",
        regex=r"^\d{4}-\d{2}-\d{2}$",
    ),
    season: int | None = Query(default=None, ge=1900, le=2100),
):
    """
    Projected PrizePicks-style fantasy score per hitter for the requested
    date's slate, ranked best to worst.

    Scoring:
      1B=3 · 2B=5 · 3B=8 · HR=10 · R=2 · RBI=2 · BB=2 · HBP=2 · SB=5
    """
    target_date = date
    if target_date is None:
        target_date = date_cls.today().isoformat()

    try:
        payload = await fantasy.project_slate(date_iso=target_date, season=season)
        return payload
    except Exception as e:
        logger.exception("fantasy projections failed for %s", target_date)
        raise HTTPException(status_code=502, detail=f"projection failed: {e}") from e


@router.get("/api/fantasy/weights")
async def get_fantasy_weights():
    """
    Expose the current fantasy-score model weights so the UI can surface
    'weights updated X ago · R²=Y' on the Edge tab footer.
    """
    return fantasy.load_weights()
