import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchTodayGame } from "../../api/client";
import { fetchSchedule } from "../../api/client";
import { formatGameDate, formatGameTime } from "../../utils/formatters";
import PlayerPhoto from "../common/PlayerPhoto";
import LoadingSpinner from "../common/LoadingSpinner";

export default function WatchGame() {
  const { teamId } = useTeam();
  const navigate = useNavigate();

  const { data: game, isLoading } = useQuery({
    queryKey: ["todayGame", teamId],
    queryFn: () => fetchTodayGame(teamId),
    enabled: !!teamId,
    staleTime: 1000 * 60 * 2,
  });

  // Also get upcoming games for "upcoming broadcasts"
  const { data: schedule } = useQuery({
    queryKey: ["schedule", teamId],
    queryFn: () => fetchSchedule(teamId),
    enabled: !!teamId,
    staleTime: 1000 * 60 * 60,
  });

  if (isLoading) return <LoadingSpinner text="Loading..." />;

  const isLive = game && !game.noGame && game.status === "In Progress";
  const isScheduled = game && !game.noGame && ["Scheduled", "Pre-Game", "Warmup"].includes(game.status);
  const isFinal = game && !game.noGame && game.status === "Final";
  const hasGame = game && !game.noGame;

  const isHome = hasGame ? game.home.id === teamId : false;
  const opponent = hasGame ? (isHome ? game.away : game.home) : null;
  const us = hasGame ? (isHome ? game.home : game.away) : null;

  // Deep link to MLB app or MLB.tv website
  const gamePk = hasGame ? game.gamePk : null;
  const mlbAppLink = gamePk ? `mlbatbat://game?game_pk=${gamePk}` : null;
  const mlbWebLink = gamePk ? `https://www.mlb.tv/game/${gamePk}` : null;

  const handleWatch = () => {
    if (!gamePk) return;
    // Try MLB app first, fall back to web
    const start = Date.now();
    window.location.href = mlbAppLink;
    // If app doesn't open within 1.5s, open web
    setTimeout(() => {
      if (Date.now() - start < 2000) {
        window.open(mlbWebLink, "_blank");
      }
    }, 1500);
  };

  const handleOpenWeb = () => {
    if (mlbWebLink) window.open(mlbWebLink, "_blank");
  };

  // Get next few upcoming games
  const upcoming = (schedule || [])
    .filter((g) => {
      const gDate = new Date(g.gameDate);
      return gDate > new Date() && g.status !== "Final";
    })
    .slice(0, 5);

  return (
    <div className="watch-page">
      {/* Current/Next Game */}
      {hasGame && (
        <div className={`watch-game-card ${isLive ? "live" : ""}`}>
          {isLive && <div className="watch-live-badge">LIVE NOW</div>}
          {isScheduled && <div className="watch-scheduled-badge">{formatGameDate(game.gameDate)} · {formatGameTime(game.gameDate)}</div>}
          {isFinal && <div className="watch-final-badge">FINAL</div>}

          <div className="watch-matchup">
            <div className="watch-team">
              <img src={us.logoUrl} alt={us.name} className="watch-team-logo" />
              <span className="watch-team-name">{us.abbreviation}</span>
              {(isLive || isFinal) && <span className="watch-score">{us.score}</span>}
            </div>
            <span className="watch-vs">{isHome ? "vs" : "@"}</span>
            <div className="watch-team">
              <img src={opponent.logoUrl} alt={opponent.name} className="watch-team-logo" />
              <span className="watch-team-name">{opponent.abbreviation}</span>
              {(isLive || isFinal) && <span className="watch-score">{opponent.score}</span>}
            </div>
          </div>

          {/* Probable pitchers */}
          {(us.probablePitcher || opponent.probablePitcher) && (
            <div className="watch-pitchers">
              {us.probablePitcher && (
                <div className="watch-pitcher sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${us.probablePitcher.id}`)}>
                  <PlayerPhoto playerId={us.probablePitcher.id} name={us.probablePitcher.fullName} size={32} />
                  <span>{us.probablePitcher.fullName}</span>
                </div>
              )}
              {us.probablePitcher && opponent.probablePitcher && <span className="watch-pitcher-vs">vs</span>}
              {opponent.probablePitcher && (
                <div className="watch-pitcher sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${opponent.probablePitcher.id}`)}>
                  <PlayerPhoto playerId={opponent.probablePitcher.id} name={opponent.probablePitcher.fullName} size={32} />
                  <span>{opponent.probablePitcher.fullName}</span>
                </div>
              )}
            </div>
          )}

          {/* Watch buttons */}
          <div className="watch-buttons">
            <button className="watch-btn-primary" onClick={handleWatch} aria-label="Watch game in MLB app">
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              {isLive ? "Watch Live" : isFinal ? "Watch Replay" : "Open in MLB"}
            </button>
            <button className="watch-btn-secondary" onClick={handleOpenWeb} aria-label="Watch on MLB.tv website">
              MLB.tv
            </button>
          </div>

          <p className="watch-note">Opens in the MLB app. Requires MLB.tv subscription.</p>
        </div>
      )}

      {!hasGame && (
        <div className="watch-empty">
          <svg aria-hidden="true" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <h2>No Game Right Now</h2>
          <p>Check back when a game is scheduled.</p>
        </div>
      )}

      {/* Upcoming broadcasts */}
      {upcoming.length > 0 && (
        <div className="watch-upcoming">
          <h3 className="section-title">Upcoming Broadcasts</h3>
          {upcoming.map((g) => {
            const gIsHome = g.home.id == teamId;
            const gOpp = gIsHome ? g.away : g.home;
            const gPk = g.gamePk;
            return (
              <button
                key={gPk}
                className="watch-upcoming-row"
                onClick={() => window.open(`https://www.mlb.tv/game/${gPk}`, "_blank")}
                aria-label={`${formatGameDate(g.gameDate)} ${gIsHome ? "vs" : "at"} ${gOpp.abbreviation}`}
              >
                <div className="watch-upcoming-date">
                  <span>{formatGameDate(g.gameDate)}</span>
                  <span className="watch-upcoming-time">{formatGameTime(g.gameDate)}</span>
                </div>
                <div className="watch-upcoming-opp">
                  <img src={gOpp.logoUrl} alt={gOpp.abbreviation} className="watch-upcoming-logo" />
                  <span>{gIsHome ? "vs" : "@"} {gOpp.abbreviation}</span>
                </div>
                <span className="watch-upcoming-action">MLB.tv</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
