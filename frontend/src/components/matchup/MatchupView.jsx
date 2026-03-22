import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTeam } from "../../context/TeamContext";
import { fetchTodayGame, fetchRoster } from "../../api/client";
import LoadingSpinner from "../common/LoadingSpinner";
import BatterVsPitcher from "./BatterVsPitcher";
import PitchTypeMatchup from "./PitchTypeMatchup";
import ParkHistory from "./ParkHistory";
import PriorMatchups from "./PriorMatchups";

export default function MatchupView() {
  const { teamId, team } = useTeam();
  const [selectedBatter, setSelectedBatter] = useState(null);

  const { data: game, isLoading } = useQuery({
    queryKey: ["todayGame", teamId],
    queryFn: () => fetchTodayGame(teamId),
    enabled: !!teamId,
    staleTime: 1000 * 60 * 5,
  });

  // Fetch our roster for lineup (using full roster as fallback since lineups aren't always posted)
  const { data: roster } = useQuery({
    queryKey: ["roster", teamId],
    queryFn: () => fetchRoster(teamId),
    enabled: !!teamId,
    staleTime: 1000 * 60 * 60,
  });

  if (isLoading) return <LoadingSpinner text="Loading matchup..." />;

  if (!game || game.noGame) {
    return (
      <div className="matchup-empty">
        <h2>No Game Today</h2>
        <p>Check the schedule for upcoming games.</p>
      </div>
    );
  }

  const isHome = game.home.id === teamId;
  const opponent = isHome ? game.away : game.home;
  const us = isHome ? game.home : game.away;
  const opponentPitcher = opponent.probablePitcher;

  // Position players from our roster
  const batters = (roster || []).filter((p) => p.position.type !== "Pitcher");

  return (
    <div className="matchup-view">
      {/* Game header */}
      <div className="matchup-header">
        <div className="matchup-team">
          <img src={us.logoUrl} alt={us.abbreviation} className="matchup-logo" />
          <span>{us.abbreviation}</span>
        </div>
        <span className="matchup-vs">{isHome ? "vs" : "@"}</span>
        <div className="matchup-team">
          <img src={opponent.logoUrl} alt={opponent.abbreviation} className="matchup-logo" />
          <span>{opponent.abbreviation}</span>
        </div>
      </div>

      {/* Probable pitcher info */}
      {!opponentPitcher && (
        <div className="matchup-notice">
          Opposing starter not yet announced. Check back closer to game time.
        </div>
      )}

      {/* Batter vs Pitcher lineup breakdown */}
      {opponentPitcher && batters.length > 0 && (
        <BatterVsPitcher
          batters={batters}
          pitcherId={opponentPitcher.id}
          pitcherName={opponentPitcher.fullName}
        />
      )}

      {/* Individual pitch-type matchup (select a batter) */}
      {opponentPitcher && batters.length > 0 && (
        <div className="matchup-section">
          <h3>Pitch Arsenal Matchup</h3>
          <select
            className="spray-select"
            value={selectedBatter || ""}
            onChange={(e) => setSelectedBatter(e.target.value || null)}
          >
            <option value="">Select a batter to see pitch breakdown...</option>
            {batters.map((b) => (
              <option key={b.id} value={b.id}>
                {b.fullName} ({b.position.abbreviation})
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedBatter && opponentPitcher && (
        <PitchTypeMatchup
          batterId={Number(selectedBatter)}
          pitcherId={opponentPitcher.id}
          batterName={batters.find((b) => b.id === Number(selectedBatter))?.fullName}
        />
      )}

      {/* Park history */}
      <ParkHistory
        teamId={teamId}
        venueId={game.venue.id}
        venueName={game.venue.name}
      />

      {/* Prior matchups this season */}
      <PriorMatchups
        team1Id={teamId}
        team2Id={opponent.id}
        team1Abbr={us.abbreviation}
        team2Abbr={opponent.abbreviation}
      />
    </div>
  );
}
