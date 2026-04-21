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


# ---------------------------------------------------------------------------
# NEW — combined "Best Parlays" builder
#
# The existing build_parlays() is single-source (fantasy-score edge_z only).
# build_best_parlays() accepts legs from any source — fantasy edge, Edge-repo
# Model 1 (Hits / TB / HR), reboot overlay — as long as each leg already
# carries a normalized hit_prob.
#
# Each leg must include:
#   player_id, name, team_abbr, opp_abbr, market, line, side, hit_prob,
#   source ("fantasy_edge" | "model_hits" | "model_tb" | "model_hr" | "reboot")
# Optional: projection fields (efp/proj), notes, payout overrides for demons.
#
# Guards (stricter than build_parlays):
#   - No two legs share a game (same correlation concern as before).
#   - No two legs share a PLAYER — a player's hits Over and fantasy Over
#     are deeply correlated; treating them as independent would cook the
#     book.
#   - At most one "home_runs" market leg per parlay — they're binary lottery
#     picks with low individual hit rate, stacking them blows the combined
#     prob to nothing.
# ---------------------------------------------------------------------------

# Default shape of the 6-card output: two 2-mans (diversified), two 3-mans,
# two 4-mans. Caller can override via size_plan.
DEFAULT_SIZE_PLAN: tuple[int, ...] = (2, 2, 3, 3, 4, 4)


def _ensure_hit_prob(pick: dict) -> dict:
    """Legs from the Edge-repo model already ship with `p_win`; fantasy
    legs ship with `edge_z` and we derive `hit_prob` from Φ(z). Normalize
    both flavors into a uniform `hit_prob`, `game_key`, `source` shape."""
    if pick.get("hit_prob") is not None:
        return {**pick, "game_key": pick.get("game_key") or _game_key(pick)}
    # Prefer p_win (Edge Model 1 output)
    if pick.get("p_win") is not None:
        return {
            **pick,
            "hit_prob": float(pick["p_win"]),
            "game_key": pick.get("game_key") or _game_key(pick),
        }
    # Fall back to fantasy edge_z → Φ(z)
    return _enriched(pick)


def _legs_same_player(combo: Iterable[dict]) -> bool:
    seen: set[Any] = set()
    for p in combo:
        pid = p.get("player_id")
        if pid in seen:
            return True
        seen.add(pid)
    return False


def _legs_too_many_hrs(combo: Iterable[dict], max_hr: int = 1) -> bool:
    hr = sum(1 for p in combo if (p.get("market") or "").lower() == "home_runs")
    return hr > max_hr


def _valid_combo(combo: Iterable[dict]) -> bool:
    c = list(combo)
    return (
        _legs_disjoint_by_game(c)
        and not _legs_same_player(c)
        and not _legs_too_many_hrs(c)
    )


def _format_leg_rich(p: dict) -> dict:
    """Like _format_leg but preserves source / market / side so the UI
    can tag each leg. Supports both fantasy-style (efp, edge_z) and
    model-style (p_win, edge, reboot_rate) payloads."""
    pp = p.get("prizepicks") or {}
    leg = {
        "player_id":  p.get("player_id") or p.get("mlbam_id"),
        "name":       p.get("name") or p.get("player"),
        "team_abbr":  p.get("team_abbr") or p.get("team"),
        "opp_abbr":   p.get("opp_abbr"),
        "opp_pitcher": (p.get("opp_pitcher") or {}).get("fullName")
                         if isinstance(p.get("opp_pitcher"), dict)
                         else p.get("opp_pitcher"),
        "market":     p.get("market") or "fantasy_score",
        "line":       p.get("line") if p.get("line") is not None else pp.get("fantasy"),
        "side":       (p.get("side") or "over").lower(),
        "hit_prob":   round(float(p["hit_prob"]), 3),
        "source":     p.get("source") or "fantasy_edge",
    }
    # Source-specific extras
    if p.get("efp") is not None:
        leg["efp"] = round(float(p["efp"]), 2)
    if p.get("edge_z") is not None:
        leg["edge_z"] = round(float(p["edge_z"]), 3)
    if p.get("edge") is not None:
        leg["edge"] = round(float(p["edge"]), 3)
    if p.get("reboot_rate") is not None:
        leg["reboot_rate"] = round(float(p["reboot_rate"]), 3)
    return leg


def _best_combo_rich(
    candidates: list[dict],
    size: int,
    exclude_ids: set[Any] | None = None,
    payout_override: float | None = None,
) -> dict | None:
    """size-N combo that maximizes EV, using the rich-leg formatter +
    full guard set (no same game, no same player, ≤1 HR market leg)."""
    exclude = exclude_ids or set()
    payout = payout_override or _POWER_PAYOUT.get(size)
    if not payout:
        return None

    pool = [p for p in candidates if (p.get("player_id") or p.get("mlbam_id")) not in exclude]
    if len(pool) < size:
        return None

    best: tuple[float, tuple[dict, ...]] | None = None
    for combo in itertools.combinations(pool, size):
        if not _valid_combo(combo):
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
        "size":          size,
        "payout":        payout,
        "combined_prob": round(prob, 4),
        "ev_pct":        round(ev * 100, 1),
        "legs":          [_format_leg_rich(p) for p in combo],
    }


def build_best_parlays(
    picks: list[dict],
    *,
    size_plan: tuple[int, ...] = DEFAULT_SIZE_PLAN,
    max_candidates: int = 30,
) -> list[dict]:
    """Curated daily parlay slate.

    `picks` is any mix of legs — fantasy-edge picks (with edge_z), Edge
    Model 1 picks (with p_win + reboot_rate), or hand-tagged Overs. Each
    must identify its player + opponent and hit_prob can be derived from
    either `p_win` or `edge_z`. Internally we normalize to `hit_prob`
    and run an EV search per desired size in `size_plan`.

    Diversity policy:
      - For REPEATED sizes in the plan (e.g. two 2-mans), each extra one
        must exclude at least one player from the previous same-size
        parlay. This guarantees visually distinct ideas — not near-
        duplicates with a single substitution.

    Returns a list of up to len(size_plan) parlays, in plan order.
    """
    if not picks:
        return []

    # 1) Normalize hit_prob, drop unusable, cap the candidate pool for
    #    perf (top-N by hit_prob keeps combinations() tractable for 4-man).
    enriched = [_ensure_hit_prob(p) for p in picks]
    enriched = [p for p in enriched if p.get("hit_prob") is not None]
    enriched.sort(key=lambda p: -p["hit_prob"])
    enriched = enriched[:max_candidates]
    if len(enriched) < 2:
        return []

    parlays: list[dict] = []
    # Track previous-size parlays for the diversity guard.
    prev_by_size: dict[int, list[dict]] = {}
    for size in size_plan:
        exclude_ids: set[Any] = set()
        prev = prev_by_size.get(size) or []
        if prev:
            # Exclude every leg from the most recent same-size parlay so
            # the next one is forced to substitute at least one.
            exclude_ids = {leg["player_id"] for leg in prev[-1]["legs"]}
        parlay = _best_combo_rich(enriched, size, exclude_ids=exclude_ids)
        # If no valid combo exists after exclusion, relax to the full
        # pool so we always fill the slot.
        if parlay is None:
            parlay = _best_combo_rich(enriched, size)
        if parlay is None:
            continue
        parlays.append(parlay)
        prev_by_size.setdefault(size, []).append(parlay)

    return parlays
