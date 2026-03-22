import { formatEra, formatAvg } from "../../utils/formatters";

const STAT_ROWS = [
  { label: "ERA", key: "era", fmt: "era" },
  { label: "W", key: "wins" },
  { label: "L", key: "losses" },
  { label: "G", key: "gamesPlayed" },
  { label: "GS", key: "gamesStarted" },
  { label: "IP", key: "inningsPitched" },
  { label: "H", key: "hits" },
  { label: "R", key: "runs" },
  { label: "ER", key: "earnedRuns" },
  { label: "HR", key: "homeRuns" },
  { label: "BB", key: "baseOnBalls" },
  { label: "SO", key: "strikeOuts" },
  { label: "WHIP", key: "whip", fmt: "era" },
  { label: "AVG", key: "avg", fmt: "avg" },
  { label: "SV", key: "saves" },
];

export default function PitcherStats({ stats }) {
  if (!stats || Object.keys(stats).length === 0) {
    return <p className="no-data">No pitching stats available.</p>;
  }

  return (
    <div className="stat-section">
      <h3 className="stat-section-title">Pitching Stats</h3>
      <div className="stat-grid">
        {STAT_ROWS.map(({ label, key, fmt }) => {
          let val = stats[key];
          if (fmt === "era") val = formatEra(val);
          else if (fmt === "avg") val = formatAvg(val);
          else val = val ?? "—";
          return (
            <div key={key} className="stat-cell">
              <span className="stat-label">{label}</span>
              <span className="stat-value">{val}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
