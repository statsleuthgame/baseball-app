import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTeam } from "../../context/TeamContext";
import { fetchLiveGameState, fetchGameDetail, fetchWinProbability } from "../../api/client";
import { lastName, teamDisplayName } from "../../utils/formatters";
import ALL_TEAMS from "../../data/teams";
import PlayerPhoto from "../common/PlayerPhoto";
import LoadingSpinner from "../common/LoadingSpinner";

export default function LiveGamePage() {
  const { gamePk } = useParams();
  const { teamId } = useTeam();
  const navigate = useNavigate();

  // Fetch game info
  const { data: gameInfo, isLoading } = useQuery({
    queryKey: ["liveGameInfo", gamePk],
    queryFn: async () => {
      const resp = await fetch(`https://statsapi.mlb.com/api/v1/schedule?gamePk=${gamePk}&sportId=1&hydrate=team,linescore,venue(location)`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const g = data?.dates?.[0]?.games?.[0];
      if (!g) return null;
      const away = g.teams?.away || {};
      const home = g.teams?.home || {};
      return {
        gamePk: g.gamePk, gameDate: g.gameDate, status: g.status?.detailedState || "",
        venue: g.venue?.name || "",
        venueLocation: g.venue?.location ? `${g.venue.location.city}, ${g.venue.location.stateAbbrev}` : "",
        away: { id: away.team?.id, abbreviation: away.team?.abbreviation || "", score: away.score, wins: away.leagueRecord?.wins, losses: away.leagueRecord?.losses, logoUrl: `https://www.mlbstatic.com/team-logos/team-cap-on-dark/${away.team?.id}.svg` },
        home: { id: home.team?.id, abbreviation: home.team?.abbreviation || "", score: home.score, wins: home.leagueRecord?.wins, losses: home.leagueRecord?.losses, logoUrl: `https://www.mlbstatic.com/team-logos/team-cap-on-dark/${home.team?.id}.svg` },
      };
    },
    enabled: !!gamePk,
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 30,
  });

  const { data: liveState } = useQuery({
    queryKey: ["liveGameState", gamePk],
    queryFn: () => fetchLiveGameState(gamePk),
    enabled: !!gamePk,
    staleTime: 1000 * 15,
    refetchInterval: 1000 * 15,
  });

  const { data: wpData } = useQuery({
    queryKey: ["winProb", gamePk],
    queryFn: () => fetchWinProbability(gamePk),
    enabled: !!gamePk,
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 15,
  });

  const [boxOpen, setBoxOpen] = useState(false);
  const { data: boxData } = useQuery({
    queryKey: ["gameDetail", gamePk],
    queryFn: () => fetchGameDetail(gamePk),
    enabled: boxOpen && !!gamePk,
    staleTime: 1000 * 60,
    refetchInterval: boxOpen ? 1000 * 30 : false,
  });

  if (isLoading) return <LoadingSpinner text="Loading game..." />;
  if (!gameInfo) return <div className="matchup-empty"><h2>Game not found</h2></div>;

  const isLive = gameInfo.status === "In Progress" || gameInfo.status === "Warmup" || gameInfo.status === "Delayed Start" || gameInfo.status === "Delayed";
  const isFinal = gameInfo.status === "Final";

  return (
    <div className="live-game-page">
      {/* Back + status + watch */}
      <div className="lgp-status">
        <div className="lgp-status-left">
          <button className="lgp-back-btn" onClick={() => navigate(`/team/${teamId}/scores`)} aria-label="Back to scores">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Scores
          </button>
          {isLive && <span className="lgp-badge live">LIVE</span>}
          {isFinal && <span className="lgp-badge final">FINAL</span>}
        </div>
        {isLive && (
          <button className="lgp-watch-btn" onClick={() => { window.location.href = `https://www.mlb.com/tv/g${gamePk}`; }}>
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Watch
          </button>
        )}
      </div>

      {/* Teams + score */}
      <div className="today-game-matchup">
        <div className="today-game-side">
          <img src={gameInfo.away.logoUrl} alt={gameInfo.away.abbreviation} className="today-game-logo-lg" />
          <span className="today-game-abbr">{gameInfo.away.abbreviation}</span>
          {gameInfo.away.wins != null && <span className="today-game-record">{gameInfo.away.wins}-{gameInfo.away.losses}</span>}
        </div>
        <div className="today-game-center">
          {(isLive || isFinal) ? (
            <div className="today-game-score-row">
              <span className="today-game-score">{gameInfo.away.score}</span>
              <span className="today-game-vs-small">-</span>
              <span className="today-game-score">{gameInfo.home.score}</span>
            </div>
          ) : (
            <span className="today-game-vs">@</span>
          )}
        </div>
        <div className="today-game-side">
          <img src={gameInfo.home.logoUrl} alt={gameInfo.home.abbreviation} className="today-game-logo-lg" />
          <span className="today-game-abbr">{gameInfo.home.abbreviation}</span>
          {gameInfo.home.wins != null && <span className="today-game-record">{gameInfo.home.wins}-{gameInfo.home.losses}</span>}
        </div>
      </div>

      {/* Win probability - between score and live state */}
      {wpData?.length > 0 && (() => {
        const lastWp = wpData[wpData.length - 1];
        const homeWin = lastWp.homeProb >= 0.5;
        const favProb = Math.round((homeWin ? lastWp.homeProb : lastWp.awayProb) * 100);
        const favLogo = homeWin ? gameInfo.home.logoUrl : gameInfo.away.logoUrl;
        const favAbbr = homeWin ? gameInfo.home.abbreviation : gameInfo.away.abbreviation;
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

      {/* Live state */}
      {liveState && (
        <div className="live-game-detail">
          {/* Situation line */}
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

          {/* Linescore + diamond */}
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
                    <td className="live-ls-team">{gameInfo.away.abbreviation}</td>
                    {(liveState.linescore?.innings || []).map((inn) => <td key={inn.num}>{inn.away !== "" ? inn.away : "-"}</td>)}
                    <td className="live-ls-total">{(liveState.linescore?.away || {}).runs}</td>
                    <td className="live-ls-total">{(liveState.linescore?.away || {}).hits}</td>
                    <td className="live-ls-total">{(liveState.linescore?.away || {}).errors}</td>
                  </tr>
                  <tr>
                    <td className="live-ls-team">{gameInfo.home.abbreviation}</td>
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
                  <div className="live-due-up-player sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${liveState.onDeck.id}`)}>
                    <PlayerPhoto playerId={liveState.onDeck.id} name={liveState.onDeck.fullName} size={24} />
                    <span>{liveState.onDeck.fullName}</span>
                  </div>
                )}
                {liveState.inHole && (
                  <div className="live-due-up-player sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${liveState.inHole.id}`)}>
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
                  const scoringTeamId = p.halfInning === "top" ? gameInfo.away.id : gameInfo.home.id;
                  const teamColor = ALL_TEAMS[scoringTeamId]?.secondary || "var(--team-secondary)";
                  return (
                    <div key={`${p.inning}-${p.halfInning}-${p.awayScore}-${p.homeScore}`} className="live-scoring-play" style={{ borderLeftColor: teamColor }}>
                      <span className="live-scoring-inn">{p.halfInning === "top" ? "\u25B2" : "\u25BC"}{p.inning}</span>
                      <span className="live-scoring-desc">{p.description}</span>
                      <span className="live-scoring-score">{p.awayScore}-{p.homeScore}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Box score toggle */}
          <div className="live-boxscore-section">
            <button className="live-boxscore-toggle" onClick={() => setBoxOpen(!boxOpen)}>
              <span>{boxOpen ? "Hide Box Score" : "Box Score"}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: boxOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {boxOpen && boxData && (
              <div className="lgp-box-cols">
                {[{ batters: boxData.away, pitchers: boxData.awayPitchers, abbr: gameInfo.away.abbreviation }, { batters: boxData.home, pitchers: boxData.homePitchers, abbr: gameInfo.home.abbreviation }].map(({ batters, pitchers, abbr }) => (
                  <LgpBoxTeam key={abbr} batters={batters} pitchers={pitchers} abbr={abbr} teamId={teamId} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Venue */}
      <div className="lgp-venue">
        {gameInfo.venue && <span>{gameInfo.venue}</span>}
        {gameInfo.venueLocation && <span className="lgp-venue-loc">{gameInfo.venueLocation}</span>}
      </div>

      {/* View matchup link */}
      <button className="lgp-matchup-btn" onClick={() => navigate(`/team/${teamId}/matchup/${gamePk}`)}>
        View Full Matchup
      </button>
    </div>
  );
}

function BallInPlayVisual({ hitData }) {
  if (!hitData) return null;

  const dotX = (hitData.x / 250) * 200;
  const dotY = (hitData.y / 250) * 160;
  const isHR = hitData.distance >= 300 && hitData.launchAngle > 20;
  const isHit = ["line_drive"].includes(hitData.trajectory) || hitData.distance > 200;
  const accentColor = isHR ? "#ef4444" : isHit ? "#22c55e" : "#64748b";

  const trajLabel = {
    fly_ball: "Fly Ball", line_drive: "Line Drive",
    ground_ball: "Ground Ball", popup: "Popup",
  }[hitData.trajectory] || "Batted Ball";

  const evLabel = hitData.exitVelo >= 100 ? "Barreled" : hitData.exitVelo >= 95 ? "Hard Hit" : hitData.exitVelo >= 85 ? "Medium" : "Soft";

  return (
    <div className="bip-card">
      <div className="bip-field-wrap">
        <svg viewBox="0 0 200 160" className="bip-field-lg">
          <defs>
            <radialGradient id="bipGlow2" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={accentColor} stopOpacity="0.4" />
              <stop offset="100%" stopColor={accentColor} stopOpacity="0" />
            </radialGradient>
            <linearGradient id="bipTrail2" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={accentColor} stopOpacity="0" />
              <stop offset="100%" stopColor={accentColor} stopOpacity="0.8" />
            </linearGradient>
          </defs>
          <path d="M 20 150 Q 100 -10 180 150" fill="rgba(34,80,34,0.15)" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          <path d="M 100 120 L 130 90 L 100 60 L 70 90 Z" fill="rgba(139,90,43,0.12)" stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" />
          <line x1="100" y1="130" x2="130" y2="90" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
          <line x1="130" y1="90" x2="100" y2="60" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
          <line x1="100" y1="60" x2="70" y2="90" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
          <line x1="70" y1="90" x2="100" y2="130" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
          <rect x="126" y="86" width="8" height="8" rx="1" transform="rotate(45 130 90)" fill="rgba(255,255,255,0.15)" />
          <rect x="96" y="56" width="8" height="8" rx="1" transform="rotate(45 100 60)" fill="rgba(255,255,255,0.15)" />
          <rect x="66" y="86" width="8" height="8" rx="1" transform="rotate(45 70 90)" fill="rgba(255,255,255,0.15)" />
          <polygon points="97,130 100,126 103,130 102,133 98,133" fill="rgba(255,255,255,0.2)" />
          <line x1="100" y1="130" x2={dotX} y2={dotY} stroke="url(#bipTrail2)" strokeWidth="1.5" strokeDasharray="4,3" />
          <circle cx={dotX} cy={dotY} r="18" fill="url(#bipGlow2)" />
          <circle cx={dotX} cy={dotY} r="5" fill={accentColor} />
          <circle cx={dotX} cy={dotY} r="5" fill="none" stroke="#fff" strokeWidth="1.5" opacity="0.6" />
        </svg>
      </div>
      <div className="bip-metrics">
        <div className="bip-metric-main">
          {hitData.exitVelo && (
            <div className="bip-metric-big">
              <span className="bip-metric-val" style={{ color: accentColor }}>{hitData.exitVelo}</span>
              <span className="bip-metric-unit">mph exit velo</span>
            </div>
          )}
          {hitData.distance && (
            <div className="bip-metric-big">
              <span className="bip-metric-val" style={{ color: accentColor }}>{hitData.distance}</span>
              <span className="bip-metric-unit">ft distance</span>
            </div>
          )}
        </div>
        <div className="bip-metric-row">
          <span className="bip-tag" style={{ borderColor: accentColor, color: accentColor }}>{trajLabel}</span>
          {hitData.launchAngle != null && <span className="bip-metric-sm">{hitData.launchAngle}° launch</span>}
          <span className="bip-metric-sm">{evLabel}</span>
        </div>
      </div>
    </div>
  );
}

function LgpBoxTeam({ batters, pitchers, abbr, teamId }) {
  const [openBatter, setOpenBatter] = useState(null);
  const navigate = useNavigate();

  return (
    <div className="lgp-box-team">
      <div className="lgp-box-hdr">{teamDisplayName(abbr)}</div>
      {batters?.map((b) => {
        const isOpen = openBatter === b.id;
        const hasABs = b.atBats?.length > 0;
        return (
          <div key={b.id} className="lgp-box-batter">
            <div
              className={`lgp-box-row ${hasABs ? "sb-tappable" : ""}`}
              onClick={hasABs ? () => setOpenBatter(isOpen ? null : b.id) : undefined}
            >
              <span className="lgp-box-pos">{b.position}</span>
              <span className="lgp-box-name-link" onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${b.id}`); }}>
                {lastName(b.name)}
              </span>
              <span className="lgp-box-spacer" />
              <span className="lgp-box-stat">{b.stats.h}-{b.stats.ab}</span>
              {hasABs && (
                <svg className="lgp-box-chev" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: isOpen ? "rotate(180deg)" : "none" }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              )}
            </div>
            {isOpen && (
              <div className="lgp-box-abs">
                {b.atBats.map((ab, i) => {
                  const ord = ab.inning === 1 ? "1st" : ab.inning === 2 ? "2nd" : ab.inning === 3 ? "3rd" : `${ab.inning}th`;
                  return (
                    <div key={i} className={`lgp-box-ab ${ab.isScoring ? "lgp-box-ab-scoring" : ""}`}>
                      <span className="lgp-box-ab-inn">{ord}</span>
                      <span className="lgp-box-ab-event">{ab.shortDesc || ab.event}</span>
                      {ab.rbi > 0 && <span className="lgp-box-ab-rbi">{ab.rbi} RBI</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {pitchers?.length > 0 && (
        <div className="lgp-box-pitchers">
          {pitchers.map((p) => (
            <div key={p.id} className="lgp-box-row">
              <span className="lgp-box-pos">P</span>
              <span className="lgp-box-name sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${p.id}`)}>
                {lastName(p.name)}
              </span>
              <span className="lgp-box-stat">{p.stats.ip} IP, {p.stats.k} K</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
