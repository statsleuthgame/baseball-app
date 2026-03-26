import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTeam } from "../../context/TeamContext";
import { fetchLiveGameState, fetchGameDetail } from "../../api/client";
import { formatGameDate, formatGameTime, lastName, teamDisplayName } from "../../utils/formatters";
import PlayerPhoto from "../common/PlayerPhoto";
import LoadingSpinner from "../common/LoadingSpinner";

export default function LiveGamePage() {
  const { gamePk } = useParams();
  const { teamId } = useTeam();
  const navigate = useNavigate();

  // Fetch game info
  const { data: gameInfo, isLoading } = useQuery({
    queryKey: ["specificGame", gamePk],
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
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 30,
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
      {/* Status badge */}
      <div className="lgp-status">
        {isLive && <span className="lgp-badge live">LIVE</span>}
        {isFinal && <span className="lgp-badge final">FINAL</span>}
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
            <svg className="live-diamond" width="60" height="64" viewBox="0 0 60 64">
              <rect x="21" y="4" width="16" height="16" rx="2" transform="rotate(45 29 12)" className={`live-diamond-base ${liveState.onSecond ? "occupied" : ""}`} />
              <rect x="33" y="16" width="16" height="16" rx="2" transform="rotate(45 41 24)" className={`live-diamond-base ${liveState.onFirst ? "occupied" : ""}`} />
              <rect x="9" y="16" width="16" height="16" rx="2" transform="rotate(45 17 24)" className={`live-diamond-base ${liveState.onThird ? "occupied" : ""}`} />
              <circle cx="29" cy="46" r="3" fill="var(--text-muted)" opacity="0.3" />
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
                {liveState.scoringPlays.map((p, i) => (
                  <div key={`${p.inning}-${p.halfInning}-${p.awayScore}-${p.homeScore}`} className="live-scoring-play">
                    <span className="live-scoring-inn">{p.halfInning === "top" ? "\u25B2" : "\u25BC"}{p.inning}</span>
                    <span className="live-scoring-desc">{p.description}</span>
                    <span className="live-scoring-score">{p.awayScore}-{p.homeScore}</span>
                  </div>
                ))}
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
              <div className="live-boxscore-content">
                {[{ batters: boxData.away, pitchers: boxData.awayPitchers, abbr: gameInfo.away.abbreviation }, { batters: boxData.home, pitchers: boxData.homePitchers, abbr: gameInfo.home.abbreviation }].map(({ batters, pitchers, abbr }) => (
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
