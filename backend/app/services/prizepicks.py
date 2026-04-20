"""
PrizePicks lines fetcher — for comparing our projected EFP to the house's
posted over/under so users can see the gap (edge) on each pick.

PrizePicks does NOT offer an official API. This module uses the
community-known unofficial JSON endpoint at api.prizepicks.com/projections.
It's public (no auth), returns all active projections as JSON:API, and is
what every PrizePicks analytics tool in the wild uses.

Reality checks:
- PrizePicks can change / break / Cloudflare this endpoint anytime.
- Every call path here is defensive: on any failure we return an empty
  result and the rest of the pipeline proceeds without PrizePicks data.
  The UI just omits the "PP line / edge" chip when unavailable.
- Lines shift through the day; we cache for 10 min.
"""

from __future__ import annotations

import asyncio
import logging
import unicodedata
from typing import Any

from app.services.cache import get as cache_get, set as cache_set

# PrizePicks sits behind Cloudflare and TLS-fingerprints the caller. Plain
# httpx gets blanket 403's; curl_cffi impersonates a real Chrome/Safari TLS
# fingerprint and passes. If the lib isn't available we short-circuit to
# an empty result so the pipeline still ships.
try:
    from curl_cffi import requests as cffi_requests  # type: ignore
    _HAS_CURL_CFFI = True
except Exception:  # pragma: no cover
    cffi_requests = None  # type: ignore
    _HAS_CURL_CFFI = False

logger = logging.getLogger(__name__)

_PP_BASE = "https://api.prizepicks.com"
_MLB_LEAGUE_ID = 2
_CACHE_TTL = 60 * 10  # 10 minutes
_HEADERS = {
    # PrizePicks allows anonymous GET from browsers. Identify ourselves
    # politely so we don't look like a headless scraper.
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) "
        "AppleWebKit/605.1 (KHTML, like Gecko) Version/17.0 Safari/605.1"
    ),
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
}

# Map PrizePicks stat_type → our internal key in the projection response.
# Only includes hitter-relevant types we might want to surface.
_HITTER_STAT_MAP = {
    "Hitter Fantasy Score": "fantasy",   # the direct EFP comparison
    "Hits": "hits",
    "Hits+Runs+RBIs": "hrr",
    "Total Bases": "total_bases",
    "Home Runs": "home_runs",
    "RBIs": "rbis",
    "Runs": "runs",
    "Walks": "walks",
    "Singles": "singles",
    "Doubles": "doubles",
    "Stolen Bases": "stolen_bases",
    "Hitter Strikeouts": "strikeouts",
}


def _normalize_name(name: str | None) -> str:
    """
    Strip accents, lowercase, remove punctuation — so 'José Ramírez' and
    'Jose Ramirez' and 'J. Ramirez Jr.' all collapse to the same key.
    """
    if not name:
        return ""
    nfd = unicodedata.normalize("NFD", name)
    ascii_only = "".join(c for c in nfd if not unicodedata.combining(c))
    out = ascii_only.lower()
    for junk in [".", ",", "'", "`", "-"]:
        out = out.replace(junk, "")
    # Strip common suffixes
    for suffix in [" jr", " sr", " ii", " iii", " iv"]:
        if out.endswith(suffix):
            out = out[: -len(suffix)]
    return " ".join(out.split())


async def fetch_lines() -> dict[str, dict[str, float]]:
    """
    Return a dict keyed by normalized player display name, with each value
    being that player's active PrizePicks lines:
      {
        "mike trout": {
          "fantasy": 10.5,
          "hits": 1.5,
          "total_bases": 1.5,
          "home_runs": 0.5,
          ...
        },
        ...
      }
    Returns {} on any failure (cached or live).
    """
    cached = cache_get("prizepicks:mlb:lines")
    if cached is not None:
        return cached

    if not _HAS_CURL_CFFI:
        logger.warning(
            "prizepicks: curl_cffi not installed — skipping line fetch. "
            "Add curl_cffi>=0.5 to requirements to enable."
        )
        cache_set("prizepicks:mlb:lines", {}, 60 * 2)
        return {}

    # Cloudflare frequently 403's GitHub Actions runner IPs on the first
    # attempt. Retry with:
    #   1. Multiple TLS fingerprints (Cloudflare's bot detector may have
    #      flagged safari17_0 for this IP; rotating impersonation often
    #      clears the block within 2-3 tries)
    #   2. Exponential backoff (1s, 3s, 9s) so we don't hammer on block
    _IMPERSONATE_ROTATION = ("safari17_0", "chrome120", "chrome110", "safari15_5")

    def _blocking_fetch() -> dict:
        import time
        last_err: Exception | None = None
        for attempt, impersonate in enumerate(_IMPERSONATE_ROTATION):
            try:
                resp = cffi_requests.get(
                    f"{_PP_BASE}/projections",
                    params={"league_id": _MLB_LEAGUE_ID, "per_page": 500},
                    headers=_HEADERS,
                    impersonate=impersonate,
                    timeout=15,
                )
                resp.raise_for_status()
                if attempt > 0:
                    logger.info("prizepicks: recovered on attempt %d with %s",
                                attempt + 1, impersonate)
                return resp.json()
            except Exception as e:
                last_err = e
                status = getattr(getattr(e, "response", None), "status_code", None)
                # 403 = Cloudflare block — retry with different fingerprint.
                # Other errors (timeouts, DNS) also worth retrying once or twice.
                if attempt < len(_IMPERSONATE_ROTATION) - 1:
                    backoff = 1 * (3 ** attempt)
                    logger.warning(
                        "prizepicks: attempt %d with %s failed (%s) — retrying in %ds with rotation",
                        attempt + 1, impersonate, status or type(e).__name__, backoff,
                    )
                    time.sleep(backoff)
        # All attempts failed.
        raise last_err if last_err else RuntimeError("prizepicks: all fetch attempts failed")

    try:
        payload = await asyncio.to_thread(_blocking_fetch)
    except Exception as e:
        logger.warning("prizepicks fetch failed after all retries: %s", e)
        cache_set("prizepicks:mlb:lines", {}, 60 * 2)  # short TTL on failure
        return {}

    data = payload.get("data") or []
    included = payload.get("included") or []

    # Index players by PrizePicks ID. Player shape has display_name + team.
    players = {}
    for r in included:
        if r.get("type") != "new_player":
            continue
        pid = r.get("id")
        attrs = r.get("attributes") or {}
        if not pid or not attrs.get("display_name"):
            continue
        players[pid] = {
            "name": attrs.get("display_name") or attrs.get("name") or "",
            "team": attrs.get("team") or "",
            "position": attrs.get("position") or "",
        }

    # PrizePicks publishes each stat_type THREE times per player with
    # odds_type in {standard, demon, goblin}. The "standard" line is the
    # default shown in their app and the one our EFP model should be
    # compared against. Demon lines are inflated (hardest-to-clear
    # over-bar for higher payouts) and goblin lines are deflated. Always
    # prefer standard; fall back only if PP hasn't posted a standard for
    # that player/stat.
    _PREFERENCE = {"standard": 0, "demon": 1, "goblin": 2}

    # First pass: group rows by (player, stat_key) so we can pick the
    # best odds_type among competing rows.
    by_key: dict[tuple[str, str], list[tuple[int, float]]] = {}
    name_team: dict[str, tuple[str, str]] = {}
    for row in data:
        attrs = row.get("attributes") or {}
        stat_type = attrs.get("stat_type")
        key = _HITTER_STAT_MAP.get(stat_type)
        if not key:
            continue
        line = attrs.get("line_score")
        if line is None:
            continue
        try:
            line = float(line)
        except (TypeError, ValueError):
            continue
        rel = (row.get("relationships") or {}).get("new_player") or {}
        pid = (rel.get("data") or {}).get("id")
        p = players.get(pid)
        if not p:
            continue
        norm = _normalize_name(p["name"])
        if not norm:
            continue
        odds_type = (attrs.get("odds_type") or "").lower()
        priority = _PREFERENCE.get(odds_type, 99)
        by_key.setdefault((norm, key), []).append((priority, line))
        name_team.setdefault(norm, (p["name"], p["team"]))

    out: dict[str, dict[str, float]] = {}
    for (norm, key), variants in by_key.items():
        variants.sort(key=lambda x: x[0])  # standard first (priority 0)
        _, best_line = variants[0]
        full_name, team = name_team.get(norm, ("", ""))
        bucket = out.setdefault(norm, {"_name": full_name, "_team": team})
        bucket[key] = best_line

    cache_set("prizepicks:mlb:lines", out, _CACHE_TTL)
    logger.info("prizepicks: cached %d hitters with lines", len(out))
    return out


def lookup_for_batter(
    lines: dict[str, dict], full_name: str, team_abbr: str | None = None
) -> dict | None:
    """
    Find the PrizePicks lines for a given MLB batter. Prefers a team match
    as a tiebreaker for common names.
    """
    if not full_name:
        return None
    norm = _normalize_name(full_name)
    hit = lines.get(norm)
    if hit is None:
        return None
    # If team disagrees, still return — MLB may have traded the player and
    # PP hasn't updated. Caller can decide whether to trust.
    if team_abbr and hit.get("_team") and hit["_team"] != team_abbr:
        logger.debug(
            "prizepicks: team mismatch for %s (MLB=%s, PP=%s) — still matching",
            full_name, team_abbr, hit.get("_team"),
        )
    # Return a copy minus the underscore-prefixed meta keys.
    return {k: v for k, v in hit.items() if not k.startswith("_")}
