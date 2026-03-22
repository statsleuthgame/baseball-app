import { useQuery } from "@tanstack/react-query";
import { fetchPlayerDominance } from "../../api/client";
import { formatAvg } from "../../utils/formatters";
import LoadingSpinner from "../common/LoadingSpinner";

export default function DominanceProfile({ playerId }) {
  const { data, isLoading } = useQuery({
    queryKey: ["dominance", playerId],
    queryFn: () => fetchPlayerDominance(playerId),
    enabled: !!playerId,
    staleTime: 1000 * 60 * 60,
  });

  if (isLoading) return <LoadingSpinner text="Loading dominance profile..." />;
  if (!data || Object.keys(data).length === 0) return null;

  const { byHandedness, byBattedBallType, situational } = data;

  return (
    <div className="stat-section">
      <h3 className="stat-section-title">Dominance Profile</h3>

      {/* Situational overview */}
      {situational && Object.keys(situational).length > 0 && (
        <div className="dominance-overview">
          <div className="dominance-badge">
            Most dominant vs <strong>{situational.dominantAgainst}</strong>
          </div>
          <div className="stat-grid dominance-situational">
            <StatCell label="K%" value={`${situational.kPct}%`} />
            <StatCell label="BB%" value={`${situational.bbPct}%`} />
            <StatCell label="Hard Hit%" value={situational.hardHitPct != null ? `${situational.hardHitPct}%` : "—"} />
            <StatCell label="Barrel%" value={situational.barrelPct != null ? `${situational.barrelPct}%` : "—"} />
            <StatCell label="BABIP" value={situational.babip != null ? formatAvg(situational.babip) : "—"} />
            <StatCell label="Avg EV" value={situational.avgExitVelo != null ? `${situational.avgExitVelo}` : "—"} />
            <StatCell label="F-Strike%" value={situational.fStrikePct != null ? `${situational.fStrikePct}%` : "—"} />
          </div>
        </div>
      )}

      {/* Handedness splits */}
      {byHandedness?.length > 0 && (
        <div className="dominance-splits">
          <h4 className="dominance-sub-title">By Batter Handedness</h4>
          <div className="splits-grid">
            {byHandedness.map((split) => (
              <div key={split.side} className="split-card">
                <span className="split-label">{split.label}</span>
                <div className="split-stats">
                  <div className="split-stat">
                    <span className="split-stat-val">{formatAvg(split.baAgainst)}</span>
                    <span className="split-stat-lbl">BA</span>
                  </div>
                  <div className="split-stat">
                    <span className="split-stat-val">{formatAvg(split.opsAgainst)}</span>
                    <span className="split-stat-lbl">OPS</span>
                  </div>
                  <div className="split-stat">
                    <span className="split-stat-val">{split.kPct}%</span>
                    <span className="split-stat-lbl">K%</span>
                  </div>
                  <div className="split-stat">
                    <span className="split-stat-val">{split.whiffRate != null ? `${split.whiffRate}%` : "—"}</span>
                    <span className="split-stat-lbl">Whiff%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Batted ball breakdown */}
      {byBattedBallType?.length > 0 && (
        <div className="dominance-bb">
          <h4 className="dominance-sub-title">Batted Ball Breakdown</h4>
          <div className="bb-bars">
            {byBattedBallType.map((bb) => (
              <div key={bb.type} className="bb-bar-row">
                <span className="bb-label">{bb.label}</span>
                <div className="bb-bar-track">
                  <div
                    className="bb-bar-fill"
                    style={{ width: `${bb.pct}%` }}
                  />
                </div>
                <span className="bb-pct">{bb.pct}%</span>
                <span className="bb-ba">{bb.baAgainst != null ? formatAvg(bb.baAgainst) : "—"} BA</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCell({ label, value }) {
  return (
    <div className="stat-cell">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}
