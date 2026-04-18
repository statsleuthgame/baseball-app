import { useNavigate } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";

/**
 * Secret "Edge" tab — a hidden page surfacing ranked daily batter picks based
 * on a blend of last-7-games form, batter-vs-pitcher history, and
 * batter-vs-team history. Accessed only via the green $ icon in TopBar.
 *
 * Phase 1: entry point + empty route only. Data pipeline, scoring, sort/filter
 * chips, expandable details, and polish land in later phases.
 */
export default function BettingEdge() {
  const navigate = useNavigate();
  const { team } = useTeam();

  const todayLabel = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  const handleBack = () => {
    if (team?.id) navigate(`/team/${team.id}`);
    else navigate(-1);
  };

  return (
    <div className="edge-page">
      <header className="edge-header">
        <div className="edge-header-row">
          <h1 className="edge-title">
            TODAY'S EDGE <span className="edge-dollar" aria-hidden="true">$</span>
          </h1>
          <button
            type="button"
            className="edge-back"
            onClick={handleBack}
            aria-label="Back to team dashboard"
          >
            ← Back
          </button>
        </div>
        <p className="edge-subtitle">Picks for {todayLabel}</p>
      </header>

      <section className="edge-placeholder" aria-live="polite">
        <div className="edge-placeholder-icon" aria-hidden="true">$</div>
        <h2 className="edge-placeholder-title">Cooking up today's picks</h2>
        <p className="edge-placeholder-copy">
          Ranked bat picks across today's MLB slate are coming in the next build —
          a blend of who's hot in the last 7 games, who has raked historically
          against the opposing team, and who owns the pitcher they're facing.
        </p>
        <p className="edge-disclaimer">For entertainment only. Not financial advice.</p>
      </section>
    </div>
  );
}
