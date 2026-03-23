import { useQuery } from "@tanstack/react-query";
import { fetchPlayerAdvanced } from "../../api/client";
import { formatAvg } from "../../utils/formatters";
import LoadingSpinner from "../common/LoadingSpinner";

// Percentile thresholds for each stat: [poor, below avg, avg, above avg, elite]
// "higher" = true means higher values are better
const STAT_CONFIG = {
  avgExitVelo:    { min: 82, max: 94, higher: true },
  maxExitVelo:    { min: 102, max: 118, higher: true },
  hardHitPct:     { min: 25, max: 55, higher: true },
  barrelPct:      { min: 3, max: 18, higher: true },
  avgLaunchAngle: { min: 5, max: 20, higher: true },  // sweet spot ~12-18
  whiffRate:      { min: 15, max: 35, higher: false }, // lower is better
  chaseRate:      { min: 20, max: 38, higher: false }, // lower is better
  gbPct:          { min: 30, max: 55, higher: false }, // lower generally better for power
  fbPct:          { min: 25, max: 50, higher: true },
  ldPct:          { min: 15, max: 30, higher: true },
  xBA:            { min: .220, max: .310, higher: true },
  xSLG:           { min: .320, max: .550, higher: true },
  xwOBA:          { min: .280, max: .400, higher: true },
};

// Returns a value from 0 (worst) to 1 (best)
function getPercentile(key, rawValue) {
  const config = STAT_CONFIG[key];
  if (!config || rawValue == null) return null;

  const { min, max, higher } = config;
  let pct = (rawValue - min) / (max - min);
  pct = Math.max(0, Math.min(1, pct));
  if (!higher) pct = 1 - pct;
  return pct;
}

// Percentile to color: light blue (0) -> white (0.5) -> red (1.0)
function percentileColor(pct) {
  if (pct == null) return undefined;

  if (pct <= 0.5) {
    // 0 = deep blue, 0.5 = neutral gray
    const t = pct / 0.5;
    const r = Math.round(30 + t * 140);
    const g = Math.round(100 + t * 100);
    const b = Math.round(220 - t * 50);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    // 0.5 = neutral, 1.0 = deep red
    const t = (pct - 0.5) / 0.5;
    const r = Math.round(170 + t * 75);
    const g = Math.round(200 - t * 150);
    const b = Math.round(170 - t * 130);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

export default function AdvancedBatterStats({ playerId }) {
  const { data, isLoading } = useQuery({
    queryKey: ["advanced", playerId],
    queryFn: () => fetchPlayerAdvanced(playerId),
    enabled: !!playerId,
    staleTime: 1000 * 60 * 60,
  });

  if (isLoading) return <LoadingSpinner text="Loading advanced stats..." />;
  if (!data || Object.keys(data).length === 0) return null;

  const stats = [
    { key: "avgExitVelo", label: "Avg EV", value: data.avgExitVelo, fmt: (v) => `${v}` },
    { key: "maxExitVelo", label: "Max EV", value: data.maxExitVelo, fmt: (v) => `${v}` },
    { key: "hardHitPct", label: "Hard Hit%", value: data.hardHitPct, fmt: (v) => `${v}%` },
    { key: "barrelPct", label: "Barrel%", value: data.barrelPct, fmt: (v) => `${v}%` },
    { key: "avgLaunchAngle", label: "Avg LA", value: data.avgLaunchAngle, fmt: (v) => `${v}°` },
    { key: "whiffRate", label: "Whiff%", value: data.whiffRate, fmt: (v) => `${v}%` },
    { key: "chaseRate", label: "Chase%", value: data.chaseRate, fmt: (v) => `${v}%` },
    { key: "gbPct", label: "GB%", value: data.gbPct, fmt: (v) => `${v}%` },
    { key: "fbPct", label: "FB%", value: data.fbPct, fmt: (v) => `${v}%` },
    { key: "ldPct", label: "LD%", value: data.ldPct, fmt: (v) => `${v}%` },
    { key: "xBA", label: "xBA", value: data.xBA, fmt: (v) => formatAvg(v) },
    { key: "xSLG", label: "xSLG", value: data.xSLG, fmt: (v) => formatAvg(v) },
    { key: "xwOBA", label: "xwOBA", value: data.xwOBA, fmt: (v) => formatAvg(v) },
  ];

  return (
    <div className="stat-section">
      <h3 className="stat-section-title">Statcast Metrics</h3>
      <div className="stat-grid">
        {stats.map(({ key, label, value, fmt }) => {
          const pct = getPercentile(key, value);
          const color = percentileColor(pct);
          return (
            <div key={key} className="stat-cell stat-percentile" style={color ? { borderColor: color } : undefined}>
              <span className="stat-label">{label}</span>
              <span className="stat-value" style={color ? { color } : undefined}>
                {value != null ? fmt(value) : "—"}
              </span>
              {pct != null && (
                <span className="stat-pct-bar">
                  <span className="stat-pct-fill" style={{ width: `${pct * 100}%`, backgroundColor: color }} />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
