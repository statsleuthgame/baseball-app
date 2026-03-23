import { useQuery } from "@tanstack/react-query";
import { fetchPlayerArsenal } from "../../api/client";
import { formatAvg } from "../../utils/formatters";
import LoadingSpinner from "../common/LoadingSpinner";

const PITCH_COLORS = {
  FF: "#d32f2f", SI: "#e65100", FC: "#f57c00",
  SL: "#1976d2", CU: "#7b1fa2", KC: "#9c27b0",
  CH: "#2e7d32", FS: "#00695c", SV: "#0288d1",
  ST: "#5e35b1", KN: "#795548", CS: "#8e24aa",
};

export default function PitchArsenal({ playerId, embedded }) {
  const { data, isLoading } = useQuery({
    queryKey: ["arsenal", playerId],
    queryFn: () => fetchPlayerArsenal(playerId),
    enabled: !!playerId,
    staleTime: 1000 * 60 * 60,
  });

  if (isLoading) return <LoadingSpinner text="Loading arsenal..." />;
  if (!data?.pitches?.length) return <p className="no-data">No arsenal data available.</p>;

  // Embedded mode: compact table with fewer columns, no movement chart
  if (embedded) {
    return (
      <div>
        <div className="arsenal-bar" style={{ marginBottom: 10 }}>
          {data.pitches.map((p) => (
            <div
              key={p.pitchType}
              className="arsenal-bar-segment"
              style={{ width: `${p.usagePct}%`, backgroundColor: PITCH_COLORS[p.pitchType] || "#666" }}
            />
          ))}
        </div>
        <div className="arsenal-compact">
          {data.pitches.map((p) => (
            <div key={p.pitchType} className="arsenal-compact-row">
              <span className="pitch-dot" style={{ backgroundColor: PITCH_COLORS[p.pitchType] || "#666" }} />
              <span className="arsenal-compact-name">{p.pitchName}</span>
              <span className="arsenal-compact-stat">{p.usagePct}%</span>
              <span className="arsenal-compact-stat">{p.avgVelo ?? "—"} mph</span>
              <span className="arsenal-compact-stat">{p.whiffRate != null ? `${p.whiffRate}% whiff` : ""}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Full mode: detailed table + movement chart
  return (
    <div className="stat-section">
      <h3 className="stat-section-title">Pitch Arsenal</h3>

      <div className="arsenal-bar">
        {data.pitches.map((p) => (
          <div
            key={p.pitchType}
            className="arsenal-bar-segment"
            style={{ width: `${p.usagePct}%`, backgroundColor: PITCH_COLORS[p.pitchType] || "#666" }}
          />
        ))}
      </div>

      <div className="arsenal-table-wrap">
        <table className="arsenal-table">
          <thead>
            <tr>
              <th>Pitch</th>
              <th>Use%</th>
              <th>Velo</th>
              <th>Spin</th>
              <th>Whiff%</th>
              <th>PutAway%</th>
              <th>BA</th>
            </tr>
          </thead>
          <tbody>
            {data.pitches.map((p) => (
              <tr key={p.pitchType}>
                <td className="arsenal-pitch-name">
                  <span className="pitch-dot" style={{ backgroundColor: PITCH_COLORS[p.pitchType] || "#666" }} />
                  {p.pitchName}
                </td>
                <td>{p.usagePct}%</td>
                <td>{p.avgVelo ?? "—"}</td>
                <td>{p.avgSpin ?? "—"}</td>
                <td className={p.whiffRate >= 30 ? "elite-stat" : ""}>{p.whiffRate != null ? `${p.whiffRate}%` : "—"}</td>
                <td>{p.putawayRate != null ? `${p.putawayRate}%` : "—"}</td>
                <td>{p.baAgainst != null ? formatAvg(p.baAgainst) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="arsenal-movement">
        <h4 className="arsenal-sub-title">Pitch Movement (inches)</h4>
        <svg viewBox="-25 -25 50 50" className="movement-chart">
          <line x1="-20" y1="0" x2="20" y2="0" stroke="#1e2a3e" strokeWidth="0.3" />
          <line x1="0" y1="-20" x2="0" y2="20" stroke="#1e2a3e" strokeWidth="0.3" />
          {[-10, 10].map((v) => (
            <g key={v}>
              <line x1={v} y1="-20" x2={v} y2="20" stroke="#1e2a3e" strokeWidth="0.15" />
              <line x1="-20" y1={v} x2="20" y2={v} stroke="#1e2a3e" strokeWidth="0.15" />
            </g>
          ))}
          <text x="22" y="1" fill="#8891a5" fontSize="2.5">HB</text>
          <text x="-1" y="-22" fill="#8891a5" fontSize="2.5">VB</text>
          {data.pitches
            .filter((p) => p.horzBreak != null && p.vertBreak != null)
            .map((p) => (
              <g key={p.pitchType}>
                <circle cx={p.horzBreak} cy={-p.vertBreak} r="2" fill={PITCH_COLORS[p.pitchType] || "#666"} opacity="0.85" />
                <text x={p.horzBreak} y={-p.vertBreak + 4} fill="#e0e4ec" fontSize="2" textAnchor="middle">{p.pitchType}</text>
              </g>
            ))}
        </svg>
      </div>
    </div>
  );
}
