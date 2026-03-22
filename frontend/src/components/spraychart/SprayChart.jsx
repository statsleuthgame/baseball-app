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

// Default park for each team
const TEAM_HOME_PARK = { 136: "SEA", 144: "ATL" };

export default function SprayChart() {
  const { teamId, team } = useTeam();
  const [searchParams] = useSearchParams();
  const initialPlayer = searchParams.get("player");

  const [selectedPlayer, setSelectedPlayer] = useState(initialPlayer || "");
  const [selectedPark, setSelectedPark] = useState(TEAM_HOME_PARK[teamId] || "SEA");
  const [season, setSeason] = useState("");
  const [filters, setFilters] = useState(null);

  // Fetch venue list
  const { data: venues } = useQuery({
    queryKey: ["venues"],
    queryFn: fetchVenues,
    staleTime: Infinity,
  });

  // Fetch roster for player selector
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

  // Get current park info
  const currentVenue = useMemo(
    () => (venues || []).find((v) => v.abbr === selectedPark),
    [venues, selectedPark]
  );

  // Fetch spray chart data filtered by park
  const {
    data: sprayData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["sprayChart", selectedPlayer, selectedPark, season],
    queryFn: () => fetchSprayChart(selectedPlayer, selectedPark, season || undefined),
    enabled: !!selectedPlayer,
    staleTime: 1000 * 60 * 60,
  });

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
  const seasons = Array.from({ length: 10 }, (_, i) => currentYear - i);

  return (
    <div className="spray-chart-page">
      <h2 className="spray-page-title">Spray Chart</h2>

      {/* Controls */}
      <div className="spray-controls">
        <select
          className="spray-select"
          value={selectedPlayer}
          onChange={(e) => setSelectedPlayer(e.target.value)}
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
          >
            {(venues || []).map((v) => (
              <option key={v.abbr} value={v.abbr}>
                {v.name}
              </option>
            ))}
          </select>

          <select
            className="spray-select-sm"
            value={season}
            onChange={(e) => setSeason(e.target.value)}
          >
            <option value="">Career</option>
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

      {selectedPlayer && sprayData && (
        <>
          <SprayLegend filters={filters} onToggle={handleToggleFilter} />

          <div className="spray-chart-container">
            <BallparkSVG
              dimensions={currentVenue?.dimensions}
              parkName={currentVenue?.name}
            >
              <HitDots hits={sprayData.hits} filters={filters} />
            </BallparkSVG>
          </div>

          <SpraySidebar summary={sprayData.summary} />
        </>
      )}
    </div>
  );
}
