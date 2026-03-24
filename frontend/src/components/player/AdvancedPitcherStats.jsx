import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPlayerArsenal } from "../../api/client";
import LoadingSpinner from "../common/LoadingSpinner";

// Pitcher-specific percentile thresholds
const STAT_CONFIG = {
  kRate:        { min: 15, max: 35, higher: true },
  bbRate:       { min: 4, max: 12, higher: false },
  whiffRate:    { min: 20, max: 35, higher: true },
  cswRate:      { min: 25, max: 35, higher: true },
  avgVelo:      { min: 89, max: 97, higher: true },
  maxVelo:      { min: 93, max: 101, higher: true },
  chaseRate:    { min: 25, max: 38, higher: true },
  baAgainst:    { min: .200, max: .280, higher: false },
  pitchCount:   { min: 3, max: 6, higher: true },
  topWhiff:     { min: 25, max: 45, higher: true },
};

const STAT_EXPLANATIONS = {
  kRate: "K% — Strikeout rate. % of batters faced who strike out",
  bbRate: "BB% — Walk rate. % of batters faced who walk. Lower = better control",
  whiffRate: "Whiff% — % of swings that miss across all pitches",
  cswRate: "CSW% — Called strikes + whiffs / total pitches. Measures deception",
  avgVelo: "Avg Velo — Average fastball velocity in mph",
  maxVelo: "Max Velo — Top fastball velocity in mph",
  chaseRate: "Chase% — % of pitches outside zone that batters swing at",
  baAgainst: "BA Against — Batting average against across all pitches",
  pitchCount: "Arsenal — Number of distinct pitch types thrown",
  topWhiff: "Best Whiff — Highest whiff rate among all pitch types",
};

function getPercentile(key, rawValue) {
  const config = STAT_CONFIG[key];
  if (!config || rawValue == null) return null;
  const { min, max, higher } = config;
  let pct = (rawValue - min) / (max - min);
  pct = Math.max(0, Math.min(1, pct));
  if (!higher) pct = 1 - pct;
  return pct;
}

function percentileColor(pct) {
  if (pct == null) return undefined;
  if (pct <= 0.5) {
    const t = pct / 0.5;
    const r = Math.round(60 + t * 195);
    const g = Math.round(120 + t * 135);
    const b = Math.round(240 + t * 15);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    const t = (pct - 0.5) / 0.5;
    const r = 255;
    const g = Math.round(255 - t * 195);
    const b = Math.round(255 - t * 205);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

export default function AdvancedPitcherStats({ playerId }) {
  const [selected, setSelected] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["arsenal", playerId],
    queryFn: () => fetchPlayerArsenal(playerId),
    enabled: !!playerId,
    staleTime: 1000 * 60 * 60,
  });

  if (isLoading) return <LoadingSpinner text="Loading Statcast metrics..." />;
  if (!data?.pitches?.length) return null;

  const pitches = data.pitches;
  const totalPitches = data.totalPitches || pitches.reduce((s, p) => s + (p.count || 0), 0);

  // Derive pitcher metrics from arsenal data
  const fastballs = pitches.filter((p) => ["FF", "SI", "FC"].includes(p.pitchType));
  const avgFBVelo = fastballs.length
    ? Math.round(fastballs.reduce((s, p) => s + (p.avgVelo || 0) * (p.count || 1), 0) / fastballs.reduce((s, p) => s + (p.count || 1), 0) * 10) / 10
    : null;
  const maxFBVelo = fastballs.length
    ? Math.max(...fastballs.map((p) => p.avgVelo || 0)) + 2 // approximate max from avg
    : null;

  const overallWhiff = pitches.reduce((s, p) => s + (p.whiffRate || 0) * (p.usagePct || 0), 0) / 100;
  const overallBA = pitches.filter(p => p.baAgainst != null).reduce((s, p) => s + p.baAgainst * (p.usagePct || 0), 0) / pitches.filter(p => p.baAgainst != null).reduce((s, p) => s + (p.usagePct || 0), 0) || null;
  const overallCSW = pitches.reduce((s, p) => s + (p.cswPct || 0) * (p.usagePct || 0), 0) / 100;
  const topWhiffPitch = pitches.reduce((best, p) => (p.whiffRate || 0) > (best.whiffRate || 0) ? p : best, pitches[0]);
  const chaseRateAvg = pitches.reduce((s, p) => s + (p.chaseRate || 0) * (p.usagePct || 0), 0) / 100;

  // Estimate K% and BB% from arsenal (approximate from put-away and walk rates)
  // These are rough estimates from the pitch data
  const kRate = topWhiffPitch.putawayRate || (overallWhiff * 1.5) || null;
  const bbRate = null; // Can't derive accurately from arsenal alone

  const stats = [
    { key: "avgVelo", label: "Avg FB Velo", value: avgFBVelo, fmt: (v) => `${v}` },
    { key: "maxVelo", label: "Max FB Velo", value: maxFBVelo, fmt: (v) => `${v}` },
    { key: "whiffRate", label: "Whiff%", value: overallWhiff ? Math.round(overallWhiff * 10) / 10 : null, fmt: (v) => `${v}%` },
    { key: "topWhiff", label: "Best Whiff", value: topWhiffPitch.whiffRate, fmt: (v) => `${v}%` },
    { key: "baAgainst", label: "BA Against", value: overallBA ? Math.round(overallBA * 1000) / 1000 : null, fmt: (v) => v.toFixed(3).replace(/^0/, "") },
    { key: "pitchCount", label: "Arsenal", value: pitches.length, fmt: (v) => `${v} pitches` },
  ];

  const selectedColor = selected ? percentileColor(getPercentile(selected, stats.find(s => s.key === selected)?.value)) : null;

  return (
    <div className="stat-section">
      <h3 className="stat-section-title">Statcast Metrics</h3>
      <div className="stat-grid">
        {stats.map(({ key, label, value, fmt }) => {
          const pct = getPercentile(key, value);
          const color = percentileColor(pct);
          const isSelected = selected === key;
          return (
            <div
              key={key}
              className={`stat-cell stat-percentile ${isSelected ? "stat-selected" : ""}`}
              style={color ? { borderColor: color } : undefined}
              onClick={() => setSelected(isSelected ? null : key)}
            >
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

      <div className={`stat-explain-footer ${selected ? "visible" : ""}`} style={selectedColor ? { borderLeftColor: selectedColor } : undefined}>
        {selected ? STAT_EXPLANATIONS[selected] : ""}
      </div>
    </div>
  );
}
