import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { useState } from "react";
import { fetchTodayGame, fetchPitcherSeasonStats, fetchLiveGameState, fetchGameDetail, fetchWinProbability } from "../../api/client";
import { teamDisplayName } from "../../utils/formatters";
import { formatGameDate, formatGameTime } from "../../utils/formatters";
import ALL_TEAMS from "../../data/teams";
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
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 30,
  });

  const { data: wpData } = useQuery({
    queryKey: ["winProb", game.gamePk],
    queryFn: () => fetchWinProbability(game.gamePk),
    enabled: isLive && !!game.gamePk,
    staleTime: 1000 * 60,
    refetchInterval: 1000 * 60,
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

      {/* Win probability - between score and live detail */}
      {!compact && isLive && wpData?.length > 0 && (() => {
        const lastWp = wpData[wpData.length - 1];
        const homeWin = lastWp.homeProb >= 0.5;
        const favProb = Math.round((homeWin ? lastWp.homeProb : lastWp.awayProb) * 100);
        const favLogo = homeWin ? game.home.logoUrl : game.away.logoUrl;
        const favAbbr = homeWin ? game.home.abbreviation : game.away.abbreviation;
        return (
          <div className="lgp-wp">
            <span className="lgp-wp-label">Win Probability</span>
            <div className="lgp-wp-fav">
              <img src={favLogo} alt={favAbbr} className="lgp-wp-logo" />
              <span className="lgp-wp-pct">{favProb}%</span>
            </div>
          </div>
        );
      })()}

      {/* Live game: compact situation + R/H/E + matchup + last play */}
      {!compact && isLive && liveState && (
        <div className="live-game-detail" onClick={(e) => e.stopPropagation()}>
          {/* Situation line: inning · outs · count */}
          <div className="live-situation">
            <span className="live-inning">
              {liveState.inningHalf === "Top" ? "\u25B2" : "\u25BC"} {liveState.inning}
            </span>
            <div className="live-outs-inline">
              {[0, 1, 2].map((i) => (
                <span key={i} className={`live-out-pip ${i < liveState.outs ? "filled" : ""}`} />
              ))}
            </div>
            <span className="live-outs-text">{liveState.outs} out</span>
            <span className="live-sep">&middot;</span>
            <span className="live-count">{liveState.balls}-{liveState.strikes}</span>
          </div>

          {/* Full linescore + diamond */}
          <div className="live-ls-diamond">
            <div className="live-ls-scroll">
              <table className="live-ls-table">
                <thead>
                  <tr>
                    <th></th>
                    {(liveState.linescore?.innings || []).map((inn) => <th key={inn.num}>{inn.num}</th>)}
                    <th className="live-ls-total">R</th>
                    <th className="live-ls-total">H</th>
                    <th className="live-ls-total">E</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="live-ls-team">{game.away.abbreviation}</td>
                    {(liveState.linescore?.innings || []).map((inn) => <td key={inn.num}>{inn.away !== "" ? inn.away : "-"}</td>)}
                    <td className="live-ls-total">{(liveState.linescore?.away || {}).runs}</td>
                    <td className="live-ls-total">{(liveState.linescore?.away || {}).hits}</td>
                    <td className="live-ls-total">{(liveState.linescore?.away || {}).errors}</td>
                  </tr>
                  <tr>
                    <td className="live-ls-team">{game.home.abbreviation}</td>
                    {(liveState.linescore?.innings || []).map((inn) => <td key={inn.num}>{inn.home !== "" ? inn.home : "-"}</td>)}
                    <td className="live-ls-total">{(liveState.linescore?.home || {}).runs}</td>
                    <td className="live-ls-total">{(liveState.linescore?.home || {}).hits}</td>
                    <td className="live-ls-total">{(liveState.linescore?.home || {}).errors}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <svg className="live-diamond" width="72" height="72" viewBox="0 0 72 72">
              <rect x="24" y="2" width="16" height="16" rx="2" transform="rotate(45 32 10)" className={`live-diamond-base ${liveState.onSecond ? "occupied" : ""}`} />
              <rect x="40" y="18" width="16" height="16" rx="2" transform="rotate(45 48 26)" className={`live-diamond-base ${liveState.onFirst ? "occupied" : ""}`} />
              <rect x="8" y="18" width="16" height="16" rx="2" transform="rotate(45 16 26)" className={`live-diamond-base ${liveState.onThird ? "occupied" : ""}`} />
              <circle cx="32" cy="50" r="3" fill="var(--text-muted)" opacity="0.3" />
            </svg>
          </div>

          {/* Current matchup */}
          {liveState.batter && liveState.pitcher && (
            <div className="live-ab">
              <div className="live-ab-row sb-player-link" onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${liveState.batter.id}`); }}>
                <PlayerPhoto playerId={liveState.batter.id} name={liveState.batter.fullName} size={28} />
                <div className="live-ab-info">
                  <span className="live-ab-name">{liveState.batter.fullName}</span>
                  <span className="live-ab-sub">At Bat</span>
                </div>
                {liveState.batter.avg && <span className="live-ab-stat">{liveState.batter.avg}</span>}
              </div>
              <div className="live-ab-row sb-player-link" onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${liveState.pitcher.id}`); }}>
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

          {/* Play by play - current at bat */}
          {liveState.currentAtBat?.length > 0 && (
            <div className="live-pbp">
              <span className="live-last-play-label">Play by Play:</span>
              {(() => {
                const p = liveState.currentAtBat[liveState.currentAtBat.length - 1];
                return (
                  <>
                    <span className="live-pbp-detail">
                      {p.action}{p.pitchInfo ? ` ${p.pitchInfo}` : ""} — <strong>{p.call}</strong>
                    </span>
                    {p.hitData && <BallInPlayVisual hitData={p.hitData} />}
                  </>
                );
              })()}
            </div>
          )}

          {/* Last play */}
          {liveState.lastPlay && (
            <div className="live-last-play">
              <span className="live-last-play-label">Last:</span> {liveState.lastPlay}
              {liveState.lastHitData && <BallInPlayVisual hitData={liveState.lastHitData} />}
            </div>
          )}

          {/* Next due up */}
          {(liveState.onDeck || liveState.inHole) && (
            <div className="live-due-up">
              <span className="live-due-up-label">Due Up</span>
              <div className="live-due-up-list">
                {liveState.onDeck && (
                  <div className="live-due-up-player sb-player-link" onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${liveState.onDeck.id}`); }}>
                    <PlayerPhoto playerId={liveState.onDeck.id} name={liveState.onDeck.fullName} size={24} />
                    <span>{liveState.onDeck.fullName}</span>
                  </div>
                )}
                {liveState.inHole && (
                  <div className="live-due-up-player sb-player-link" onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${liveState.inHole.id}`); }}>
                    <PlayerPhoto playerId={liveState.inHole.id} name={liveState.inHole.fullName} size={24} />
                    <span>{liveState.inHole.fullName}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Scoring summary */}
          {liveState.scoringPlays?.length > 0 && (
            <div className="live-scoring">
              <span className="live-scoring-label">Scoring</span>
              <div className="live-scoring-list">
                {liveState.scoringPlays.map((p, i) => {
                  const scoringTeamId = p.halfInning === "top" ? game.away.id : game.home.id;
                  const teamColor = ALL_TEAMS[scoringTeamId]?.secondary || "var(--team-secondary)";
                  return (
                  <div key={i} className="live-scoring-play" style={{ borderLeftColor: teamColor }}>
                    <span className="live-scoring-inn">{p.halfInning === "top" ? "\u25B2" : "\u25BC"}{p.inning}</span>
                    <span className="live-scoring-desc">{p.description}</span>
                    <span className="live-scoring-score">{p.awayScore}-{p.homeScore}</span>
                  </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Live box score toggle */}
          <LiveBoxScore gamePk={game.gamePk} awayAbbr={game.away.abbreviation} homeAbbr={game.home.abbreviation} teamId={teamId} />
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

function LiveBoxScore({ gamePk, awayAbbr, homeAbbr, teamId }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ["gameDetail", gamePk],
    queryFn: () => fetchGameDetail(gamePk),
    enabled: open && !!gamePk,
    staleTime: 1000 * 60,
    refetchInterval: open ? 1000 * 30 : false,
  });

  return (
    <div className="live-boxscore-section">
      <button className="live-boxscore-toggle" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
        <span>{open ? "Hide Box Score" : "Box Score"}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && data && (
        <div className="live-boxscore-content" onClick={(e) => e.stopPropagation()}>
          {[{ batters: data.away, pitchers: data.awayPitchers, abbr: awayAbbr }, { batters: data.home, pitchers: data.homePitchers, abbr: homeAbbr }].map(({ batters, pitchers, abbr }) => (
            <div key={abbr} className="live-boxscore-team">
              <div className="live-boxscore-hdr">{teamDisplayName(abbr)}</div>
              {batters?.map((b) => (
                <div key={b.id} className="live-boxscore-row">
                  <span className="live-bs-pos">{b.position}</span>
                  <span className="live-bs-name sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${b.id}`)}>{b.name}</span>
                  <span className="live-bs-stat">{b.stats.h}-{b.stats.ab}</span>
                  {b.stats.rbi > 0 && <span className="live-bs-rbi">{b.stats.rbi} RBI</span>}
                  {b.stats.hr > 0 && <span className="live-bs-hr">{b.stats.hr} HR</span>}
                </div>
              ))}
              {pitchers?.length > 0 && (
                <div className="live-boxscore-pitchers">
                  {pitchers.map((p) => (
                    <div key={p.id} className="live-boxscore-row">
                      <span className="live-bs-pos">P</span>
                      <span className="live-bs-name sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${p.id}`)}>{p.name}</span>
                      <span className="live-bs-stat">{p.stats.ip} IP</span>
                      <span className="live-bs-stat">{p.stats.k} K</span>
                      <span className="live-bs-stat">{p.stats.er} ER</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BallInPlayVisual({ hitData }) {
  if (!hitData) return null;
  // MLB coordinates: ~250x250 grid, home plate ~(125, 200), CF ~(125, 20)
  // Normalize to a 60x60 SVG
  const dotX = (hitData.x / 250) * 60;
  const dotY = (hitData.y / 250) * 60;
  const isHit = hitData.trajectory === "line_drive" || hitData.distance > 200;
  const isHR = hitData.distance >= 300 && hitData.launchAngle > 20;
  const dotColor = isHR ? "var(--live)" : isHit ? "var(--win)" : "var(--text-muted)";

  return (
    <div className="bip-visual">
      <svg width="60" height="60" viewBox="0 0 60 60" className="bip-field">
        {/* Outfield arc */}
        <path d="M 5 55 Q 30 -5 55 55" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
        {/* Infield diamond */}
        <path d="M 30 42 L 42 30 L 30 18 L 18 30 Z" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
        {/* Home plate */}
        <circle cx="30" cy="48" r="2" fill="rgba(255,255,255,0.15)" />
        {/* Landing spot */}
        <circle cx={dotX} cy={dotY} r="3.5" fill={dotColor} opacity="0.9" />
        <circle cx={dotX} cy={dotY} r="6" fill={dotColor} opacity="0.2" />
      </svg>
      <div className="bip-stats">
        {hitData.exitVelo && <span>{hitData.exitVelo} mph</span>}
        {hitData.launchAngle != null && <span>{hitData.launchAngle}°</span>}
        {hitData.distance && <span>{hitData.distance} ft</span>}
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
