import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchTodayGame, fetchPitcherSeasonStats, fetchLiveGameState } from "../../api/client";
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

  return (
    <div className="today-game-wrapper">
      <GameCard
        game={game}
        teamId={teamId}
        label={
          isLive
            ? "LIVE"
            : isDelayed
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

  const { data: liveState } = useQuery({
    queryKey: ["liveGameState", game.gamePk],
    queryFn: () => fetchLiveGameState(game.gamePk),
    enabled: isLive && !!game.gamePk,
    staleTime: 1000 * 15,
    refetchInterval: 1000 * 15,
  });

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

      {/* Live game: compact situation + R/H/E + matchup + last play */}
      {!compact && isLive && liveState && (
        <div className="live-game-detail" onClick={(e) => e.stopPropagation()}>
          {/* Situation line: inning · bases · outs · count */}
          <div className="live-situation">
            <span className="live-inning">
              {liveState.inningHalf === "Top" ? "\u25B2" : "\u25BC"} {liveState.inning}
            </span>
            <span className="live-sep">&middot;</span>
            <div className="live-bases-inline">
              <span className={`live-base-dot ${liveState.onThird ? "on" : ""}`} />
              <span className={`live-base-dot ${liveState.onSecond ? "on" : ""}`} />
              <span className={`live-base-dot ${liveState.onFirst ? "on" : ""}`} />
            </div>
            <span className="live-sep">&middot;</span>
            <div className="live-outs-inline">
              {[0, 1, 2].map((i) => (
                <span key={i} className={`live-out-pip ${i < liveState.outs ? "filled" : ""}`} />
              ))}
            </div>
            <span className="live-outs-text">{liveState.outs} out</span>
            <span className="live-sep">&middot;</span>
            <span className="live-count">{liveState.balls}-{liveState.strikes}</span>
          </div>

          {/* R/H/E + diamond */}
          <div className="live-rhe-diamond">
            <div className="live-rhe">
              <div className="live-rhe-header">
                <span className="live-rhe-team"></span>
                <span className="live-rhe-val live-rhe-hdr">R</span>
                <span className="live-rhe-val live-rhe-hdr">H</span>
                <span className="live-rhe-val live-rhe-hdr">E</span>
              </div>
              <div className="live-rhe-row">
                <span className="live-rhe-team">{game.away.abbreviation}</span>
                <span className="live-rhe-val">{liveState.linescore.away.runs}</span>
                <span className="live-rhe-val">{liveState.linescore.away.hits}</span>
                <span className="live-rhe-val">{liveState.linescore.away.errors}</span>
              </div>
              <div className="live-rhe-row">
                <span className="live-rhe-team">{game.home.abbreviation}</span>
                <span className="live-rhe-val">{liveState.linescore.home.runs}</span>
                <span className="live-rhe-val">{liveState.linescore.home.hits}</span>
                <span className="live-rhe-val">{liveState.linescore.home.errors}</span>
              </div>
            </div>
            <svg className="live-diamond" width="56" height="56" viewBox="0 0 56 56">
              <rect x="21" y="3" width="14" height="14" rx="2" transform="rotate(45 28 10)" className={`live-diamond-base ${liveState.onSecond ? "occupied" : ""}`} />
              <rect x="32" y="14" width="14" height="14" rx="2" transform="rotate(45 39 21)" className={`live-diamond-base ${liveState.onFirst ? "occupied" : ""}`} />
              <rect x="10" y="14" width="14" height="14" rx="2" transform="rotate(45 17 21)" className={`live-diamond-base ${liveState.onThird ? "occupied" : ""}`} />
              <circle cx="28" cy="42" r="3" fill="var(--text-muted)" opacity="0.3" />
            </svg>
          </div>

          {/* Current matchup */}
          {liveState.batter && liveState.pitcher && (
            <div className="live-ab">
              <div className="live-ab-row sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${liveState.batter.id}`)}>
                <PlayerPhoto playerId={liveState.batter.id} name={liveState.batter.fullName} size={28} />
                <div className="live-ab-info">
                  <span className="live-ab-name">{liveState.batter.fullName}</span>
                  <span className="live-ab-sub">At Bat</span>
                </div>
                {liveState.batter.avg && <span className="live-ab-stat">{liveState.batter.avg}</span>}
              </div>
              <div className="live-ab-row sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${liveState.pitcher.id}`)}>
                <PlayerPhoto playerId={liveState.pitcher.id} name={liveState.pitcher.fullName} size={28} />
                <div className="live-ab-info">
                  <span className="live-ab-name">{liveState.pitcher.fullName}</span>
                  <span className="live-ab-sub">Pitching</span>
                </div>
                {liveState.pitcher.gameStats && (
                  <span className="live-ab-stat">{liveState.pitcher.gameStats.ip} IP · {liveState.pitcher.gameStats.pitches}P</span>
                )}
              </div>
            </div>
          )}

          {/* Last play */}
          {liveState.lastPlay && (
            <div className="live-last-play">
              <span className="live-last-play-label">Last:</span> {liveState.lastPlay}
            </div>
          )}
        </div>
      )}

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

      {!compact && game.umpireName && (
        <UmpireCard umpireName={game.umpireName} />
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
              window.open(`https://www.mlb.tv/game/${game.gamePk}`, "_blank");
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
