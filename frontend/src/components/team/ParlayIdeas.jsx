import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchTodaysParlays } from "../../api/client";

/**
 * "Parlay Ideas" button + expandable panel at the top of the Edge page.
 *
 * Content is pre-computed by scripts/generate_fantasy_projections.py at
 * morning lock time (see backend/app/services/parlays.py for the math)
 * and served as a static JSON file — intentionally no LLM call, no
 * Claude API cost per view.
 *
 * Shows 4 parlays: best 2-man, a diversified second 2-man, best 3-man,
 * best 4-man. Each enforces no-same-game to keep the independence
 * assumption in the combined-probability calc honest.
 */
export default function ParlayIdeas() {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["fantasy", "parlays"],
    queryFn: fetchTodaysParlays,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
  });

  const parlays = data?.parlays || [];
  const hasParlays = parlays.length > 0;

  return (
    <div className="parlay-ideas">
      <button
        type="button"
        className={`parlay-toggle ${open ? "open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="parlay-ideas-panel"
      >
        <span className="parlay-toggle-icon" aria-hidden="true">🎯</span>
        <span className="parlay-toggle-label">Parlay Ideas</span>
        {hasParlays && (
          <span className="parlay-toggle-count">{parlays.length}</span>
        )}
        <span className="parlay-toggle-caret" aria-hidden="true">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div id="parlay-ideas-panel" className="parlay-panel">
          {isLoading ? (
            <p className="parlay-empty">Loading parlay ideas…</p>
          ) : !hasParlays ? (
            <p className="parlay-empty">
              Parlay ideas generate with the morning lock. Check back once
              PrizePicks lines post.
            </p>
          ) : (
            <>
              <p className="parlay-sub">
                EV-optimized picks from today's lock · no same-game legs ·
                assuming independent outcomes
              </p>
              <div className="parlay-list">
                {parlays.map((p, i) => (
                  <ParlayCard key={i} parlay={p} index={i} />
                ))}
              </div>
              <p className="parlay-footnote">
                Combined probability is the product of per-leg hit rates
                derived from edge-z. EV% = probability × payout − 1. PrizePicks
                can shift lines intraday — always verify on the app before
                playing.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ParlayCard({ parlay, index }) {
  const { size, payout, combined_prob, ev_pct, legs } = parlay;
  // Highlight the top EV parlay so users know which is our best-math pick.
  // We rank the whole list by EV descending and ribbon the best one.
  // The backend emits in order [2-man, 2-man, 3-man, 4-man] — the 4-man
  // tends to win EV, but the user should see that clearly.
  const probPct = Math.round((combined_prob || 0) * 1000) / 10; // one decimal
  const evLabel = ev_pct >= 0 ? `+${ev_pct.toFixed(1)}%` : `${ev_pct.toFixed(1)}%`;

  return (
    <div className="parlay-card">
      <div className="parlay-card-head">
        <div className="parlay-card-title">
          <span className="parlay-size">{size}-man</span>
          <span className="parlay-payout">{payout}× payout</span>
        </div>
        <div className="parlay-card-metrics">
          <span className="parlay-metric">
            <span className="parlay-metric-label">Prob</span>
            <span className="parlay-metric-value">{probPct}%</span>
          </span>
          <span
            className={`parlay-metric parlay-ev ${ev_pct > 0 ? "positive" : "negative"}`}
          >
            <span className="parlay-metric-label">EV</span>
            <span className="parlay-metric-value">{evLabel}</span>
          </span>
        </div>
      </div>
      <ul className="parlay-legs">
        {legs.map((leg) => (
          <li key={leg.player_id} className="parlay-leg">
            <div className="parlay-leg-name">
              <span className="parlay-leg-side">OVER</span>
              <span>{leg.name}</span>
              <span className="parlay-leg-team">
                {leg.team_abbr} vs {leg.opp_abbr}
              </span>
            </div>
            <div className="parlay-leg-line">
              <span className="parlay-leg-stat">Fantasy</span>
              <span className="parlay-leg-number">{leg.line}</span>
              <span className="parlay-leg-proj">
                proj {leg.efp} · {Math.round(leg.hit_prob * 100)}%
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
