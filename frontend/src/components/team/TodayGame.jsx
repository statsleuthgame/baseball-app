import { useQuery } from "@tanstack/react-query";
import { useTeam } from "../../context/TeamContext";
import { fetchTodayGame } from "../../api/client";
import { formatGameTime } from "../../utils/formatters";
import PlayerPhoto from "../common/PlayerPhoto";

export default function TodayGame() {
  const { teamId } = useTeam();

  const { data: game, isLoading } = useQuery({
    queryKey: ["todayGame", teamId],
    queryFn: () => fetchTodayGame(teamId),
    enabled: !!teamId,
    staleTime: 1000 * 60 * 5,
  });

  if (isLoading) {
    return <div className="today-game-card skeleton" />;
  }

  if (!game || game.noGame) {
    return (
      <div className="today-game-card no-game">
        <p>No game scheduled today</p>
      </div>
    );
  }

  const isHome = game.home.id === teamId;
  const opponent = isHome ? game.away : game.home;
  const us = isHome ? game.home : game.away;
  const isLive = game.status === "In Progress";
  const isFinal = game.status === "Final";

  return (
    <div className={`today-game-card ${isLive ? "live" : ""}`}>
      <div className="today-game-header">
        <span className="today-game-label">
          {isLive ? "LIVE" : isFinal ? "FINAL" : "TODAY"}
        </span>
        {!isFinal && !isLive && (
          <span className="today-game-time">{formatGameTime(game.gameDate)}</span>
        )}
      </div>

      <div className="today-game-matchup">
        <div className="today-game-team">
          <img
            src={us.logoUrl}
            alt={us.name}
            className="today-game-logo"
          />
          <span className="today-game-abbr">{us.abbreviation}</span>
          {(isLive || isFinal) && (
            <span className="today-game-score">{us.score}</span>
          )}
        </div>

        <span className="today-game-vs">{isHome ? "vs" : "@"}</span>

        <div className="today-game-team">
          <img
            src={opponent.logoUrl}
            alt={opponent.name}
            className="today-game-logo"
          />
          <span className="today-game-abbr">{opponent.abbreviation}</span>
          {(isLive || isFinal) && (
            <span className="today-game-score">{opponent.score}</span>
          )}
        </div>
      </div>

      {(us.probablePitcher || opponent.probablePitcher) && (
        <div className="today-game-pitchers">
          <div className="today-game-pitcher">
            {us.probablePitcher && (
              <>
                <PlayerPhoto
                  playerId={us.probablePitcher.id}
                  name={us.probablePitcher.fullName}
                  size={36}
                />
                <span>{us.probablePitcher.fullName}</span>
              </>
            )}
          </div>
          <span className="pitcher-vs">vs</span>
          <div className="today-game-pitcher">
            {opponent.probablePitcher && (
              <>
                <PlayerPhoto
                  playerId={opponent.probablePitcher.id}
                  name={opponent.probablePitcher.fullName}
                  size={36}
                />
                <span>{opponent.probablePitcher.fullName}</span>
              </>
            )}
          </div>
        </div>
      )}

      <div className="today-game-venue">{game.venue.name}</div>
    </div>
  );
}
