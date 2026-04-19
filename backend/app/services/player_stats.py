"""
Per-player historical EFP stats (mean + stdev) loaded from the
`player_efp_stats_<season>.json` cache built by
`scripts/build_player_efp_stats.py`.

Used to compute confidence-adjusted edge scoring:

    edge_z = (projected_efp - pp_line) / stdev_efp

A player with low game-to-game variance at a given projected EFP is a
higher-confidence pick than one with wild swings to the same projection.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

_DATA_DIR = Path(__file__).resolve().parent.parent / "data"


@lru_cache(maxsize=8)
def _load_stats(season: int) -> dict:
    path = _DATA_DIR / f"player_efp_stats_{season}.json"
    if not path.exists():
        logger.info("player_efp_stats: no cache for season %d (%s)", season, path.name)
        return {}
    try:
        with path.open() as f:
            return json.load(f)
    except Exception as e:
        logger.warning("player_efp_stats: failed to load %s: %s", path, e)
        return {}


def get_player_stats(player_id: int, season: int) -> dict:
    """Return {'mean', 'stdev', 'n'} for the player, falling back to slate
    defaults if the player isn't in the cache."""
    cache = _load_stats(season)
    by_pid = cache.get(str(int(player_id)))
    if by_pid:
        return {
            "mean": float(by_pid.get("mean", 0.0)),
            "stdev": float(by_pid.get("stdev", 0.0)),
            "n": int(by_pid.get("n", 0)),
        }
    defaults = cache.get("_defaults") or {}
    return {
        "mean": float(defaults.get("mean", 6.5)),
        "stdev": float(defaults.get("stdev", 7.0)),
        "n": 0,  # sentinel: no player-specific data
    }


def compute_edge_z(
    projected_efp: float,
    pp_line: float | None,
    stdev: float | None,
) -> float | None:
    """How many stdevs of headroom the projection has above the PP line.
    Positive = projection exceeds line (bet OVER); larger magnitude = more
    confident. Returns None if inputs are missing or stdev is unusable."""
    if pp_line is None or projected_efp is None or not stdev or stdev <= 0.5:
        # Below 0.5 stdev, noise dominates — not trustworthy.
        return None
    return (projected_efp - pp_line) / stdev
