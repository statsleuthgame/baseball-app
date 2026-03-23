import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchTodayGame, fetchRoster } from "../../api/client";
import { formatGameDate, formatGameTime } from "../../utils/formatters";
import LoadingSpinner from "../common/LoadingSpinner";
import BatterVsPitcher from "./BatterVsPitcher";
import PitchArsenal from "../player/PitchArsenal";
import WinProbability from "./WinProbability";
import ParkHistory from "./ParkHistory";
import PriorMatchups from "./PriorMatchups";

export default function MatchupView() {
  const { teamId } = useTeam();
  const navigate = useNavigate();

  const { data: gameData, isLoading } = useQuery({
    queryKey: ["todayGame", teamId],
    queryFn: () => fetchTodayGame(teamId),
    enabled: !!teamId,
    staleTime: 1000 * 60 * 5,
  });

  const { data: roster } = useQuery({
    queryKey: ["roster", teamId],
    queryFn: () => fetchRoster(teamId),
    enabled: !!teamId,
    staleTime: 1000 * 60 * 60,
  });

  if (isLoading) return <LoadingSpinner text="Loading matchup..." />;

  if (!gameData || gameData.noGame) {
    return (
      <div className="matchup-empty">
        <h2>No Upcoming Games</h2>
        <p>No games scheduled in the next 14 days.</p>
        <button className="btn-retry" onClick={() => navigate(`/team/${teamId}/schedule`)}>
          View Schedule
        </button>
      </div>
    );
  }

  // Use the next game for matchup analysis when today's game is final
  const isTodayFinal = gameData.status === "Final";
  const game = (isTodayFinal && gameData.nextGame) ? gameData.nextGame : gameData;
  const isPreview = game.isNextGame;

  const isHome = game.home.id === teamId;
  const opponent = isHome ? game.away : game.home;
  const us = isHome ? game.home : game.away;
  const opponentPitcher = opponent.probablePitcher;

  const batters = (roster || []).filter((p) => p.position.type !== "Pitcher");

  return (
    <div className="matchup-view">
      {/* Game header */}
      <div className="matchup-header">
        <div className="matchup-team">
          <img src={us.logoUrl} alt={us.abbreviation} className="matchup-logo" />
          <span>{us.abbreviation}</span>
        </div>
        <div className="matchup-header-center">
          <span className="matchup-vs">{isHome ? "vs" : "@"}</span>
          {isPreview && (
            <span className="matchup-date">{formatGameDate(game.gameDate)} · {formatGameTime(game.gameDate)}</span>
          )}
        </div>
        <div className="matchup-team">
          <img src={opponent.logoUrl} alt={opponent.abbreviation} className="matchup-logo" />
          <span>{opponent.abbreviation}</span>
        </div>
      </div>

      {/* Win probability chart (shows during/after live games) */}
      {game.gamePk && (game.status === "In Progress" || game.status === "Final") && (
        <WinProbability gamePk={game.gamePk} teamId={teamId} isHome={isHome} />
      )}

      {isPreview && (
        <div className="matchup-notice" style={{ color: "var(--team-accent)", fontStyle: "normal", fontWeight: 600 }}>
          Next Game Preview
        </div>
      )}

      {!opponentPitcher && (
        <div className="matchup-notice">
          Opposing starter not yet announced. Check back closer to game time.
        </div>
      )}

      {/* Opposing pitcher's arsenal */}
      {opponentPitcher && (
        <div className="matchup-section">
          <h3>{opponentPitcher.fullName}'s Arsenal</h3>
          <PitchArsenal playerId={opponentPitcher.id} embedded />
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
