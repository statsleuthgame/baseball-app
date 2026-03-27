import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchTodayGame, fetchPitcherSeasonStats } from "../../api/client";
import { formatGameDate, formatGameTime } from "../../utils/formatters";
import PlayerPhoto from "../common/PlayerPhoto";


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
  const isDelayed = game.status === "Delayed Start" || game.status === "Delayed";
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
  const handleViewLive = () => navigate(`/team/${teamId}/live/${game.gamePk}`);

  // When live, redirect to the dedicated live game page
  if (isLive && game.gamePk) {
    return (
      <div className="today-game-wrapper">
        <div className="today-game-card live" onClick={handleViewLive} style={{ cursor: "pointer" }}>
          <div className="today-game-header">
            <span className="today-game-label label-live">LIVE</span>
            <span className="today-game-time">Tap for live view</span>
          </div>
          <div className="today-game-matchup">
            <div className="today-game-side">
              <img src={game.away.logoUrl} alt={game.away.abbreviation} className="today-game-logo-lg" />
              <span className="today-game-abbr">{game.away.abbreviation}</span>
            </div>
            <div className="today-game-center">
              <div className="today-game-score-row">
                <span className="today-game-score">{game.away.score}</span>
                <span className="today-game-vs-small">-</span>
                <span className="today-game-score">{game.home.score}</span>
              </div>
            </div>
            <div className="today-game-side">
              <img src={game.home.logoUrl} alt={game.home.abbreviation} className="today-game-logo-lg" />
              <span className="today-game-abbr">{game.home.abbreviation}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="today-game-wrapper">
      <GameCard
        game={game}
        teamId={teamId}
        label={
          isDelayed
            ? "DELAYED"
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
  const navigate = useNavigate();
  const isHome = game.home.id === teamId;
  const opponent = isHome ? game.away : game.home;
  const us = isHome ? game.home : game.away;
  const isLive = game.status === "In Progress";
  const isFinal = game.status === "Final";
  const isWin = isFinal && (isHome ? game.home.score > game.away.score : game.away.score > game.home.score);
  const isLoss = isFinal && !isWin;

  // Live games are handled by the redirect above — no live queries needed here

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
        <div className="today-game-side">
          <img src={game.away.logoUrl} alt={game.away.abbreviation} className="today-game-logo-lg" />
          <span className="today-game-abbr">{game.away.abbreviation}</span>
          {game.away.wins != null && <span className="today-game-record">{game.away.wins}-{game.away.losses}</span>}
        </div>
        <div className="today-game-center">
          {(isLive || isFinal) ? (
            <div className="today-game-score-row">
              <span className="today-game-score">{game.away.score}</span>
              <span className="today-game-vs-small">-</span>
              <span className="today-game-score">{game.home.score}</span>
            </div>
          ) : (
            <span className="today-game-vs">@</span>
          )}
        </div>
        <div className="today-game-side">
          <img src={game.home.logoUrl} alt={game.home.abbreviation} className="today-game-logo-lg" />
          <span className="today-game-abbr">{game.home.abbreviation}</span>
          {game.home.wins != null && <span className="today-game-record">{game.home.wins}-{game.home.losses}</span>}
        </div>
      </div>

      {/* Scheduled: probable pitchers */}
      {!compact && !isLive && (us.probablePitcher || opponent.probablePitcher) && (
        <div className="today-game-pitchers">
          <div className="today-game-pitcher sb-player-link" onClick={() => us.probablePitcher?.id && navigate(`/team/${teamId}/player/${us.probablePitcher.id}`)}>
            {us.probablePitcher && (
              <>
                <PlayerPhoto
                  playerId={us.probablePitcher.id}
                  name={us.probablePitcher.fullName}
                  size={36}
                />
                <div className="today-pitcher-info">
                  <span>{us.probablePitcher.fullName}</span>
                  <TodayPitcherStats pitcherId={us.probablePitcher.id} />
                </div>
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
                <div className="today-pitcher-info">
                  <span>{opponent.probablePitcher.fullName}</span>
                  <TodayPitcherStats pitcherId={opponent.probablePitcher.id} />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="today-game-footer">
        <div className="today-game-venue-group">
          <span className="today-game-venue">{game.venue.name}</span>
          {game.venueLocation && <span className="today-game-venue-loc">{game.venueLocation}</span>}
        </div>
        {!compact && game.gamePk && (isLive || !isFinal) && (
          <button
            className="today-game-watch"
            onClick={(e) => {
              e.stopPropagation();
              window.location.href = `https://www.mlb.com/tv/g${game.gamePk}`;
            }}
            aria-label={isLive ? "Watch live game" : "Open in MLB app"}
          >
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Watch
          </button>
        )}
      </div>

    </div>
  );
}

function TodayPitcherStats({ pitcherId }) {
  const { data } = useQuery({
    queryKey: ["pitcherSeasonStats", pitcherId],
    queryFn: () => fetchPitcherSeasonStats(pitcherId),
    enabled: !!pitcherId,
    staleTime: 1000 * 60 * 60,
  });

  if (!data) return null;

  return (
    <span className="today-pitcher-stats">
      {data.wins}-{data.losses}, {data.era} ERA
    </span>
  );
}
