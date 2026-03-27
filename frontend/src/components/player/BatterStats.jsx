import { formatAvg } from "../../utils/formatters";

const STAT_ROWS = [
  { label: "AVG", key: "avg" },
  { label: "OBP", key: "obp" },
  { label: "SLG", key: "slg" },
  { label: "OPS", key: "ops" },
  { label: "G", key: "gamesPlayed" },
  { label: "AB", key: "atBats" },
  { label: "R", key: "runs" },
  { label: "H", key: "hits" },
  { label: "2B", key: "doubles" },
  { label: "3B", key: "triples" },
  { label: "HR", key: "homeRuns" },
  { label: "RBI", key: "rbi" },
  { label: "SB", key: "stolenBases" },
  { label: "BB", key: "baseOnBalls" },
  { label: "SO", key: "strikeOuts" },
];

const AVG_KEYS = new Set(["avg", "obp", "slg", "ops"]);

export default function BatterStats({ stats, season, selectedSeason, onSeasonChange, seasons }) {
  const hasStats = stats && Object.keys(stats).length > 0;

  return (
    <div className="stat-section">
      <div className="stat-section-header">
        <h3 className="stat-section-title">
          {season ? `${season} Batting` : "Batting Stats"}
        </h3>
        {seasons && onSeasonChange && (
          <select
            className="stat-season-select"
            value={selectedSeason}
            onChange={(e) => onSeasonChange(Number(e.target.value))}
          >
            {seasons.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        )}
      </div>
      {!hasStats ? (
        <p className="no-data">No batting stats available for {season || "this season"}.</p>
      ) : (
        <div className="stat-grid">
          {STAT_ROWS.map(({ label, key }) => (
            <div key={key} className="stat-cell">
              <span className="stat-label">{label}</span>
              <span className="stat-value">
                {AVG_KEYS.has(key) ? formatAvg(stats[key]) : (stats[key] ?? "—")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
