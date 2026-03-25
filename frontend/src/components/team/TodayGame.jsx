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

      {/* Live game: inning, linescore, current matchup */}
      {!compact && isLive && liveState && (
        <div className="live-game-detail">
          <div className="live-inning-bar">
            <span className="live-inning">
              {liveState.inningHalf === "Top" ? "\u25B2" : "\u25BC"} {liveState.inning}
            </span>
            <div className="live-outs">
              {[0, 1, 2].map((i) => (
                <span key={i} className={`live-out-dot ${i < liveState.outs ? "filled" : ""}`} />
              ))}
              <span className="live-outs-label">{liveState.outs} out</span>
            </div>
            <div className="live-count">{liveState.balls}-{liveState.strikes}</div>
          </div>

          <div className="live-bases">
            <svg width="48" height="48" viewBox="0 0 48 48">
              <rect x="17" y="1" width="14" height="14" rx="2" transform="rotate(45 24 8)" className={`live-base ${liveState.onSecond ? "occupied" : ""}`} />
              <rect x="28" y="12" width="14" height="14" rx="2" transform="rotate(45 35 19)" className={`live-base ${liveState.onFirst ? "occupied" : ""}`} />
              <rect x="6" y="12" width="14" height="14" rx="2" transform="rotate(45 13 19)" className={`live-base ${liveState.onThird ? "occupied" : ""}`} />
            </svg>
          </div>

          <div className="live-linescore">
            <table className="live-ls-table">
              <thead>
                <tr>
                  <th></th>
                  {liveState.linescore.innings.map((inn) => <th key={inn.num}>{inn.num}</th>)}
                  <th className="live-ls-total">R</th>
                  <th className="live-ls-total">H</th>
                  <th className="live-ls-total">E</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="live-ls-team">{game.away.abbreviation}</td>
                  {liveState.linescore.innings.map((inn) => <td key={inn.num}>{inn.away !== "" ? inn.away : "-"}</td>)}
                  <td className="live-ls-total">{liveState.linescore.away.runs}</td>
                  <td className="live-ls-total">{liveState.linescore.away.hits}</td>
                  <td className="live-ls-total">{liveState.linescore.away.errors}</td>
                </tr>
                <tr>
                  <td className="live-ls-team">{game.home.abbreviation}</td>
                  {liveState.linescore.innings.map((inn) => <td key={inn.num}>{inn.home !== "" ? inn.home : "-"}</td>)}
                  <td className="live-ls-total">{liveState.linescore.home.runs}</td>
                  <td className="live-ls-total">{liveState.linescore.home.hits}</td>
                  <td className="live-ls-total">{liveState.linescore.home.errors}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {liveState.batter && liveState.pitcher && (
            <div className="live-matchup">
              <div className="live-matchup-label">At Bat</div>
              <div className="live-matchup-players">
                <div className="live-matchup-player sb-player-link" onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${liveState.batter.id}`); }}>
                  <PlayerPhoto playerId={liveState.batter.id} name={liveState.batter.fullName} size={32} />
                  <span>{liveState.batter.fullName}</span>
                </div>
                <span className="live-matchup-vs">vs</span>
                <div className="live-matchup-player sb-player-link" onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${liveState.pitcher.id}`); }}>
                  <PlayerPhoto playerId={liveState.pitcher.id} name={liveState.pitcher.fullName} size={32} />
                  <span>{liveState.pitcher.fullName}</span>
                </div>
              </div>
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
              window.location.href = `mlbatbat://game?game_pk=${game.gamePk}`;
              setTimeout(() => window.open(`https://www.mlb.tv/game/${game.gamePk}`, "_blank"), 1500);
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
