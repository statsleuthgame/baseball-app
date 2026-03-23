import { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTeam } from "../../context/TeamContext";
import { fetchRoster, fetchSprayChart, fetchVenues } from "../../api/client";
import BallparkSVG from "./BallparkSVG";
import HitDots from "./HitDots";
import SprayLegend from "./SprayLegend";
import SpraySidebar from "./SpraySidebar";
import LoadingSpinner from "../common/LoadingSpinner";
import ErrorMessage from "../common/ErrorMessage";

const ALL_RESULTS = ["single", "double", "triple", "home_run", "out"];
const TEAM_HOME_PARK = { 136: "SEA", 144: "ATL" };

export default function SprayChart() {
  const { teamId } = useTeam();
  const [searchParams] = useSearchParams();
  const initialPlayer = searchParams.get("player");

  const [selectedPlayer, setSelectedPlayer] = useState(initialPlayer || "");
  const [selectedPark, setSelectedPark] = useState(TEAM_HOME_PARK[teamId] || "SEA");
  const [season, setSeason] = useState("");
  const [filters, setFilters] = useState(null);

  const { data: venues } = useQuery({
    queryKey: ["venues"],
    queryFn: fetchVenues,
    staleTime: Infinity,
  });

  const { data: roster } = useQuery({
    queryKey: ["roster", teamId],
    queryFn: () => fetchRoster(teamId),
    enabled: !!teamId,
    staleTime: 1000 * 60 * 60,
  });

  const positionPlayers = useMemo(
    () => (roster || []).filter((p) => p.position.type !== "Pitcher"),
    [roster]
  );

  const currentVenue = useMemo(
    () => (venues || []).find((v) => v.abbr === selectedPark),
    [venues, selectedPark]
  );

  // Fetch ALL career spray data for this player at this park
  const { data: sprayData, isLoading, error, refetch } = useQuery({
    queryKey: ["sprayChart", selectedPlayer, selectedPark],
    queryFn: () => fetchSprayChart(selectedPlayer, selectedPark),
    enabled: !!selectedPlayer,
    staleTime: 1000 * 60 * 60,
  });

  // Filter hits by selected year client-side
  const filteredData = useMemo(() => {
    if (!sprayData?.hits) return null;

    let hits = sprayData.hits;
    if (season) {
      hits = hits.filter((h) => h.date && h.date.startsWith(season));
    }

    // Recompute summary for filtered hits
    const summary = { single: 0, double: 0, triple: 0, home_run: 0, out: 0, total: 0 };
    for (const h of hits) {
      summary[h.result] = (summary[h.result] || 0) + 1;
      summary.total += 1;
    }

    // Find longest home run
    const homeRuns = hits.filter((h) => h.result === "home_run" && h.hitDistance);
    const longestHR = homeRuns.length
      ? homeRuns.reduce((best, h) => (h.hitDistance > best.hitDistance ? h : best), homeRuns[0])
      : null;

    return { hits, summary, longestHR };
  }, [sprayData, season]);

  const handleToggleFilter = (type) => {
    if (!filters) {
      setFilters([type]);
    } else if (filters.includes(type)) {
      const next = filters.filter((f) => f !== type);
      setFilters(next.length === 0 ? null : next);
    } else {
      const next = [...filters, type];
      setFilters(next.length === ALL_RESULTS.length ? null : next);
    }
  };

  const currentYear = new Date().getFullYear();
  const seasons = Array.from({ length: 6 }, (_, i) => currentYear - i);

  return (
    <div className="spray-chart-page">
      <h2 className="spray-page-title">Spray Chart</h2>

      <div className="spray-controls">
        <select
          className="spray-select"
          value={selectedPlayer}
          onChange={(e) => setSelectedPlayer(e.target.value)}
          aria-label="Select player"
        >
          <option value="">Select a player...</option>
          {positionPlayers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName} ({p.position.abbreviation})
            </option>
          ))}
        </select>

        <div className="spray-control-row">
          <select
            className="spray-select-sm"
            value={selectedPark}
            onChange={(e) => setSelectedPark(e.target.value)}
            aria-label="Select ballpark"
          >
            {(venues || [])
              .slice()
              .sort((a, b) => (a.team || "").localeCompare(b.team || ""))
              .map((v) => (
              <option key={v.abbr} value={v.abbr}>
                {v.team ? `${v.team} - ${v.name}` : v.name}
              </option>
            ))}
          </select>

          <select
            className="spray-select-sm"
            value={season}
            onChange={(e) => setSeason(e.target.value)}
            aria-label="Select season"
          >
            <option value="">All Years</option>
            {seasons.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {!selectedPlayer && (
        <p className="spray-prompt">Choose a player above to see their spray chart.</p>
      )}

      {selectedPlayer && isLoading && <LoadingSpinner text="Loading Statcast data..." />}
      {selectedPlayer && error && <ErrorMessage message="Failed to load spray data." onRetry={refetch} />}

      {selectedPlayer && filteredData && (
        <>
          <SprayLegend filters={filters} onToggle={handleToggleFilter} />

          <div className="spray-chart-container">
            <BallparkSVG
              dimensions={currentVenue?.dimensions}
              parkName={currentVenue?.name}
            >
              <HitDots hits={filteredData.hits} filters={filters} longestHR={filteredData.longestHR} />
            </BallparkSVG>
          </div>

          {filteredData.longestHR && (() => {
            const hr = filteredData.longestHR;
            const dateParts = (hr.date || "").split(" ")[0].split("-");
            const formattedDate = dateParts.length === 3
              ? `${dateParts[1]}/${dateParts[2]}/${dateParts[0]}`
              : hr.date || "";
            // pitcherName is "First Last" from MLB API lookup
            const pitcher = hr.pitcherName
              ? (hr.pitcherName.includes(", ") ? hr.pitcherName.split(", ").reverse().join(" ") : hr.pitcherName)
              : "";
            return (
              <div className="longest-hr-card">
                <span className="longest-hr-star">&#9733;</span>
                <div className="longest-hr-info">
                  <span className="longest-hr-title">Longest Home Run</span>
                  <span className="longest-hr-detail">
                    {hr.hitDistance} ft
                    {hr.exitVelo ? ` · ${hr.exitVelo} mph` : ""}
                    {hr.launchAngle ? ` · ${hr.launchAngle}°` : ""}
                  </span>
                  <span className="longest-hr-date">
                    {formattedDate}
                    {hr.opponent ? ` vs ${hr.opponent}` : ""}
                    {pitcher ? ` · off ${pitcher}` : ""}
                  </span>
                </div>
              </div>
            );
          })()}

          {filteredData.hits.length === 0 && (
            <p className="spray-empty">No batted ball data found for these filters.</p>
          )}

          <SpraySidebar summary={filteredData.summary} />
        </>
      )}
    </div>
  );
}
