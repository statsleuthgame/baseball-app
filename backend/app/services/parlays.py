"""
Parlay idea generator — builds the 4 EV-optimal parlays from the day's
locked picks so the Edge page can surface them without calling any LLM.

Why this lives on the backend, written at lock time (not computed in the
browser):
  - The picks the user sees are frozen by the morning lock. Parlays
    should be computed off the SAME frozen set so what they see stays
    consistent all day even if intraday refreshes shuffle edge_z a bit.
  - Cheap: pure math, one normal CDF per pick + ~400 combinations max.
  - Decouples the UI from the probability math (backtest / recalibrate
    without touching React).

Math
----
Each locked pick has `edge_z = (efp - pp_line) / stdev_efp`. Treating the
true fantasy outcome as roughly normal around the projection, the
probability the actual score clears the line is:

    hit_prob = Φ(edge_z)

PrizePicks Power Play standard payouts (multiplier on stake):
    2-leg: 3×
    3-leg: 5×
    4-leg: 10×

Parlay EV (assuming independence):
    combined_prob = Π(hit_prob_i)
    ev_pct = combined_prob · payout - 1

Correlation guard
-----------------
Two legs from the same game violate independence (shared weather, park,
umpire, bullpen, score script). We enforce a hard constraint: no two
legs may share a `game_key` — `sorted([team_abbr, opp_abbr]).join("-")`.
That rules out both "two bats from the same team" and "one bat per side
of the same matchup". It costs some EV on paper but keeps the posted
combined_prob believable.
"""

from __future__ import annotations

import itertools
import math
from typing import Any, Iterable

# PrizePicks standard Power Play multipliers. If they change their
# payout table in the wild, update here — the rest of the math keys off
# this dict.
_POWER_PAYOUT: dict[int, float] = {
    2: 3.0,
    3: 5.0,
    4: 10.0,
}


def _phi(z: float) -> float:
    """Standard-normal CDF. math.erf is plenty for our needs."""
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def _game_key(pick: dict) -> str:
    """Game identity both teams agree on: sorted abbreviations joined."""
    a = (pick.get("team_abbr") or "").upper()
    b = (pick.get("opp_abbr") or "").upper()
    return "-".join(sorted([a, b]))


def _enriched(pick: dict) -> dict:
    """Attach hit_prob + game_key to a pick for downstream math."""
    z = pick.get("edge_z")
    if z is None:
        return {**pick, "hit_prob": None, "game_key": _game_key(pick)}
    # Clip z to a reasonable band so a freak 3σ projection doesn't claim
    # 99.9% hit — our stdev estimate isn't that trustworthy yet.
    z_capped = max(-2.5, min(2.5, float(z)))
    return {
        **pick,
        "hit_prob": _phi(z_capped),
        "game_key": _game_key(pick),
    }


def _legs_disjoint_by_game(combo: Iterable[dict]) -> bool:
    """Every leg must come from a different game."""
    seen: set[str] = set()
    for p in combo:
        gk = p["game_key"]
        if gk in seen:
            return False
        seen.add(gk)
    return True


def _format_leg(p: dict) -> dict:
    """Trim a pick to the fields the parlay card actually renders."""
    pp = p.get("prizepicks") or {}
    return {
        "player_id": p.get("player_id"),
        "name": p.get("name"),
        "team_abbr": p.get("team_abbr"),
        "opp_abbr": p.get("opp_abbr"),
        "opp_pitcher": (p.get("opp_pitcher") or {}).get("fullName"),
        "line": pp.get("fantasy"),
        "side": "over",   # lock picks are always overs (positive edge_z)
        "efp": round(float(p.get("efp") or 0.0), 2),
        "edge_z": round(float(p.get("edge_z") or 0.0), 3),
        "hit_prob": round(float(p["hit_prob"]), 3),
    }


def _best_combo(
    candidates: list[dict],
    size: int,
    exclude_ids: set[Any] | None = None,
) -> dict | None:
    """Find the size-N combo with the best EV.

    `exclude_ids` lets the caller force diversity — e.g. when picking
    the second 2-man parlay we exclude every player in the first one so
    the user gets two genuinely different ideas, not "the same parlay
    minus one leg + one substitution".
    """
    exclude = exclude_ids or set()
    payout = _POWER_PAYOUT.get(size)
    if not payout:
        return None

    pool = [p for p in candidates if p.get("player_id") not in exclude]
    if len(pool) < size:
        return None

    best: tuple[float, tuple[dict, ...]] | None = None
    for combo in itertools.combinations(pool, size):
        if not _legs_disjoint_by_game(combo):
            continue
        prob = 1.0
        for p in combo:
            prob *= p["hit_prob"]
        ev = prob * payout - 1.0
        if best is None or ev > best[0]:
            best = (ev, combo)

    if best is None:
        return None

    ev, combo = best
    prob = 1.0
    for p in combo:
        prob *= p["hit_prob"]
    return {
        "size": size,
        "payout": payout,
        "combined_prob": round(prob, 4),
        "ev_pct": round(ev * 100, 1),
        "legs": [_format_leg(p) for p in combo],
    }


def build_parlays(picks: list[dict]) -> list[dict]:
    """Return the 4 parlays we show on the Edge page.

    Slate: two 2-man parlays (diversified — second one shares no legs
    with the first), one 3-man, one 4-man.
    """
    if not picks:
        return []

    # Enrich, drop anything without a usable edge_z (can't compute prob),
    # and sort by hit_prob desc. We feed the sorted pool into every
    # combo search — combinations() still enumerates all C(n, k) cases
    # but the ordering makes debug output readable.
    enriched = [_enriched(p) for p in picks]
    enriched = [p for p in enriched if p.get("hit_prob") is not None]
    enriched.sort(key=lambda p: -p["hit_prob"])

    if len(enriched) < 2:
        return []

    parlays: list[dict] = []

    # Parlay 1: best 2-man
    p1 = _best_combo(enriched, 2)
    if p1:
        parlays.append(p1)

    # Parlay 2: best 2-man that shares NO legs with parlay 1.
    if p1:
        excluded = {leg["player_id"] for leg in p1["legs"]}
        p2 = _best_combo(enriched, 2, exclude_ids=excluded)
        if p2:
            parlays.append(p2)

    # Parlay 3: best 3-man (may overlap with the 2-mans; that's fine —
    # the user is picking one parlay to run, not stacking them).
    p3 = _best_combo(enriched, 3)
    if p3:
        parlays.append(p3)

    # Parlay 4: best 4-man
    p4 = _best_combo(enriched, 4)
    if p4:
        parlays.append(p4)

    return parlays
