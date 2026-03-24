import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPlayerArsenal, fetchPlayerAdvanced } from "../../api/client";
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

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
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

const FG_PITCHER_CONFIG = {
  war:     { min: -1, max: 6, higher: true },
  era:     { min: 2.5, max: 5.5, higher: false },
  fip:     { min: 2.5, max: 5.0, higher: false },
  xfip:    { min: 2.8, max: 5.0, higher: false },
  siera:   { min: 2.8, max: 5.0, higher: false },
  kPct:    { min: 14, max: 32, higher: true },
  bbPct:   { min: 3, max: 12, higher: false },
  kBbPct:  { min: 5, max: 25, higher: true },
  gbPct:   { min: 35, max: 58, higher: true },
  whip:    { min: 0.95, max: 1.55, higher: false },
  swstrPct:{ min: 8, max: 16, higher: true },
};

const FG_PITCHER_EXPLANATIONS = {
  war:     "WAR — Wins Above Replacement. Total value above a replacement-level pitcher",
  era:     "ERA — Earned Run Average. Lower is better",
  fip:     "FIP — Fielding Independent Pitching. ERA-like stat using only K, BB, HR",
  xfip:    "xFIP — Like FIP but normalizes HR rate. Better at predicting future ERA",
  siera:   "SIERA — Skill-Interactive ERA. Most predictive ERA estimator available",
  kPct:    "K% — Strikeout rate per PA. Primary measure of missing bats",
  bbPct:   "BB% — Walk rate per PA. Lower = better command",
  kBbPct:  "K-BB% — Strikeouts minus walks. Best single predictor of pitcher performance",
  gbPct:   "GB% — Ground ball rate. Higher = induces more weak contact on ground",
  whip:    "WHIP — Walks + Hits per Inning Pitched. Lower is better",
  swstrPct:"SwStr% — Swinging strike rate. Measures ability to generate whiffs",
};

function getPitcherFgPct(key, val) {
  const cfg = FG_PITCHER_CONFIG[key];
  if (!cfg || val == null) return null;
  const { min, max, higher } = cfg;
  let p = (val - min) / (max - min);
  p = Math.max(0, Math.min(1, p));
  return higher ? p : 1 - p;
}

export default function AdvancedPitcherStats({ playerId }) {
  const [selected, setSelected] = useState(null);
  const [fgSelected, setFgSelected] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["arsenal", playerId],
    queryFn: () => fetchPlayerArsenal(playerId),
    enabled: !!playerId,
    staleTime: 1000 * 60 * 60,
  });

  const { data: advanced } = useQuery({
    queryKey: ["advanced", playerId],
    queryFn: () => fetchPlayerAdvanced(playerId),
    enabled: !!playerId,
    staleTime: 1000 * 60 * 60,
  });

  if (isLoading) return <LoadingSpinner text="Loading Statcast metrics..." />;
  if (!data?.pitches?.length && (!advanced || Object.keys(advanced || {}).length === 0)) return null;

  const pitches = data?.pitches || [];
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
    { key: "avgVelo", label: "FB Velo", value: avgFBVelo, fmt: (v) => `${v}` },
    { key: "maxVelo", label: "Max Velo", value: maxFBVelo, fmt: (v) => `${v}` },
    { key: "whiffRate", label: "Whiff%", value: overallWhiff ? Math.round(overallWhiff * 10) / 10 : null, fmt: (v) => `${v}%` },
    { key: "topWhiff", label: "Top Whiff", value: topWhiffPitch.whiffRate, fmt: (v) => `${v}%` },
    { key: "baAgainst", label: "BAA", value: overallBA ? Math.round(overallBA * 1000) / 1000 : null, fmt: (v) => v.toFixed(3).replace(/^0/, "") },
    { key: "pitchCount", label: "Pitches", value: pitches.length, fmt: (v) => `${v}` },
  ];

  const selectedColor = selected ? percentileColor(getPercentile(selected, stats.find(s => s.key === selected)?.value)) : null;
  const fgSelectedColor = fgSelected ? percentileColor(getPitcherFgPct(fgSelected, advanced?.[fgSelected])) : null;

  const fgStats = advanced ? [
    { key: "war",     label: "WAR",     value: advanced.war,     fmt: (v) => `${v}` },
    { key: "era",     label: "ERA",     value: advanced.era,     fmt: (v) => v.toFixed(2) },
    { key: "fip",     label: "FIP",     value: advanced.fip,     fmt: (v) => v.toFixed(2) },
    { key: "xfip",   label: "xFIP",    value: advanced.xfip,    fmt: (v) => v.toFixed(2) },
    { key: "siera",  label: "SIERA",   value: advanced.siera,   fmt: (v) => v.toFixed(2) },
    { key: "kPct",   label: "K%",      value: advanced.kPct,    fmt: (v) => `${v}%` },
    { key: "bbPct",  label: "BB%",     value: advanced.bbPct,   fmt: (v) => `${v}%` },
    { key: "kBbPct", label: "K-BB%",   value: advanced.kBbPct,  fmt: (v) => `${v}%` },
    { key: "gbPct",  label: "GB%",     value: advanced.gbPct,   fmt: (v) => `${v}%` },
    { key: "whip",   label: "WHIP",    value: advanced.whip,    fmt: (v) => v.toFixed(2) },
    { key: "swstrPct",label:"SwStr%",  value: advanced.swstrPct,fmt: (v) => `${v}%` },
  ].filter(s => s.value != null) : [];

  const hasFgStats = fgStats.length > 0;
  const regressionAlert = advanced?.regressionAlert;

  return (
    <>
      {pitches.length > 0 && (
        <div className="stat-section">
          <h3 className="stat-section-title">Statcast Metrics</h3>
          <div className="stat-grid stat-grid-3">
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
                    <>
                      <span className="stat-pct-bar" aria-hidden="true">
                        <span className="stat-pct-fill" style={{ width: `${pct * 100}%`, backgroundColor: color }} />
                      </span>
                      <span className="stat-pct-text" style={color ? { color } : undefined}>
                        {ordinal(Math.round(pct * 100))} percentile
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className={`stat-explain-footer ${selected ? "visible" : ""}`} style={selectedColor ? { borderLeftColor: selectedColor } : undefined}>
            {selected ? STAT_EXPLANATIONS[selected] : ""}
          </div>
        </div>
      )}

      {hasFgStats && (
        <div className="stat-section">
          <h3 className="stat-section-title">FanGraphs Season Stats</h3>

          {regressionAlert && (
            <div className="regression-alert">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2L1 21h22L12 2zm0 3.5L20.5 19H3.5L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/>
              </svg>
              {regressionAlert}
            </div>
          )}

          <div className="stat-grid">
            {fgStats.map(({ key, label, value, fmt }) => {
              const pct = getPitcherFgPct(key, value);
              const color = percentileColor(pct);
              const isSelected = fgSelected === key;
              return (
                <button
                  type="button"
                  key={key}
                  className={`stat-cell stat-percentile ${isSelected ? "stat-selected" : ""}`}
                  style={color ? { borderColor: color } : undefined}
                  onClick={() => setFgSelected(isSelected ? null : key)}
                  aria-pressed={isSelected}
                >
                  <span className="stat-label">{label}</span>
                  <span className="stat-value" style={color ? { color } : undefined}>
                    {value != null ? fmt(value) : "—"}
                  </span>
                  {pct != null && (
                    <>
                      <span className="stat-pct-bar" aria-hidden="true">
                        <span className="stat-pct-fill" style={{ width: `${pct * 100}%`, backgroundColor: color }} />
                      </span>
                      <span className="stat-pct-text" style={color ? { color } : undefined}>
                        {ordinal(Math.round(pct * 100))} percentile
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <div className={`stat-explain-footer ${fgSelected ? "visible" : ""}`} style={fgSelectedColor ? { borderLeftColor: fgSelectedColor } : undefined}>
            {fgSelected ? FG_PITCHER_EXPLANATIONS[fgSelected] : ""}
          </div>
        </div>
      )}
    </>
  );
}
