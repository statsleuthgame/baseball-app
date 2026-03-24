import { useQuery } from "@tanstack/react-query";
import { fetchUmpireProfile } from "../../api/client";

/**
 * UmpireCard — shows pre-game umpire intelligence.
 * Displays accuracy%, zone size tendency, and pitcher/batter-friendly bias.
 *
 * Props:
 *   umpireName  {string}  Full name of home plate umpire
 */
export default function UmpireCard({ umpireName }) {
  const { data, isLoading } = useQuery({
    queryKey: ["umpire", umpireName],
    queryFn: () => fetchUmpireProfile(umpireName),
    enabled: !!umpireName,
    staleTime: 1000 * 60 * 60 * 6,
  });

  if (!umpireName) return null;
  if (isLoading) {
    return (
      <div className="umpire-card umpire-card--loading">
        <span className="umpire-label">HP Umpire</span>
        <span className="umpire-name">{umpireName}</span>
      </div>
    );
  }

  const notFound = !data || !data.found;

  const acc = data?.correctCallPct;
  const games = data?.gamesUmpired;
  const pitcherFriendly = data?.pitcherFriendly;
  const zone = data?.zoneSizePct;
  const summary = data?.summary;
  const recentTrend = data?.recentTrend;

  // Color-code accuracy: green >= 96, yellow 93-96, red < 93
  const accColor = acc == null ? undefined : acc >= 96 ? "#4caf50" : acc >= 93 ? "#ff9800" : "#f44336";

  // Friendly label
  const biasLabel = pitcherFriendly === true
    ? "Pitcher-friendly"
    : pitcherFriendly === false
    ? "Batter-friendly"
    : null;
  const biasColor = pitcherFriendly === true ? "#90caf9" : pitcherFriendly === false ? "#ffcc80" : undefined;

  return (
    <div className="umpire-card">
      <div className="umpire-card__header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="umpire-icon">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none"/>
          <line x1="12" y1="6" x2="12" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          <path d="M9 15 Q12 17 15 15" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        </svg>
        <span className="umpire-label">HP Umpire</span>
      </div>

      <div className="umpire-card__body">
        <span className="umpire-name">{umpireName}</span>

        {notFound ? (
          <span className="umpire-no-data">No historical data</span>
        ) : (
          <div className="umpire-stats">
            {acc != null && (
              <div className="umpire-stat">
                <span className="umpire-stat__label">Accuracy</span>
                <span className="umpire-stat__value" style={{ color: accColor }}>{acc}%</span>
                {recentTrend != null && recentTrend !== acc && (
                  <span className="umpire-trend" title="Last 30 days">
                    {recentTrend > acc ? "↑" : "↓"} {recentTrend}% recent
                  </span>
                )}
              </div>
            )}

            {games != null && (
              <div className="umpire-stat">
                <span className="umpire-stat__label">Games</span>
                <span className="umpire-stat__value">{games}</span>
              </div>
            )}

            {zone != null && (
              <div className="umpire-stat">
                <span className="umpire-stat__label">Zone</span>
                <span className="umpire-stat__value">
                  {zone > 103 ? "Large" : zone < 97 ? "Small" : "Average"}
                </span>
              </div>
            )}

            {biasLabel && (
              <div className="umpire-badge" style={{ backgroundColor: biasColor }}>
                {biasLabel}
              </div>
            )}

            {summary && (
              <p className="umpire-summary">{summary}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
