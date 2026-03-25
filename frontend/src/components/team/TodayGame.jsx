import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchTodayGame, fetchGameLineup, fetchProjectedLineup } from "../../api/client";
import { formatGameDate, formatGameTime } from "../../utils/formatters";
import PlayerPhoto from "../common/PlayerPhoto";
import UmpireCard from "../common/UmpireCard";

export default function TodayGame() {
  const { teamId } = useTeam();
  const navigate = useNavigate();

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
        <p>No games scheduled</p>
      </div>
    );
  }

  const isLive = game.status === "In Progress";
  const isFinal = game.status === "Final";
  const isNext = game.isNextGame;

  // Determine if this game is today or a future date
  const gameDate = new Date(game.gameDate);
  const today = new Date();
  const isToday =
    gameDate.getFullYear() === today.getFullYear() &&
    gameDate.getMonth() === today.getMonth() &&
    gameDate.getDate() === today.getDate();

  const handleViewMatchup = () => navigate(`/team/${teamId}/matchup`);

  return (
    <div className="today-game-wrapper">
      <GameCard
        game={game}
        teamId={teamId}
        label={
          isLive
            ? "LIVE"
            : isFinal
            ? "FINAL"
            : isToday
            ? "TODAY"
            : "NEXT GAME"
        }
        showDate={!isToday}
        onTap={handleViewMatchup}
      />

      {/* If today's game is final, also show the next upcoming game */}
      {isFinal && game.nextGame && (
        <GameCard
          game={game.nextGame}
          teamId={teamId}
          label="NEXT GAME"
          showDate={true}
          compact
        />
      )}
    </div>
  );
}

function GameCard({ game, teamId, label, showDate, compact, onTap }) {
  const isHome = game.home.id === teamId;
  const opponent = isHome ? game.away : game.home;
  const us = isHome ? game.home : game.away;
  const isLive = game.status === "In Progress";
  const isFinal = game.status === "Final";
  const isWin = isFinal && (isHome ? game.home.score > game.away.score : game.away.score > game.home.score);
  const isLoss = isFinal && !isWin;

  return (
    <div className={`today-game-card ${isLive ? "live" : ""} ${isWin ? "win-card" : ""} ${isLoss ? "loss-card" : ""} ${compact ? "compact" : ""}`} onClick={onTap}>
      <div className="today-game-header">
        <span className={`today-game-label ${label === "LIVE" ? "label-live" : label === "NEXT GAME" ? "label-next" : isWin ? "label-win" : isLoss ? "label-loss" : ""}`}>
          {isWin ? "WIN" : isLoss ? "LOSS" : label}
        </span>
        <span className="today-game-time">
          {showDate && formatGameDate(game.gameDate)}
          {!isFinal && !isLive && (showDate ? " · " : "")}
          {!isFinal && !isLive && formatGameTime(game.gameDate)}
        </span>
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

      {!compact && (us.probablePitcher || opponent.probablePitcher) && (
        <div className="today-game-pitchers">
          <div className="today-game-pitcher sb-player-link" onClick={() => us.probablePitcher?.id && navigate(`/team/${teamId}/player/${us.probablePitcher.id}`)}>
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
          <div className="today-game-pitcher sb-player-link" onClick={() => opponent.probablePitcher?.id && navigate(`/team/${teamId}/player/${opponent.probablePitcher.id}`)}>
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

      {!compact && !isLive && !isFinal && game.gamePk && (
        <LineupPreview gamePk={game.gamePk} teamId={teamId} />
      )}

      {!compact && game.umpireName && (
        <UmpireCard umpireName={game.umpireName} />
      )}

      <div className="today-game-footer">
        <span className="today-game-venue">{game.venue.name}</span>
        {!compact && game.gamePk && (isLive || !isFinal) && (
          <button
            className="today-game-watch"
            onClick={(e) => {
              e.stopPropagation();
              window.location.href = `mlbatbat://game?game_pk=${game.gamePk}`;
              setTimeout(() => window.open(`https://www.mlb.tv/game/${game.gamePk}`, "_blank"), 1500);
            }}
            aria-label={isLive ? "Watch live game" : "Open in MLB app"}
          >
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            {isLive ? "Watch" : "MLB.tv"}
          </button>
        )}
      </div>
    </div>
  );
}

function LineupPreview({ gamePk, teamId }) {
  const navigate = useNavigate();

  // Try actual lineup first
  const { data: actualLineup } = useQuery({
    queryKey: ["gameLineup", gamePk, teamId],
    queryFn: () => fetchGameLineup(gamePk, teamId),
    enabled: !!gamePk && !!teamId,
    staleTime: 1000 * 60 * 2,
    refetchInterval: 1000 * 60 * 2,
  });

  // Always fetch projected as fallback
  const { data: projectedLineup } = useQuery({
    queryKey: ["projectedLineup", teamId],
    queryFn: () => fetchProjectedLineup(teamId),
    enabled: !!teamId && !actualLineup,
    staleTime: 1000 * 60 * 30,
  });

  const lineup = actualLineup || projectedLineup;
  const isProjected = !actualLineup && !!projectedLineup;

  if (!lineup?.length) return null;

  return (
    <div className="lineup-preview" onClick={(e) => e.stopPropagation()}>
      <div className="lineup-header">
        <span className="lineup-title">{isProjected ? "Projected Lineup" : "Starting Lineup"}</span>
        {isProjected && <span className="lineup-projected-tag">Based on recent games</span>}
      </div>
      <div className="lineup-list">
        {lineup.map((p) => (
          <div
            key={p.id}
            className="lineup-row sb-player-link"
            onClick={() => navigate(`/team/${teamId}/player/${p.id}`)}
          >
            <span className="lineup-order">{p.order}</span>
            <PlayerPhoto playerId={p.id} name={p.fullName} size={28} />
            <span className="lineup-name">{p.fullName}</span>
            <span className="lineup-pos">{p.position}</span>
            <span className="lineup-avg">{p.avg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
