import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPlayerAdvanced } from "../../api/client";
import { formatAvg } from "../../utils/formatters";
import LoadingSpinner from "../common/LoadingSpinner";

const STAT_CONFIG = {
  avgExitVelo:    { min: 82, max: 94, higher: true },
  maxExitVelo:    { min: 102, max: 118, higher: true },
  hardHitPct:     { min: 25, max: 55, higher: true },
  barrelPct:      { min: 3, max: 18, higher: true },
  avgLaunchAngle: { min: 5, max: 20, higher: true },
  whiffRate:      { min: 15, max: 35, higher: false },
  chaseRate:      { min: 20, max: 38, higher: false },
  gbPct:          { min: 30, max: 55, higher: false },
  fbPct:          { min: 25, max: 50, higher: true },
  ldPct:          { min: 15, max: 30, higher: true },
  xBA:            { min: .220, max: .310, higher: true },
  xSLG:           { min: .320, max: .550, higher: true },
  xwOBA:          { min: .280, max: .400, higher: true },
};

const STAT_EXPLANATIONS = {
  avgExitVelo: "Avg Exit Velo — How hard they hit the ball on average (mph)",
  maxExitVelo: "Max Exit Velo — Hardest ball hit this season (mph)",
  hardHitPct: "Hard Hit% — % of balls hit 95+ mph. Elite power indicator",
  barrelPct: "Barrel% — % of batted balls with ideal exit velo + launch angle",
  avgLaunchAngle: "Avg Launch Angle — Average angle the ball leaves the bat",
  whiffRate: "Whiff% — % of swings that miss. Lower = better contact",
  chaseRate: "Chase% — % of pitches outside zone they swing at. Lower = better eye",
  gbPct: "GB% — % of batted balls on the ground",
  fbPct: "FB% — % of batted balls in the air",
  ldPct: "LD% — % of line drives. Highest BA of any batted ball type",
  xBA: "xBA — Expected batting avg based on exit velo + launch angle",
  xSLG: "xSLG — Expected slugging based on quality of contact",
  xwOBA: "xwOBA — Expected weighted on-base avg. Best overall contact metric",
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
  // Blue (0%) → White (50%) → Red (100%)
  if (pct <= 0.5) {
    const t = pct / 0.5; // 0 to 1
    const r = Math.round(60 + t * 195);   // 60 → 255
    const g = Math.round(120 + t * 135);   // 120 → 255
    const b = Math.round(240 + t * 15);    // 240 → 255
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    const t = (pct - 0.5) / 0.5; // 0 to 1
    const r = Math.round(255);              // 255 → 255
    const g = Math.round(255 - t * 195);    // 255 → 60
    const b = Math.round(255 - t * 205);    // 255 → 50
    return `rgb(${r}, ${g}, ${b})`;
  }
}

const FG_STAT_CONFIG = {
  war:      { min: -1, max: 7, higher: true },
  wrcPlus:  { min: 60, max: 160, higher: true },
  woba:     { min: .270, max: .400, higher: true },
  iso:      { min: .080, max: .250, higher: true },
  kPct:     { min: 10, max: 32, higher: false },
  bbPct:    { min: 4, max: 14, higher: true },
  kBbPct:   { min: -5, max: 20, higher: false },
  babip:    { min: .250, max: .360, higher: true },
  oSwingPct:{ min: 20, max: 40, higher: false },
};

const FG_STAT_EXPLANATIONS = {
  war:      "WAR — Wins Above Replacement. Total value above a replacement-level player",
  wrcPlus:  "wRC+ — Weighted Runs Created Plus. 100 = league avg, 120 = 20% above average",
  woba:     "wOBA — Weighted On-Base Average. Best single offensive rate stat",
  iso:      "ISO — Isolated Power (SLG - AVG). Pure extra-base hit power metric",
  kPct:     "K% — Strikeout rate. Lower is better for contact quality",
  bbPct:    "BB% — Walk rate. Higher = better plate discipline",
  kBbPct:   "K-BB% — Strikeout minus walk rate. Lower = better overall plate discipline",
  babip:    "BABIP — Batting avg on balls in play. Indicates luck or batted ball quality",
  oSwingPct:"O-Swing% — % of pitches outside zone that the batter swings at",
};

export default function AdvancedBatterStats({ playerId }) {
  const [selected, setSelected] = useState(null);
  const [fgSelected, setFgSelected] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["advanced", playerId],
    queryFn: () => fetchPlayerAdvanced(playerId),
    enabled: !!playerId,
    staleTime: 1000 * 60 * 60,
  });

  if (isLoading) return <LoadingSpinner text="Loading advanced stats..." />;
  if (!data || Object.keys(data).length === 0) return null;

  const stats = useMemo(() => [
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
  ], [data]);

  const fgStats = useMemo(() => [
    { key: "war",       label: "WAR",     value: data.war,       fmt: (v) => `${v}` },
    { key: "wrcPlus",   label: "wRC+",    value: data.wrcPlus,   fmt: (v) => `${Math.round(v)}` },
    { key: "woba",      label: "wOBA",    value: data.woba,      fmt: (v) => formatAvg(v) },
    { key: "iso",       label: "ISO",     value: data.iso,       fmt: (v) => formatAvg(v) },
    { key: "babip",     label: "BABIP",   value: data.babip,     fmt: (v) => formatAvg(v) },
    { key: "kPct",      label: "K%",      value: data.kPct,      fmt: (v) => `${v}%` },
    { key: "bbPct",     label: "BB%",     value: data.bbPct,     fmt: (v) => `${v}%` },
    { key: "kBbPct",    label: "K-BB%",   value: data.kBbPct,    fmt: (v) => `${v}%` },
    { key: "oSwingPct", label: "O-Swing%",value: data.oSwingPct, fmt: (v) => `${v}%` },
  ].filter(s => s.value != null), [data]);

  const hasFgStats = fgStats.length > 0;

  const selectedColor = selected ? percentileColor(getPercentile(selected, data[selected])) : null;

  const getFgPct = (key, val) => {
    const cfg = FG_STAT_CONFIG[key];
    if (!cfg || val == null) return null;
    const { min, max, higher } = cfg;
    let p = (val - min) / (max - min);
    p = Math.max(0, Math.min(1, p));
    return higher ? p : 1 - p;
  };

  const fgSelectedColor = fgSelected ? percentileColor(getFgPct(fgSelected, data[fgSelected])) : null;

  return (
    <>
      <div className="stat-section">
        <h3 className="stat-section-title">Statcast Metrics</h3>
        <div className="stat-grid">
          {stats.map(({ key, label, value, fmt }) => {
            const pct = getPercentile(key, value);
            const color = percentileColor(pct);
            const isSelected = selected === key;
            return (
              <button
                type="button"
                key={key}
                className={`stat-cell stat-percentile ${isSelected ? "stat-selected" : ""}`}
                style={color ? { borderColor: color } : undefined}
                onClick={() => setSelected(isSelected ? null : key)}
                aria-pressed={isSelected}
                aria-label={`${label}: ${value != null ? fmt(value) : 'no data'}${pct != null ? `, ${ordinal(Math.round(pct * 100))} percentile` : ''}`}
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
        <div className={`stat-explain-footer ${selected ? "visible" : ""}`} role="status" aria-live="polite" style={selectedColor ? { borderLeftColor: selectedColor } : undefined}>
          {selected ? STAT_EXPLANATIONS[selected] : ""}
        </div>
      </div>

      {hasFgStats && (
        <div className="stat-section">
          <h3 className="stat-section-title">FanGraphs Season Stats</h3>
          <div className="stat-grid">
            {fgStats.map(({ key, label, value, fmt }) => {
              const pct = getFgPct(key, value);
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
                  aria-label={`${label}: ${value != null ? fmt(value) : 'no data'}`}
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
          <div className={`stat-explain-footer ${fgSelected ? "visible" : ""}`} role="status" aria-live="polite" style={fgSelectedColor ? { borderLeftColor: fgSelectedColor } : undefined}>
            {fgSelected ? FG_STAT_EXPLANATIONS[fgSelected] : ""}
          </div>
        </div>
      )}
    </>
  );
}
