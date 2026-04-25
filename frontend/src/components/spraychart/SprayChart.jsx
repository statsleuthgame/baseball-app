import { useState, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTeam } from "../../context/TeamContext";
import { fetchRoster, fetchSprayChart, fetchVenues } from "../../api/client";
import ALL_TEAMS from "../../data/teams";
import BallparkSVG from "./BallparkSVG";
import HitDots, { RESULT_COLORS } from "./HitDots";
import SprayLegend from "./SprayLegend";
import SpraySidebar from "./SpraySidebar";
import LoadingSpinner from "../common/LoadingSpinner";
import ErrorMessage from "../common/ErrorMessage";

const ALL_RESULTS = ["single", "double", "triple", "home_run", "out"];
const TEAM_HOME_PARK = {
  109: "ARI", 144: "ATL", 110: "BAL", 111: "BOS", 112: "CHC", 145: "CWS",
  113: "CIN", 114: "CLE", 115: "COL", 116: "DET", 117: "HOU", 118: "KC",
  108: "LAA", 119: "LAD", 146: "MIA", 158: "MIL", 142: "MIN", 121: "NYM",
  147: "NYY", 133: "ATH", 143: "PHI", 134: "PIT", 135: "SD", 137: "SF",
  136: "SEA", 138: "STL", 139: "TB", 140: "TEX", 141: "TOR", 120: "WSH",
};

const RESULT_LABELS = {
  single: "Single",
  double: "Double",
  triple: "Triple",
  home_run: "Home Run",
  out: "Out",
};

const teamList = Object.values(ALL_TEAMS).sort((a, b) => a.name.localeCompare(b.name));

export default function SprayChart() {
  const { teamId } = useTeam();
  const [searchParams] = useSearchParams();
  const initialPlayer = searchParams.get("player");
  const initialTeam = searchParams.get("team");

  const [selectedTeamId, setSelectedTeamId] = useState(initialTeam ? Number(initialTeam) : teamId);
  const [selectedPlayer, setSelectedPlayer] = useState(initialPlayer || "");
  const [selectedPark, setSelectedPark] = useState(TEAM_HOME_PARK[initialTeam ? Number(initialTeam) : teamId] || "SEA");
  const [season, setSeason] = useState("");
  const [filters, setFilters] = useState(null);
  const [selectedHit, setSelectedHit] = useState(null);

  const { data: venues } = useQuery({
    queryKey: ["venues"],
    queryFn: fetchVenues,
    staleTime: Infinity,
  });

  const { data: roster } = useQuery({
    queryKey: ["roster", selectedTeamId],
    queryFn: () => fetchRoster(selectedTeamId),
    enabled: !!selectedTeamId,
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

  const handleTeamChange = (newTeamId) => {
    const tid = Number(newTeamId);
    setSelectedTeamId(tid);
    setSelectedPlayer("");
    setSelectedHit(null);
    setSelectedPark(TEAM_HOME_PARK[tid] || selectedPark);
  };

  const handleHitSelect = useCallback((hit) => {
    setSelectedHit(hit);
  }, []);

  const currentYear = new Date().getFullYear();
  const seasons = Array.from({ length: 6 }, (_, i) => currentYear - i);

  // Determine which hit to show in the info card
  const displayHit = selectedHit || filteredData?.longestHR;
  const isLongestHR = displayHit && !selectedHit && filteredData?.longestHR;

  return (
    <div className="spray-chart-page">
      <h1 className="spray-page-title">Spray Chart</h1>

      <div className="spray-controls">
        <div className="spray-control-row">
          <label className="sr-only" htmlFor="spray-team">Select team</label>
          <select
            id="spray-team"
            className="spray-select-sm"
            value={selectedTeamId}
            onChange={(e) => handleTeamChange(e.target.value)}
          >
            {teamList.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        <label className="sr-only" htmlFor="spray-player">Select player</label>
        <select
          id="spray-player"
          className="spray-select"
          value={selectedPlayer}
          onChange={(e) => { setSelectedPlayer(e.target.value); setSelectedHit(null); }}
        >
          <option value="" disabled>Select a player…</option>
          {positionPlayers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName} ({p.position.abbreviation})
            </option>
          ))}
        </select>

        <div className="spray-control-row">
          <label className="sr-only" htmlFor="spray-park">Select ballpark</label>
          <select
            id="spray-park"
            className="spray-select-sm"
            value={selectedPark}
            onChange={(e) => setSelectedPark(e.target.value)}
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

          <label className="sr-only" htmlFor="spray-season">Select season</label>
          <select
            id="spray-season"
            className="spray-select-sm"
            value={season}
            onChange={(e) => setSeason(e.target.value)}
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
              parkAbbr={selectedPark}
              parkName={currentVenue?.name}
              hits={filteredData?.hits}
            >
              <HitDots hits={filteredData.hits} filters={filters} longestHR={filteredData.longestHR} onHitSelect={handleHitSelect} />
            </BallparkSVG>
          </div>

          {displayHit && (() => {
            const hit = displayHit;
            const dateParts = (hit.date || "").split(" ")[0].split("-");
            const formattedDate = dateParts.length === 3
              ? `${dateParts[1]}/${dateParts[2]}/${dateParts[0]}`
              : hit.date || "";
            const pitcher = hit.pitcherName
              ? (hit.pitcherName.includes(", ") ? hit.pitcherName.split(", ").reverse().join(" ") : hit.pitcherName)
              : "";
            const title = isLongestHR ? "Longest Home Run" : (RESULT_LABELS[hit.result] || hit.event || "Hit");
            const hitColor = isLongestHR ? "#F44336" : (RESULT_COLORS[hit.result] || "#616161");
            return (
              <div className="longest-hr-card" style={{ borderColor: hitColor, background: `${hitColor}15` }}>
                {isLongestHR && <span className="longest-hr-star">&#9733;</span>}
                <div className="longest-hr-info">
                  <span className="longest-hr-title" style={{ color: hitColor }}>{title}</span>
                  <span className="longest-hr-detail">
                    {hit.hitDistance ? `${hit.hitDistance} ft` : ""}
                    {hit.exitVelo ? ` · ${hit.exitVelo} mph` : ""}
                    {hit.launchAngle ? ` · ${hit.launchAngle}°` : ""}
                  </span>
                  <span className="longest-hr-date">
                    {formattedDate}
                    {hit.opponent ? ` vs ${hit.opponent}` : ""}
                    {pitcher ? ` · off ${pitcher}` : ""}
                  </span>
                </div>
              </div>
            );
          })()}

          {filteredData.hits.length === 0 && (
            <p className="spray-empty">No batted ball data found for these filters.</p>
          )}

          {filteredData.hits.length > 0 && (
            <details className="spray-data-table">
              <summary>Data table ({filteredData.hits.length} rows)</summary>
              <div className="spray-data-table-scroll">
                <table>
                  <caption className="sr-only">All batted balls in this view</caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Result</th>
                      <th scope="col">Exit velo</th>
                      <th scope="col">Launch°</th>
                      <th scope="col">Distance</th>
                      <th scope="col">Pitcher</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredData.hits.map((h, i) => (
                      <tr key={i}>
                        <td>{h.date?.split(" ")[0] || "—"}</td>
                        <td>{RESULT_LABELS[h.result] || h.event}</td>
                        <td>{h.exitVelo ? `${h.exitVelo}` : "—"}</td>
                        <td>{h.launchAngle != null ? `${h.launchAngle}` : "—"}</td>
                        <td>{h.hitDistance ? `${h.hitDistance}` : "—"}</td>
                        <td>{h.pitcherName || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <SpraySidebar summary={filteredData.summary} />
        </>
      )}
    </div>
  );
}
