import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPlayerArsenal } from "../../api/client";
import { formatAvg } from "../../utils/formatters";
import { scaleLinear } from "d3-scale";
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

      <PitchMovementChart pitches={data.pitches} />
    </div>
  );
}

const MV_W_TOTAL = 320;
const MV_H_TOTAL = 310;
const MV_MARGIN = { top: 28, right: 36, bottom: 44, left: 44 };
const MV_W = MV_W_TOTAL - MV_MARGIN.left - MV_MARGIN.right;
const MV_H = MV_H_TOTAL - MV_MARGIN.top - MV_MARGIN.bottom;

function PitchMovementChart({ pitches }) {
  const [hovered, setHovered] = useState(null);
  const movementPitches = pitches.filter((p) => p.horzBreak != null && p.vertBreak != null);
  if (!movementPitches.length) return null;

  const allH = movementPitches.map((p) => p.horzBreak);
  const allV = movementPitches.map((p) => p.vertBreak);
  const extent = Math.max(Math.max(...allH.map(Math.abs)), Math.max(...allV.map(Math.abs)), 15);
  const domainMax = Math.ceil(extent / 5) * 5;

  const xScale = scaleLinear().domain([-domainMax, domainMax]).range([0, MV_W]);
  const yScale = scaleLinear().domain([-domainMax, domainMax]).range([MV_H, 0]);

  const gridTicks = [];
  for (let i = -domainMax; i <= domainMax; i += 5) gridTicks.push(i);

  return (
    <div className="arsenal-movement">
      <h4 className="arsenal-sub-title">Pitch Movement</h4>
      <p className="arsenal-movement-desc">How each pitch moves from the batter's view. Right = arm-side run, Up = rise vs gravity.</p>
      <svg viewBox={`0 0 ${MV_W_TOTAL} ${MV_H_TOTAL}`} className="movement-chart" role="img" aria-label="Pitch movement scatter chart">
        <rect width={MV_W_TOTAL} height={MV_H_TOTAL} fill="rgba(0,0,0,0.2)" rx="8" />
        <g transform={`translate(${MV_MARGIN.left},${MV_MARGIN.top})`}>
          {/* Grid */}
          {gridTicks.map((t) => (
            <g key={t}>
              <line x1={xScale(t)} y1={0} x2={xScale(t)} y2={MV_H} stroke={t === 0 ? "#ffffff18" : "#ffffff08"} strokeWidth={t === 0 ? 0.8 : 0.4} />
              <line x1={0} y1={yScale(t)} x2={MV_W} y2={yScale(t)} stroke={t === 0 ? "#ffffff18" : "#ffffff08"} strokeWidth={t === 0 ? 0.8 : 0.4} />
            </g>
          ))}

          {/* Axis labels */}
          {gridTicks.filter((t) => t % 10 === 0 && t !== 0).map((t) => (
            <g key={`label-${t}`}>
              <text x={xScale(t)} y={MV_H + 14} fill="#9299ad" fontSize="8" textAnchor="middle">{t}"</text>
              <text x={-8} y={yScale(t) + 3} fill="#9299ad" fontSize="8" textAnchor="end">{t}"</text>
            </g>
          ))}

          {/* Axis titles */}
          <text x={MV_W / 2} y={-12} fill="#9299ad" fontSize="9" textAnchor="middle" fontWeight="500">More Rise</text>
          <text x={MV_W / 2} y={MV_H + 26} fill="#9299ad" fontSize="9" textAnchor="middle" fontWeight="500">More Drop</text>
          <text x={MV_W + 10} y={MV_H / 2 + 3} fill="#9299ad" fontSize="8" textAnchor="start">Arm</text>
          <text x={-12} y={MV_H / 2 + 3} fill="#9299ad" fontSize="8" textAnchor="end">Glove</text>

          {/* Pitch dots with size proportional to usage */}
          {movementPitches.map((p) => {
            const cx = xScale(p.horzBreak);
            const cy = yScale(p.vertBreak);
            const r = Math.max(6, Math.sqrt(p.usagePct || 10) * 3);
            const isHovered = hovered === p.pitchType;
            return (
              <g key={p.pitchType}
                onMouseEnter={() => setHovered(p.pitchType)}
                onMouseLeave={() => setHovered(null)}
                onTouchStart={() => setHovered(hovered === p.pitchType ? null : p.pitchType)}
                style={{ cursor: "pointer" }}
              >
                <circle cx={cx} cy={cy} r={r + (isHovered ? 3 : 0)} fill={PITCH_COLORS[p.pitchType] || "#666"} opacity={isHovered ? 1 : 0.8} stroke={isHovered ? "#fff" : "none"} strokeWidth="1.5" />
                <text x={cx} y={cy + r + 10} fill="#e0e4ec" fontSize="8" textAnchor="middle" fontWeight="600">{p.pitchType}</text>

                {/* Tooltip */}
                {isHovered && (
                  <g>
                    <rect x={cx - 45} y={cy - r - 38} width="90" height="30" rx="4" fill="#1a2236" stroke="#2e3a4e" strokeWidth="0.5" />
                    <text x={cx} y={cy - r - 24} fill="#fff" fontSize="8" textAnchor="middle" fontWeight="600">{p.pitchName}</text>
                    <text x={cx} y={cy - r - 14} fill="#9299ad" fontSize="7" textAnchor="middle">
                      {p.avgVelo}mph · {p.horzBreak}"{p.vertBreak >= 0 ? " rise" : " drop"}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
