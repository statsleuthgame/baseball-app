import { formatAvg } from "../../utils/formatters";

export default function SpraySidebar({ summary }) {
  if (!summary || !summary.total) {
    return (
      <div className="spray-sidebar">
        <p className="no-data">No batted ball data available.</p>
      </div>
    );
  }

  const ab = summary.total;
  const hits = (summary.single || 0) + (summary.double || 0) + (summary.triple || 0) + (summary.home_run || 0);
  const avg = ab > 0 ? hits / ab : 0;

  return (
    <div className="spray-sidebar">
      <h4 className="spray-sidebar-title">Hit Breakdown</h4>
      <div className="spray-stat-list">
        <SprayStat label="1B" value={summary.single || 0} color="#4CAF50" />
        <SprayStat label="2B" value={summary.double || 0} color="#2196F3" />
        <SprayStat label="3B" value={summary.triple || 0} color="#FF9800" />
        <SprayStat label="HR" value={summary.home_run || 0} color="#F44336" />
        <SprayStat label="Outs" value={summary.out || 0} color="#616161" />
      </div>
      <div className="spray-totals">
        <div className="spray-total-row">
          <span>Total BIP</span>
          <span className="spray-total-val">{summary.total}</span>
        </div>
        <div className="spray-total-row">
          <span>BA on BIP</span>
          <span className="spray-total-val">{formatAvg(avg)}</span>
        </div>
      </div>
    </div>
  );
}

function SprayStat({ label, value, color }) {
  return (
    <div className="spray-stat-item">
      <span className="spray-stat-dot" style={{ backgroundColor: color }} />
      <span className="spray-stat-label">{label}</span>
      <span className="spray-stat-value">{value}</span>
    </div>
  );
}
