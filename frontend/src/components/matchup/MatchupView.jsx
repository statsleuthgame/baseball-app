import { useQuery } from "@tanstack/react-query";
import { useTeam } from "../../context/TeamContext";
import { fetchTodayGame } from "../../api/client";
import LoadingSpinner from "../common/LoadingSpinner";

export default function MatchupView() {
  const { teamId } = useTeam();

  const { data: game, isLoading } = useQuery({
    queryKey: ["todayGame", teamId],
    queryFn: () => fetchTodayGame(teamId),
    enabled: !!teamId,
    staleTime: 1000 * 60 * 5,
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

  return (
    <div className="matchup-view">
      <div className="matchup-header">
        <div className="matchup-team">
          <img src={us.logoUrl} alt={us.abbreviation} className="matchup-logo" />
          <span>{us.abbreviation}</span>
        </div>
        <span className="matchup-vs">vs</span>
        <div className="matchup-team">
          <img src={opponent.logoUrl} alt={opponent.abbreviation} className="matchup-logo" />
          <span>{opponent.abbreviation}</span>
        </div>
      </div>

      <div className="matchup-sections">
        <div className="matchup-section">
          <h3>Batter vs Pitcher Analysis</h3>
          <p className="coming-soon">Detailed matchup data coming in Phase 5</p>
        </div>
        <div className="matchup-section">
          <h3>Pitch Type Matchups</h3>
          <p className="coming-soon">Arsenal breakdown coming in Phase 5</p>
        </div>
        <div className="matchup-section">
          <h3>Park History</h3>
          <p className="coming-soon">Venue performance coming in Phase 5</p>
        </div>
      </div>
    </div>
  );
}
