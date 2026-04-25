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
    return <div className="today-game-card skeleton" aria-hidden="true" />;
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
      <section className="today-game-wrapper" aria-label="Live game">
        <div className="today-game-card live">
          <div className="today-game-header">
            <span className="today-game-label label-live">LIVE</span>
            <button
              type="button"
              className="today-game-tap"
              onClick={handleViewLive}
              aria-label={`View live game: ${game.away.abbreviation} at ${game.home.abbreviation}, score ${game.away.score} to ${game.home.score}`}
            >
              View live
            </button>
          </div>
          <div className="today-game-matchup">
            <button
              type="button"
              className="today-game-side today-game-side-link"
              onClick={() => navigate(`/team/${game.away.id}`)}
              aria-label={`Go to ${game.away.abbreviation} team page`}
            >
              <img src={game.away.logoUrl} alt="" className="today-game-logo-lg" />
              <span className="today-game-abbr">{game.away.abbreviation}</span>
            </button>
            <div className="today-game-center">
              <div className="today-game-score-row">
                <span className="today-game-score" aria-label={`Away score ${game.away.score}`}>{game.away.score}</span>
                <span className="today-game-vs-small" aria-hidden="true">-</span>
                <span className="today-game-score" aria-label={`Home score ${game.home.score}`}>{game.home.score}</span>
              </div>
            </div>
            <button
              type="button"
              className="today-game-side today-game-side-link"
              onClick={() => navigate(`/team/${game.home.id}`)}
              aria-label={`Go to ${game.home.abbreviation} team page`}
            >
              <img src={game.home.logoUrl} alt="" className="today-game-logo-lg" />
              <span className="today-game-abbr">{game.home.abbreviation}</span>
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="today-game-wrapper" aria-label={isFinal ? "Previous game" : "Upcoming game"}>
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
    </section>
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
    <div className={`today-game-card ${isLive ? "live" : ""} ${isWin ? "win-card" : ""} ${isLoss ? "loss-card" : ""} ${compact ? "compact" : ""}`}>
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
        <button
          type="button"
          className="today-game-side today-game-side-link"
          onClick={() => navigate(`/team/${game.away.id}`)}
          aria-label={`Go to ${game.away.abbreviation} team page`}
        >
          <img src={game.away.logoUrl} alt="" className="today-game-logo-lg" />
          <span className="today-game-abbr">{game.away.abbreviation}</span>
          {game.away.wins != null && <span className="today-game-record">{game.away.wins}-{game.away.losses}</span>}
        </button>
        <div className="today-game-center">
          {(isLive || isFinal) ? (
            <div className="today-game-score-row">
              <span className="today-game-score" aria-label={`Away score ${game.away.score}`}>{game.away.score}</span>
              <span className="today-game-vs-small" aria-hidden="true">-</span>
              <span className="today-game-score" aria-label={`Home score ${game.home.score}`}>{game.home.score}</span>
            </div>
          ) : (
            <span className="today-game-vs" aria-hidden="true">@</span>
          )}
        </div>
        <button
          type="button"
          className="today-game-side today-game-side-link"
          onClick={() => navigate(`/team/${game.home.id}`)}
          aria-label={`Go to ${game.home.abbreviation} team page`}
        >
          <img src={game.home.logoUrl} alt="" className="today-game-logo-lg" />
          <span className="today-game-abbr">{game.home.abbreviation}</span>
          {game.home.wins != null && <span className="today-game-record">{game.home.wins}-{game.home.losses}</span>}
        </button>
      </div>

      {/* Scheduled: probable pitchers */}
      {!compact && !isLive && (us.probablePitcher || opponent.probablePitcher) && (
        <div className="today-game-pitchers">
          {us.probablePitcher ? (
            <button
              type="button"
              className="today-game-pitcher sb-player-link"
              onClick={() => navigate(`/team/${teamId}/player/${us.probablePitcher.id}`)}
              aria-label={`View ${us.probablePitcher.fullName} player page`}
            >
              <PlayerPhoto
                playerId={us.probablePitcher.id}
                name={us.probablePitcher.fullName}
                size={36}
              />
              <div className="today-pitcher-info">
                <span>{us.probablePitcher.fullName}</span>
                <TodayPitcherStats pitcherId={us.probablePitcher.id} />
              </div>
            </button>
          ) : <div className="today-game-pitcher" />}
          <span className="pitcher-vs" aria-hidden="true">vs</span>
          {opponent.probablePitcher ? (
            <button
              type="button"
              className="today-game-pitcher sb-player-link"
              onClick={() => navigate(`/team/${teamId}/player/${opponent.probablePitcher.id}`)}
              aria-label={`View ${opponent.probablePitcher.fullName} player page`}
            >
              <PlayerPhoto
                playerId={opponent.probablePitcher.id}
                name={opponent.probablePitcher.fullName}
                size={36}
              />
              <div className="today-pitcher-info">
                <span>{opponent.probablePitcher.fullName}</span>
                <TodayPitcherStats pitcherId={opponent.probablePitcher.id} />
              </div>
            </button>
          ) : <div className="today-game-pitcher" />}
        </div>
      )}

      <div className="today-game-footer">
        <div className="today-game-venue-group">
          <span className="today-game-venue">{game.venue.name}</span>
          {game.venueLocation && <span className="today-game-venue-loc">{game.venueLocation}</span>}
        </div>
        <div className="today-game-footer-actions">
          {!compact && onTap && (
            <button
              type="button"
              className="today-game-view"
              onClick={onTap}
              aria-label={isFinal ? "View matchup details" : "View matchup"}
            >
              {isFinal ? "Details" : "Matchup"}
            </button>
          )}
          {!compact && game.gamePk && (isLive || !isFinal) && (
            <a
              className="today-game-watch"
              href={`https://www.mlb.com/tv/g${game.gamePk}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={isLive ? "Watch live game on MLB (opens in new tab)" : "Watch on MLB (opens in new tab)"}
            >
              <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Watch
            </a>
          )}
        </div>
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
