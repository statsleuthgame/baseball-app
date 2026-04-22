"""Load daily Model-1 picks from the Edge repo for the combined
best-parlays view.

The Edge repo's `scripts/tools/generate_daily_picks.py` writes a JSON
file of today's highest-confidence Hits / TB / HR picks. This service
reads that file and normalizes each pick into the shape
`parlays.build_best_parlays()` expects.

Integration contract (by design, loose):
  - File location is configurable via env var `EDGE_DAILY_PICKS_PATH`.
    Default: `~/Desktop/Visual Studio Projects/Edge/outputs/daily_picks.json`.
  - If the file doesn't exist, we return an empty list. The Baseball
    App's existing fantasy-edge pipeline still produces parlays on its
    own — the Edge-repo integration is a PLUS, not a dependency.

Game-context enrichment:
  Picks come in with `{mlbam_id, player, team, market, line, side, p_win, ...}`.
  To run parlay math we need `{team_abbr, opp_abbr, opp_pitcher, game_key}`.
  The caller (the fantasy generator) already has that context per player
  and passes it in as a map. If a player isn't in the map we drop the
  leg rather than guess.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import date
from pathlib import Path

log = logging.getLogger(__name__)

_DEFAULT_PATH = (
    Path.home() / "Desktop" / "Visual Studio Projects" / "Edge"
    / "outputs" / "daily_picks.json"
)

# Reboot-rate floor to flag a pick as "reboot strategy" — bumps the source tag
# so the UI can badge it specially.
REBOOT_FLAG_THRESHOLD = 0.15


def picks_path() -> Path:
    env = os.environ.get("EDGE_DAILY_PICKS_PATH")
    return Path(env).expanduser() if env else _DEFAULT_PATH


def load_raw(target_date: str | None = None) -> dict | None:
    """Read the raw JSON file; return None if missing or wrong-date."""
    path = picks_path()
    if not path.exists():
        log.info("edge_model_picks: no file at %s — skipping", path)
        return None
    try:
        raw = json.loads(path.read_text())
    except Exception as e:
        log.warning("edge_model_picks: failed to read %s (%s)", path, e)
        return None
    target = target_date or date.today().isoformat()
    file_date = raw.get("target_date")
    if file_date and file_date != target:
        log.info("edge_model_picks: file date %s != target %s — skipping",
                 file_date, target)
        return None
    return raw


def _platoon_advantage(bat_side: str | None, p_throws: str | None) -> str:
    """Label the matchup for UI display.
       '✓ platoon'   — batter has handedness advantage (incl. switch)
       '✗ same-side' — pitcher has handedness advantage
       '? unknown'   — missing info
    """
    b = (bat_side or '').upper()
    t = (p_throws or '').upper()
    if b == 'S':
        return '✓ platoon'
    if b in ('L', 'R') and t in ('L', 'R'):
        return '✓ platoon' if b != t else '✗ same-side'
    return '? unknown'


def load_model_legs(
    target_date: str | None = None,
    *,
    player_context: dict[int, dict] | None = None,
) -> list[dict]:
    """Return Edge-repo Model 1 picks as parlay-ready legs.

    `player_context[mlbam_id]` supplies the game context the picks file
    does not carry on its own:
        {team_abbr, opp_abbr, opp_pitcher, game_key, team_id,
         bat_side (opt), opp_p_throws (opt)}

    If the context map is empty or a pick's player isn't in it we drop
    that leg — we can't run the no-same-game guard without a game_key.
    When bat_side + opp_p_throws are present, each leg gets a
    `platoon` label for UI badges.
    """
    raw = load_raw(target_date)
    if not raw:
        return []
    picks = raw.get("picks") or []
    if not picks or not player_context:
        return []

    MARKET_TO_SOURCE = {
        "hits":         "model_hits",
        "total_bases":  "model_tb",
        "home_runs":    "model_hr",
    }

    legs: list[dict] = []
    for p in picks:
        pid = p.get("mlbam_id")
        if pid is None:
            continue
        ctx = player_context.get(int(pid))
        if not ctx or not ctx.get("game_key"):
            continue
        market = (p.get("market") or "").lower()
        source = MARKET_TO_SOURCE.get(market, "model")
        # Reboot flag: reserve for Overs where the rolling reboot-rate
        # clears a conservative floor.
        if (p.get("reboot_rate") or 0) >= REBOOT_FLAG_THRESHOLD \
           and (p.get("side") or "over").lower() == "over":
            source = f"{source}+reboot"
        bat_side = ctx.get("bat_side")
        p_throws = ctx.get("opp_p_throws")
        legs.append({
            "player_id":   int(pid),
            "name":        p.get("player"),
            "team_abbr":   ctx.get("team_abbr") or (p.get("team") or "").upper(),
            "opp_abbr":    ctx.get("opp_abbr"),
            "opp_pitcher": ctx.get("opp_pitcher"),
            "market":      market,
            "line":        p.get("line"),
            "side":        (p.get("side") or "over").lower(),
            "hit_prob":    p.get("p_win"),
            "p_win":       p.get("p_win"),
            "edge":        p.get("edge"),
            "reboot_rate": p.get("reboot_rate"),
            "source":      source,
            "game_key":    ctx.get("game_key"),
            # Platoon info — optional; upstream may not populate these.
            "bat_side":    bat_side,
            "opp_p_throws": p_throws,
            "platoon":     _platoon_advantage(bat_side, p_throws),
        })
    log.info("edge_model_picks: %d model legs loaded (%s)", len(legs), picks_path())
    return legs


def build_reboot_watchlist(
    target_date: str | None = None,
    *,
    player_context: dict[int, dict] | None = None,
    min_reboot: float = REBOOT_FLAG_THRESHOLD,
) -> list[dict]:
    """Return every Model 1 pick whose `reboot_rate` clears the threshold,
    regardless of whether it makes a parlay. Each entry is annotated with
    platoon-advantage label and a "play hint" suggesting whether the
    reboot signal + matchup aligns on the OVER or UNDER."""
    raw = load_raw(target_date)
    if not raw:
        return []
    picks = raw.get("picks") or []
    if not picks or not player_context:
        return []

    import math
    out: list[dict] = []
    for p in picks:
        rb = p.get("reboot_rate")
        # Drop None and NaN — pandas emits NaN when a player has fewer
        # than 10 games in the lookback window, which json silently
        # stringifies. `NaN < 0.15` is False under IEEE-754 so the
        # comparison alone wouldn't filter them.
        if rb is None or (isinstance(rb, float) and math.isnan(rb)):
            continue
        if rb < min_reboot:
            continue
        pid = p.get("mlbam_id")
        if pid is None:
            continue
        ctx = player_context.get(int(pid)) or {}
        bat_side = ctx.get("bat_side")
        p_throws = ctx.get("opp_p_throws")
        platoon  = _platoon_advantage(bat_side, p_throws)
        side = (p.get("side") or "over").lower()
        # Alignment hint:
        #   Over  + platoon advantage  → reboot + tailwind (both favor batter)
        #   Under + same-side          → reboot + pitcher edge (both suppress)
        hint = None
        if side == "over"  and platoon.startswith("✓"):
            hint = "aligned_over"
        elif side == "under" and platoon.startswith("✗"):
            hint = "aligned_under"
        elif platoon.startswith("✓") or platoon.startswith("✗"):
            hint = "split"   # matchup says one thing, model says another
        out.append({
            "mlbam_id":     int(pid),
            "player":       p.get("player"),
            "team":         ctx.get("team_abbr") or (p.get("team") or "").upper(),
            "opp":          ctx.get("opp_abbr"),
            "opp_pitcher":  ctx.get("opp_pitcher"),
            "market":       (p.get("market") or "").lower(),
            "line":         p.get("line"),
            "side":         side,
            "p_win":        p.get("p_win"),
            "reboot_rate":  rb,
            "reboot_games": p.get("reboot_games"),
            "bat_side":     bat_side,
            "opp_p_throws": p_throws,
            "platoon":      platoon,
            "hint":         hint,
        })
    # Sort: aligned picks first, then by p_win desc
    priority = {"aligned_over": 0, "aligned_under": 1, "split": 2, None: 3}
    out.sort(key=lambda r: (priority.get(r["hint"], 9), -(r["p_win"] or 0)))
    return out


def tag_fantasy_legs(picks: list[dict]) -> list[dict]:
    """Attach `source='fantasy_edge'` + canonical market tag to Baseball
    App fantasy picks so the UI can badge them consistently."""
    out = []
    for p in picks:
        q = dict(p)
        q.setdefault("source", "fantasy_edge")
        q.setdefault("market", "fantasy_score")
        q.setdefault("side", "over")
        out.append(q)
    return out
