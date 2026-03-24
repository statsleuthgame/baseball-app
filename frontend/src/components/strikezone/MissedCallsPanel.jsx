import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMissedCalls } from "../../api/client";
import StrikeZoneSVG from "./StrikeZoneSVG";
import MissedCallDots from "./MissedCallDots";
import MissedCallHeatmap from "./MissedCallHeatmap";

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => String(currentYear - i));

export default function MissedCallsPanel({ playerId }) {
  const [viewMode, setViewMode] = useState("dots");
  const [callFilter, setCallFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["missedCalls", playerId],
    queryFn: () => fetchMissedCalls(playerId),
    enabled: !!playerId,
    staleTime: 1000 * 60 * 60,
  });

  const filtered = useMemo(() => {
    if (!data) return null;
    if (!yearFilter) return data;

    const filterByYear = (pitches) =>
      pitches.filter((p) => p.date && p.date.startsWith(yearFilter));

    const sq = filterByYear(data.squeezed?.pitches || []);
    const gf = filterByYear(data.gifted?.pitches || []);
    const yearData = data.byYear?.[yearFilter] || {};

    return {
      ...data,
      squeezed: { count: sq.length, pitches: sq },
      gifted: { count: gf.length, pitches: gf },
      totalCalled: yearData.called || sq.length + gf.length,
      missedCalls: sq.length + gf.length,
      missedPct: yearData.called > 0
        ? Math.round((sq.length + gf.length) / yearData.called * 1000) / 10
        : 0,
    };
  }, [data, yearFilter]);

  if (isLoading || !filtered) return null;
  if (!filtered.missedCalls) return null;

  const squeezed = filtered.squeezed?.pitches || [];
  const gifted = filtered.gifted?.pitches || [];

  return (
    <div className="missed-calls-section">
      <h3 className="section-title">Umpire Missed Calls</h3>
      <p className="missed-calls-subtitle">
        Incorrect ball/strike calls over the last 5 seasons
      </p>

      <div className="missed-calls-controls">
        <div className="mc-toggle-group">
          <button
            className={`mc-toggle ${viewMode === "dots" ? "mc-toggle-active" : ""}`}
            onClick={() => setViewMode("dots")}
          >
            Dots
          </button>
          <button
            className={`mc-toggle ${viewMode === "heatmap" ? "mc-toggle-active" : ""}`}
            onClick={() => setViewMode("heatmap")}
          >
            Heatmap
          </button>
        </div>

        <div className="mc-toggle-group">
          {[
            ["all", "All"],
            ["squeezed", "Squeezed"],
            ["gifted", "Gifted"],
          ].map(([val, label]) => (
            <button
              key={val}
              className={`mc-toggle ${callFilter === val ? "mc-toggle-active" : ""}`}
              onClick={() => setCallFilter(val)}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          className="mc-year-select"
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
          aria-label="Filter by year"
        >
          <option value="">All Years</option>
          {YEARS.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      <div className="missed-calls-summary">
        <div className="mc-stat">
          <span className="mc-stat-value">{filtered.totalCalled}</span>
          <span className="mc-stat-label">Called Pitches</span>
        </div>
        <div className="mc-stat">
          <span className="mc-stat-value mc-stat-missed">{filtered.missedCalls}</span>
          <span className="mc-stat-label">Missed ({filtered.missedPct}%)</span>
        </div>
        <div className="mc-stat">
          <span className="mc-stat-value" style={{ color: "#ef4444" }}>
            {filtered.squeezed?.count || 0}
          </span>
          <span className="mc-stat-label">Squeezed</span>
        </div>
        <div className="mc-stat">
          <span className="mc-stat-value" style={{ color: "#3b82f6" }}>
            {filtered.gifted?.count || 0}
          </span>
          <span className="mc-stat-label">Gifted</span>
        </div>
      </div>

      <div className="missed-calls-chart">
        <StrikeZoneSVG szTop={filtered.avgSzTop} szBot={filtered.avgSzBot}>
          {viewMode === "dots" ? (
            <MissedCallDots
              squeezed={squeezed}
              gifted={gifted}
              callFilter={callFilter}
            />
          ) : (
            <MissedCallHeatmap
              squeezed={squeezed}
              gifted={gifted}
              callFilter={callFilter}
            />
          )}
        </StrikeZoneSVG>
      </div>

      <div className="missed-calls-legend">
        <span className="mc-legend-item">
          <span className="mc-legend-dot" style={{ background: "#ef4444" }} />
          Squeezed (ball called, pitch in zone)
        </span>
        <span className="mc-legend-item">
          <span className="mc-legend-dot" style={{ background: "#3b82f6" }} />
          Gifted (strike called, pitch outside zone)
        </span>
      </div>
    </div>
  );
}
