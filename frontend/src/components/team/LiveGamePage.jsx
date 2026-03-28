import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTeam } from "../../context/TeamContext";
import { fetchLiveGameState, fetchGameDetail, fetchWinProbability } from "../../api/client";
import { lastName, teamDisplayName } from "../../utils/formatters";
import ALL_TEAMS from "../../data/teams";
import { lazy, Suspense } from "react";
const BallInPlay3D = lazy(() => import("../ballflight3d/BallInPlay3D"));
import PlayerPhoto from "../common/PlayerPhoto";
import LoadingSpinner from "../common/LoadingSpinner";

// Bold hit types and add HR distance in scoring descriptions
function formatScoringDesc(desc, hrDistance) {
  if (!desc) return "";
  let html = desc
    .replace(/\b(singles|doubles|triples|homers|walks|hit by pitch|grand slam|sacrifice fly|sac fly)\b/gi, "<strong>$1</strong>");
  if (hrDistance && html.includes("<strong>homers</strong>")) {
    html = html.replace("<strong>homers</strong>", `<strong>homers</strong> (${hrDistance} ft)`);
  }
  return html;
}

export default function LiveGamePage() {
  const { gamePk } = useParams();
  const { teamId } = useTeam();
  const navigate = useNavigate();

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
        venue: g.venue?.name || "", venueId: g.venue?.id,
        venueLocation: g.venue?.location ? `${g.venue.location.city}, ${g.venue.location.stateAbbrev}` : "",
        away: { id: away.team?.id, abbreviation: away.team?.abbreviation || "", score: away.score, logoUrl: `https://www.mlbstatic.com/team-logos/team-cap-on-dark/${away.team?.id}.svg` },
        home: { id: home.team?.id, abbreviation: home.team?.abbreviation || "", score: home.score, logoUrl: `https://www.mlbstatic.com/team-logos/team-cap-on-dark/${home.team?.id}.svg` },
      };
    },
    enabled: !!gamePk, staleTime: 1000 * 30, refetchInterval: 1000 * 30,
  });

  const { data: liveState, dataUpdatedAt } = useQuery({
    queryKey: ["liveGameState", gamePk],
    queryFn: () => fetchLiveGameState(gamePk),
    enabled: !!gamePk, staleTime: 1000 * 5, refetchInterval: 1000 * 5,
  });

  const { data: wpData } = useQuery({
    queryKey: ["winProb", gamePk],
    queryFn: () => fetchWinProbability(gamePk),
    enabled: !!gamePk, staleTime: 1000 * 30, refetchInterval: 1000 * 30,
  });

  const [boxOpen, setBoxOpen] = useState(false);
  const [replayData, setReplayData] = useState(null); // scoring play hit data for replay
  const [replayKey, setReplayKey] = useState(0);
  const { data: boxData } = useQuery({
    queryKey: ["gameDetail", gamePk],
    queryFn: () => fetchGameDetail(gamePk),
    enabled: boxOpen && !!gamePk, staleTime: 1000 * 60, refetchInterval: boxOpen ? 1000 * 30 : false,
  });

  // Auto-collapse ball-in-play visual after 30 seconds
  const [bipCollapsed, setBipCollapsed] = useState(false);
  const bipTimerRef = useRef(null);
  const lastHitRef = useRef(null);
  // Persist hit data across half-inning changes (API resets allPlays on side change)
  const persistedHitDataRef = useRef(null);
  // Store pre-play runner state so the 3D viewer animates from the correct starting positions
  const prevRunnersRef = useRef({ first: false, second: false, third: false });
  const prevRunnerNamesRef = useRef({});
  const [bipRunners, setBipRunners] = useState({ first: false, second: false, third: false });
  const [bipRunnerNames, setBipRunnerNames] = useState({});

  // Track side changes (Top↔Bottom) to show "Coming Up" only during transitions
  const [sideJustChanged, setSideJustChanged] = useState(false);
  const prevHalfRef = useRef(null);
  const sideTimerRef = useRef(null);

  // On first mount, initialize lastHitRef so we don't replay stale BIPs
  const initializedRef = useRef(false);

  useEffect(() => {
    // Persist hit data — API resets allPlays on half-inning change so lastHitData goes null
    if (liveState?.lastHitData) {
      persistedHitDataRef.current = liveState.lastHitData;
    }

    const hitKey = liveState?.lastHitData ? `${liveState.lastHitData.x}-${liveState.lastHitData.y}` : null;

    // On first load, record the current hit key without triggering animation
    if (!initializedRef.current) {
      initializedRef.current = true;
      if (hitKey) lastHitRef.current = hitKey;
      setBipCollapsed(true); // suppress stale BIP from before page load
      return;
    }

    if (hitKey && hitKey !== lastHitRef.current) {
      // New ball in play — snapshot the PREVIOUS poll's runners (pre-play state)
      setBipRunners({ ...prevRunnersRef.current });
      setBipRunnerNames({ ...prevRunnerNamesRef.current, batter: liveState?.lastHitData?.batterName || liveState?.batter?.fullName || "" });
      lastHitRef.current = hitKey;
      setBipCollapsed(false);
      if (bipTimerRef.current) clearTimeout(bipTimerRef.current);
      bipTimerRef.current = setTimeout(() => {
        setBipCollapsed(true);
        persistedHitDataRef.current = null; // clear persisted data after collapse
      }, 30000);
    }
    // Always update prevRunners to current state for next time
    prevRunnersRef.current = {
      first: !!liveState?.onFirst,
      second: !!liveState?.onSecond,
      third: !!liveState?.onThird,
    };
    prevRunnerNamesRef.current = {
      first: liveState?.runnerFirst?.fullName || "",
      second: liveState?.runnerSecond?.fullName || "",
      third: liveState?.runnerThird?.fullName || "",
    };
    return () => { if (bipTimerRef.current) clearTimeout(bipTimerRef.current); };
  }, [liveState?.lastHitData, liveState?.onFirst, liveState?.onSecond, liveState?.onThird]);

  // Detect inning half changes
  useEffect(() => {
    if (!liveState?.inningHalf) return;
    const currentHalf = `${liveState.inning}-${liveState.inningHalf}`;
    if (prevHalfRef.current && prevHalfRef.current !== currentHalf) {
      // Side changed — show "Coming Up" for 30 seconds then revert to empty zone
      setSideJustChanged(true);
      if (sideTimerRef.current) clearTimeout(sideTimerRef.current);
      sideTimerRef.current = setTimeout(() => setSideJustChanged(false), 30000);
    }
    prevHalfRef.current = currentHalf;
    return () => { if (sideTimerRef.current) clearTimeout(sideTimerRef.current); };
  }, [liveState?.inning, liveState?.inningHalf]);

  // Clear "Coming Up" when pitches arrive for the new half
  useEffect(() => {
    if (sideJustChanged && liveState?.currentAtBat?.length > 0) {
      setSideJustChanged(false);
    }
  }, [sideJustChanged, liveState?.currentAtBat?.length]);

  if (isLoading) return <LoadingSpinner text="Loading game..." />;
  if (!gameInfo) return <div className="matchup-empty"><h2>Game not found</h2></div>;

  const isLive = ["In Progress", "Warmup", "Delayed Start", "Delayed"].includes(gameInfo.status);
  const isFinal = gameInfo.status === "Final";

  // Win probability
  const wp = wpData?.length > 0 ? (() => {
    const last = wpData[wpData.length - 1];
    const homeWin = last.homeProb >= 0.5;
    return {
      pct: Math.round((homeWin ? last.homeProb : last.awayProb) * 100),
      logo: homeWin ? gameInfo.home.logoUrl : gameInfo.away.logoUrl,
      abbr: homeWin ? gameInfo.home.abbreviation : gameInfo.away.abbreviation,
    };
  })() : null;

  // Pitch count color
  const pcColor = (pitches) => pitches >= 100 ? "#ef4444" : pitches >= 80 ? "#f59e0b" : "var(--text-muted)";

  return (
    <div className="lgp">
      {/* ===== ZONE A: HERO SCOREBOARD ===== */}
      <div className="lgp-hero">
        <div className="lgp-hero-top">
          <button className="lgp-back-btn" onClick={() => navigate(-1)} aria-label="Go back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div className="lgp-hero-badges">
            {isLive && <span className="lgp-badge live">LIVE <span key={dataUpdatedAt} className="lgp-live-dot" /></span>}
            {isFinal && <span className="lgp-badge final">FINAL</span>}
          </div>
          {isLive && (
            <button className="lgp-watch-btn" onClick={() => { window.location.href = `https://www.mlb.com/tv/g${gamePk}`; }}>
              <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
              Watch
            </button>
          )}
        </div>

        {/* Score — use liveState for real-time, fallback to gameInfo */}
        <div className="lgp-score-row">
          <div className="lgp-team-col">
            <img src={gameInfo.away.logoUrl} alt={gameInfo.away.abbreviation} className="lgp-logo" />
            <span className="lgp-team-abbr">{gameInfo.away.abbreviation}</span>
          </div>
          <div className="lgp-score-center">
            <div className="lgp-scores">
              <span className="lgp-score-num">{liveState?.linescore?.away?.runs ?? gameInfo.away.score ?? 0}</span>
              <span className="lgp-score-dash">-</span>
              <span className="lgp-score-num">{liveState?.linescore?.home?.runs ?? gameInfo.home.score ?? 0}</span>
            </div>
          </div>
          <div className="lgp-team-col">
            <img src={gameInfo.home.logoUrl} alt={gameInfo.home.abbreviation} className="lgp-logo" />
            <span className="lgp-team-abbr">{gameInfo.home.abbreviation}</span>
          </div>
        </div>

        {/* Situation line with inline diamond — hide when final */}
        {liveState && !isFinal && (
          <div className="lgp-situation">
            <span className="lgp-inning">{liveState.inningHalf === "Top" ? "\u25B2" : "\u25BC"} {liveState.inning}</span>
            <svg className="lgp-diamond-inline" width="36" height="32" viewBox="0 -4 36 32">
              <rect x="12" y="0" width="10" height="10" rx="1.5" transform="rotate(45 17 5)" className={`lgp-base ${liveState.onSecond ? "on" : ""}`} />
              <rect x="21" y="9" width="10" height="10" rx="1.5" transform="rotate(45 26 14)" className={`lgp-base ${liveState.onFirst ? "on" : ""}`} />
              <rect x="3" y="9" width="10" height="10" rx="1.5" transform="rotate(45 8 14)" className={`lgp-base ${liveState.onThird ? "on" : ""}`} />
            </svg>
            <div className="lgp-outs">
              {[0, 1, 2].map((i) => (
                <span key={i} className={`lgp-out-pip ${i < liveState.outs ? "on" : ""}`} />
              ))}
              <span className="lgp-outs-text">{liveState.outs} out</span>
            </div>
            <span className="lgp-count">{liveState.balls}-{liveState.strikes}</span>
          </div>
        )}
        {!isFinal && liveState && (liveState.runnerFirst || liveState.runnerSecond || liveState.runnerThird) && (
          <div className="lgp-runners-line">
            {liveState.runnerThird && <span className="lgp-runner-tag">3B: {lastName(liveState.runnerThird.fullName)}</span>}
            {liveState.runnerSecond && <span className="lgp-runner-tag">2B: {lastName(liveState.runnerSecond.fullName)}</span>}
            {liveState.runnerFirst && <span className="lgp-runner-tag">1B: {lastName(liveState.runnerFirst.fullName)}</span>}
          </div>
        )}
      </div>

      {/* ===== ZONE B+C: AT-BAT + VISUAL (combined) — hide when game is final ===== */}
      {!isFinal && liveState?.batter && liveState?.pitcher && (
        <div className="lgp-section">
          {/* Batter — logo, name, game stats, season avg */}
          {(() => {
            const battingTeamLogo = liveState.inningHalf === "Top" ? gameInfo.away.logoUrl : gameInfo.home.logoUrl;
            const b = liveState.batter;
            const gameStats = [];
            if (b.ab != null) gameStats.push(`${b.h || 0}-${b.ab}`);
            if (b.hr > 0) gameStats.push(`${b.hr} HR`);
            if (b.rbi > 0) gameStats.push(`${b.rbi} RBI`);
            if (b.k > 0) gameStats.push(`${b.k} K`);
            if (b.bb > 0) gameStats.push(`${b.bb} BB`);
            if (b.hbp > 0) gameStats.push(`${b.hbp} HBP`);
            return (
              <div className="lgp-batter-row sb-player-link" role="button" tabIndex={0} onClick={() => navigate(`/team/${teamId}/player/${b.id}`)} onKeyDown={(e) => e.key === "Enter" && navigate(`/team/${teamId}/player/${b.id}`)}>
                <div className="lgp-batter-left">
                  <img src={battingTeamLogo} alt="" className="lgp-batter-logo" />
                  <span className="lgp-batter-name">{b.fullName}</span>
                  {gameStats.length > 0 && <span className="lgp-batter-game">{gameStats.join(", ")}</span>}
                </div>
                <span className="lgp-batter-avg">Season Avg. {b.avg || ".000"}</span>
              </div>
            );
          })()}

          {/* Visual area: strike zone / ball-in-play / next up */}
          {(() => {
            const battingTeamLogo2 = liveState.inningHalf === "Top" ? gameInfo.away.logoUrl : gameInfo.home.logoUrl;
            // Use persisted hit data (survives half-inning API reset)
            const hitData = liveState.lastHitData || persistedHitDataRef.current;
            const lastPitch = liveState.currentAtBat?.[liveState.currentAtBat.length - 1];
            // Play is still in progress if the last pitch is in-play BUT the play hasn't completed yet
            const playStillInProgress = lastPitch?.isInPlay && !liveState.currentPlayComplete;
            const hasCompletedHit = hitData?.event && !playStillInProgress;
            const currentHitKey = hitData ? `${hitData.x}-${hitData.y}` : null;
            const isNewHit = currentHitKey && currentHitKey !== lastHitRef.current;
            const showBip = hasCompletedHit && (!bipCollapsed || isNewHit);
            // After BIP collapses, don't show the old at-bat's pitches — show empty zone
            const bipJustEnded = bipCollapsed && hasCompletedHit && !isNewHit;
            const showZone = liveState.currentAtBat?.length > 0 && !showBip && !bipJustEnded;

            if (showBip) return (
              <div className="lgp-bip-section">
                <Suspense fallback={<div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center", color: "#888" }}>Loading 3D viewer...</div>}>
                  <BallInPlay3D
                    hitData={hitData}
                    venueTeamId={gameInfo.home.id}
                    runnersOn={bipRunners}
                    runnerNames={bipRunnerNames}
                    outs={liveState?.outs}
                  />
                </Suspense>
              </div>
            );


            if (showZone) return (
              <div className="lgp-zone-centered lgp-zone-with-bg">
                <img src={battingTeamLogo2} alt="" className="lgp-zone-bg-logo" />
                <span className="lgp-pitch-result">
                  {(() => {
                    const p = liveState.currentAtBat[liveState.currentAtBat.length - 1];
                    const balls = p.count ? parseInt(p.count.split("-")[0]) || 0 : null;
                    const strikes = p.count ? parseInt(p.count.split("-")[1]) || 0 : null;
                    const outs = liveState.outs;
                    let countLabel = "";
                    if (p.isStrike && strikes === 3 && p.code !== "F") {
                      const soType = p.code === "C" ? "Looking" : p.code === "S" ? "Swinging" : "Called";
                      return <>{p.pitchInfo || ""} — Strikeout {soType} <span className={`lgp-out-count ${outs >= 3 ? "lgp-three-outs" : ""}`}>— {outs} Out{outs !== 1 ? "s" : ""}</span></>;
                    }
                    if (p.isBall && balls >= 4) {
                      const batterName = liveState.batter?.fullName || "";
                      return `${p.pitchInfo || ""} — Ball 4 — ${batterName} Walks`;
                    }
                    if (p.isInPlay) {
                      return `${p.pitchInfo || ""} — In Play`;
                    }
                    if (p.isBall && balls != null) countLabel = ` (${balls})`;
                    else if (p.isStrike && strikes != null && p.code !== "F") countLabel = ` (${strikes})`;
                    else if (p.code === "F" && strikes != null) countLabel = strikes >= 2 ? "" : ` (${strikes})`;
                    return `${p.pitchInfo || ""} — ${p.call}${countLabel}`;
                  })()}
                </span>
                <StrikeZone pitches={liveState.currentAtBat} />
                <div className="lgp-pitch-dots">
                  {liveState.currentAtBat.map((p, i) => {
                    const isFoul = p.code === "F";
                    const countStrikes = p.count ? parseInt(p.count.split("-")[1]) || 0 : 0;
                    const prevStrikes = i > 0 && liveState.currentAtBat[i - 1].count ? parseInt(liveState.currentAtBat[i - 1].count.split("-")[1]) || 0 : 0;
                    const foulNoAdvance = isFoul && countStrikes === prevStrikes && countStrikes >= 2;
                    const color = p.isBall ? "#22c55e" : foulNoAdvance ? "#888" : p.isInPlay ? "#3b82f6" : "#ef4444";
                    const border = foulNoAdvance ? "2px solid #ef4444" : "none";
                    return <span key={i} className="lgp-pitch-dot" style={{ background: color, border, boxSizing: "border-box" }} title={`${p.call} ${p.count || ""}`} />;
                  })}
                </div>
              </div>
            );

            // Coming Up only when the inning half actually changed (Top↔Bottom)
            if (sideJustChanged) {
              const nextUp = [liveState.batter, liveState.onDeck, liveState.inHole].filter(Boolean);
              return (
                <div className="lgp-next-up">
                  <span className="lgp-section-label">Coming Up</span>
                  <div className="lgp-next-up-list">
                    {nextUp.map((p) => {
                      const stats = [];
                      if (p.ab != null) stats.push(`${p.h || 0}-${p.ab}`);
                      if (p.hr > 0) stats.push(`${p.hr} HR`);
                      if (p.rbi > 0) stats.push(`${p.rbi} RBI`);
                      if (p.k > 0) stats.push(`${p.k} K`);
                      if (p.bb > 0) stats.push(`${p.bb} BB`);
                      if (p.hbp > 0) stats.push(`${p.hbp} HBP`);
                      return (
                        <div key={p.id} className="lgp-next-up-player sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${p.id}`)}>
                          <span className="lgp-next-up-name">{p.fullName}</span>
                          {stats.length > 0 && <span className="lgp-next-up-stats">{stats.join(", ")}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }
            // Normal between-at-bat pause — show empty zone with logo
            return (
              <div className="lgp-zone-centered lgp-zone-with-bg">
                <img src={battingTeamLogo2} alt="" className="lgp-zone-bg-logo" />
                <StrikeZone pitches={[]} />
              </div>
            );
          })()}

          {/* Pitcher — same layout as batter row */}
          {(() => {
            const pitchingTeamLogo = liveState.inningHalf === "Top" ? gameInfo.home.logoUrl : gameInfo.away.logoUrl;
            const p = liveState.pitcher;
            const gs = p.gameStats;
            const gameStatParts = [];
            if (gs) {
              gameStatParts.push(`${gs.ip} IP`);
              gameStatParts.push(`${gs.pitches} P`);
              gameStatParts.push(`${gs.k} K`);
            }
            return (
              <div className="lgp-batter-row sb-player-link" role="button" tabIndex={0} onClick={() => navigate(`/team/${teamId}/player/${p.id}`)} onKeyDown={(e) => e.key === "Enter" && navigate(`/team/${teamId}/player/${p.id}`)}>
                <div className="lgp-batter-left">
                  <img src={pitchingTeamLogo} alt="" className="lgp-batter-logo" />
                  <span className="lgp-batter-name">{p.fullName}</span>
                  {gameStatParts.length > 0 && <span className="lgp-batter-game">{gameStatParts.join(", ")}</span>}
                </div>
                <span className="lgp-batter-avg">Season ERA {gs?.era || "—"}</span>
              </div>
            );
          })()}
        </div>
      )}

      {/* ===== ZONE D: WIN PROB + DUE UP (side by side) — hide when final ===== */}
      {!isFinal && (wp || liveState?.onDeck) && (
        <div className="lgp-row-section">
          {wp && (
            <div className="lgp-wp-compact">
              <span className="lgp-section-label">Win Prob</span>
              <div className="lgp-wp-inline">
                <img src={wp.logo} alt={wp.abbr} className="lgp-wp-logo-sm" />
                <span className="lgp-wp-num">{wp.pct}%</span>
              </div>
            </div>
          )}
          {(liveState?.onDeck || liveState?.inHole) && (
            <div className="lgp-due-compact">
              <span className="lgp-section-label">Due Up</span>
              <div className="lgp-due-list">
                {[liveState.onDeck, liveState.inHole].filter(Boolean).map((p) => {
                  const stats = [];
                  if (p.ab > 0) stats.push(`${p.h}-${p.ab}`);
                  if (p.hr > 0) stats.push(`${p.hr} HR`);
                  if (p.rbi > 0) stats.push(`${p.rbi} RBI`);
                  if (p.k > 0) stats.push(`${p.k} K`);
                    if (p.bb > 0) stats.push(`${p.bb} BB`);
                    if (p.hbp > 0) stats.push(`${p.hbp} HBP`);
                  return (
                    <div key={p.id} className="lgp-due-player sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${p.id}`)}>
                      <span className="lgp-due-name">{p.fullName}</span>
                      {stats.length > 0 && <span className="lgp-due-stats">{stats.join(", ")}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== ZONE E: LINESCORE (always 9 innings) ===== */}
      {liveState?.linescore && (() => {
        const innings = liveState.linescore?.innings || [];
        const maxInn = Math.max(9, innings.length);
        const fullInnings = Array.from({ length: maxInn }, (_, i) => {
          const real = innings.find((inn) => inn.num === i + 1);
          return { num: i + 1, away: real?.away ?? "", home: real?.home ?? "" };
        });
        return (
          <div className="lgp-section">
            <div className="lgp-ls-scroll">
              <table className="live-ls-table">
                <thead>
                  <tr>
                    <th></th>
                    {fullInnings.map((inn) => <th key={inn.num}>{inn.num}</th>)}
                    <th className="live-ls-total">R</th>
                    <th className="live-ls-total">H</th>
                    <th className="live-ls-total">E</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="live-ls-team">{gameInfo.away.abbreviation}</td>
                    {fullInnings.map((inn) => <td key={inn.num} className={inn.away === "" ? "live-ls-future" : ""}>{inn.away !== "" ? inn.away : "-"}</td>)}
                    <td className="live-ls-total">{(liveState.linescore?.away || {}).runs}</td>
                    <td className="live-ls-total">{(liveState.linescore?.away || {}).hits}</td>
                    <td className="live-ls-total">{(liveState.linescore?.away || {}).errors}</td>
                  </tr>
                  <tr>
                    <td className="live-ls-team">{gameInfo.home.abbreviation}</td>
                    {fullInnings.map((inn) => <td key={inn.num} className={inn.home === "" ? "live-ls-future" : ""}>{inn.home !== "" ? inn.home : "-"}</td>)}
                    <td className="live-ls-total">{(liveState.linescore?.home || {}).runs}</td>
                    <td className="live-ls-total">{(liveState.linescore?.home || {}).hits}</td>
                    <td className="live-ls-total">{(liveState.linescore?.home || {}).errors}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ===== ZONE F: SCORING SUMMARY ===== */}
      {/* Scoring play replay overlay */}
      {replayData && (
        <div className="lgp-replay-overlay">
          <div className="lgp-replay-header">
            <span className="lgp-replay-label">REPLAY</span>
            <button className="lgp-replay-close" onClick={() => setReplayData(null)}>✕</button>
          </div>
          <Suspense fallback={<div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center", color: "#888" }}>Loading...</div>}>
            <BallInPlay3D
              key={replayKey}
              hitData={replayData}
              venueTeamId={gameInfo.home.id}
              runnersOn={{}}
              runnerNames={{ batter: replayData?.batterName || "" }}
            />
          </Suspense>
        </div>
      )}

      {/* ===== ZONE F: SCORING SUMMARY ===== */}
      {liveState?.scoringPlays?.length > 0 && (
        <div className="lgp-section">
          <span className="lgp-section-label">Scoring</span>
          <div className="live-scoring-list">
            {liveState.scoringPlays.map((p) => {
              const scoringTeamId = p.halfInning === "top" ? gameInfo.away.id : gameInfo.home.id;
              const teamColor = ALL_TEAMS[scoringTeamId]?.secondary || "var(--team-secondary)";
              return (
                <div key={`${p.inning}-${p.halfInning}-${p.awayScore}-${p.homeScore}`} className="live-scoring-play" style={{ borderColor: teamColor }}>
                  <span className="live-scoring-inn">{p.halfInning === "top" ? "\u25B2" : "\u25BC"}{p.inning}</span>
                  <span className="live-scoring-desc" dangerouslySetInnerHTML={{ __html: formatScoringDesc(p.description, p.hrDistance) }} />
                  <span className="live-scoring-score">{p.awayScore}-{p.homeScore}</span>
                  {p.hitData && (
                    <button className="lgp-replay-btn" onClick={() => { setReplayData(p.hitData); setReplayKey(k => k + 1); }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21" /></svg>
                      Replay
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== ZONE G: BOX SCORE ===== */}
      <BoxScoreSection
        boxOpen={boxOpen}
        setBoxOpen={setBoxOpen}
        boxData={boxData}
        gameInfo={gameInfo}
        teamId={teamId}
      />

      {/* ===== ZONE H: VENUE + MATCHUP ===== */}
      <div className="lgp-footer">
        <span className="lgp-venue-text">{gameInfo.venue}{gameInfo.venueLocation ? ` · ${gameInfo.venueLocation}` : ""}</span>
        <button className="lgp-matchup-btn" onClick={() => navigate(`/team/${teamId}/matchup/${gamePk}`)}>
          View Full Matchup
        </button>
      </div>
    </div>
  );
}

function StrikeZone({ pitches }) {
  const withCoords = (pitches || []).filter((p) => p.pX != null && p.pZ != null);
  const isEmpty = !withCoords.length;

  // Batter's strike zone bounds (feet) — use defaults for empty zone
  const szTop = (!isEmpty && withCoords.find((p) => p.szTop)?.szTop) || 3.4;
  const szBot = (!isEmpty && withCoords.find((p) => p.szBot)?.szBot) || 1.5;
  const szH = szTop - szBot; // zone height in feet (~1.8 ft)

  // Plate is 17 inches = 1.4167 feet wide → half = 0.7083 feet
  const HALF_PLATE = 0.7083;

  // SVG dimensions: 200x240
  // Zone rectangle: maps exactly to plate width horizontally and szTop/szBot vertically
  // Scale: 1 foot = 60 SVG units (so plate = 0.7083*2*60 = 85 SVG units wide)
  const SCALE = 60; // SVG units per foot
  const CX = 100; // center X
  const zoneW = HALF_PLATE * 2 * SCALE; // ~85
  const zoneH_svg = szH * SCALE;        // ~108

  // Zone rectangle position
  const zoneL = CX - zoneW / 2;
  const zoneR = CX + zoneW / 2;
  const zoneT = 30; // top of zone in SVG
  const zoneB = zoneT + zoneH_svg;

  // Map real coordinates to SVG
  // pX: feet from center of plate → SVG X
  const mapX = (pX) => CX + pX * SCALE;
  // pZ: feet above ground → SVG Y (inverted: higher pZ = lower SVG Y)
  const mapZ = (pZ) => zoneT + (szTop - pZ) * SCALE;

  // Fixed viewBox — ESPN-like proportions
  // ~1 foot padding on each side of zone, ~0.6 feet above/below
  // Zone takes up ~42% width, ~60% height — prominent but room for off-zone pitches
  const padSide = 1.0 * SCALE;  // 60 units = 1 foot each side
  const padTop = 0.6 * SCALE;   // 36 units above
  const padBot = 0.6 * SCALE;   // 36 units below
  const vMinX = zoneL - padSide;
  const vMaxX = zoneR + padSide;
  const vMinY = zoneT - padTop;
  const vMaxY = zoneB + padBot;

  return (
    <svg viewBox={`${vMinX} ${vMinY} ${vMaxX - vMinX} ${vMaxY - vMinY}`} className="lgp-strike-zone" preserveAspectRatio="xMidYMid meet">
      {/* Zone box */}
      <rect x={zoneL} y={zoneT} width={zoneW} height={zoneH_svg} fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" rx="2" />
      {/* Zone grid (3x3) */}
      {[1, 2].map((i) => (
        <g key={i}>
          <line x1={zoneL + zoneW * i / 3} y1={zoneT} x2={zoneL + zoneW * i / 3} y2={zoneB} stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
          <line x1={zoneL} y1={zoneT + zoneH_svg * i / 3} x2={zoneR} y2={zoneT + zoneH_svg * i / 3} stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
        </g>
      ))}

      {/* Pitch dots — clamped to viewBox so balls don't overflow */}
      {withCoords.map((p, i) => {
        const dotR = 5.5;
        const x = Math.max(vMinX + dotR + 1, Math.min(vMaxX - dotR - 1, mapX(p.pX)));
        const y = Math.max(vMinY + dotR + 1, Math.min(vMaxY - dotR - 1, mapZ(p.pZ)));
        const isFoul = p.code === "F";
        const countStrikes = p.count ? parseInt(p.count.split("-")[1]) || 0 : 0;
        const prevIdx = withCoords.indexOf(p) > 0 ? withCoords.indexOf(p) - 1 : -1;
        const prevStrikes = prevIdx >= 0 && withCoords[prevIdx].count ? parseInt(withCoords[prevIdx].count.split("-")[1]) || 0 : 0;
        const foulNoAdvance = isFoul && countStrikes === prevStrikes && countStrikes >= 2;
        const color = p.isBall ? "#22c55e" : foulNoAdvance ? "#888" : p.isInPlay ? "#3b82f6" : "#ef4444";
        const isLast = i === withCoords.length - 1;
        return (
          <g key={i}>
            <circle cx={x} cy={y} r="5.5" fill={color} opacity={isLast ? 1 : 0.7} />
            {foulNoAdvance && <circle cx={x} cy={y} r="5.5" fill="none" stroke="#ef4444" strokeWidth="1.2" opacity={isLast ? 1 : 0.7} />}
            {isLast && !foulNoAdvance && <circle cx={x} cy={y} r="5.5" fill="none" stroke="#fff" strokeWidth="1.2" opacity="0.5" />}
            <text x={x} y={y + 0.5} textAnchor="middle" fontSize="5" fill="#fff" fontWeight="700" dominantBaseline="middle">{i + 1}</text>
          </g>
        );
      })}
    </svg>
  );
}

function BoxScoreSection({ boxOpen, setBoxOpen, boxData, gameInfo, teamId }) {
  const [selectedTeam, setSelectedTeam] = useState("away");
  const [openBatter, setOpenBatter] = useState(null);
  const navigate = useNavigate();

  const teams = {
    away: { batters: boxData?.away, pitchers: boxData?.awayPitchers, abbr: gameInfo.away.abbreviation, logo: gameInfo.away.logoUrl },
    home: { batters: boxData?.home, pitchers: boxData?.homePitchers, abbr: gameInfo.home.abbreviation, logo: gameInfo.home.logoUrl },
  };
  const team = teams[selectedTeam];

  return (
    <div className="lgp-section">
      <button className="live-boxscore-toggle" onClick={() => setBoxOpen(!boxOpen)}>
        <span>{boxOpen ? "Hide Box Score" : "Box Score"}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: boxOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {boxOpen && boxData && (
        <div className="lgp-box-full">
          {/* Team selector tabs */}
          <div className="lgp-box-tabs">
            {["away", "home"].map((side) => (
              <button
                key={side}
                className={`lgp-box-tab ${selectedTeam === side ? "active" : ""}`}
                onClick={() => { setSelectedTeam(side); setOpenBatter(null); }}
              >
                <img src={teams[side].logo} alt="" className="lgp-box-tab-logo" />
                <span>{teams[side].abbr}</span>
              </button>
            ))}
          </div>

          {/* Batting header */}
          <div className="lgp-box-table-hdr">
            <span className="lgp-box-col-name">Batter</span>
            <span className="lgp-box-col-stat">AB</span>
            <span className="lgp-box-col-stat">H</span>
            <span className="lgp-box-col-stat">R</span>
            <span className="lgp-box-col-stat">RBI</span>
            <span className="lgp-box-col-stat">BB</span>
            <span className="lgp-box-col-stat">K</span>
            <span className="lgp-box-col-chev" />
          </div>

          {/* Batters */}
          {team.batters?.map((b) => {
            const isOpen = openBatter === b.id;
            const hasABs = b.atBats?.length > 0;
            const s = b.stats || {};
            return (
              <div key={b.id} className="lgp-box-batter">
                <div
                  className={`lgp-box-row-full ${hasABs ? "sb-tappable" : ""}`}
                  onClick={hasABs ? () => setOpenBatter(isOpen ? null : b.id) : undefined}
                >
                  <span className="lgp-box-col-name">
                    <span className="lgp-box-pos">{b.position}</span>
                    <span className="lgp-box-name-link" onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${b.id}`); }}>
                      {b.name}
                    </span>
                  </span>
                  <span className="lgp-box-col-stat">{s.ab ?? "—"}</span>
                  <span className="lgp-box-col-stat">{s.h ?? "—"}</span>
                  <span className="lgp-box-col-stat">{s.r ?? "—"}</span>
                  <span className="lgp-box-col-stat">{s.rbi ?? "—"}</span>
                  <span className="lgp-box-col-stat">{s.bb ?? "—"}</span>
                  <span className="lgp-box-col-stat">{s.k ?? "—"}</span>
                  <span className="lgp-box-col-chev">
                    {hasABs && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    )}
                  </span>
                </div>
                {isOpen && (
                  <div className="lgp-box-abs">
                    {b.atBats.map((ab, i) => {
                      const ord = ab.inning === 1 ? "1st" : ab.inning === 2 ? "2nd" : ab.inning === 3 ? "3rd" : `${ab.inning}th`;
                      return (
                        <div key={i} className={`lgp-box-ab ${ab.isScoring ? "lgp-box-ab-scoring" : ""}`}>
                          <span className="lgp-box-ab-inn">{ord}</span>
                          <span className="lgp-box-ab-event" dangerouslySetInnerHTML={{ __html: formatScoringDesc(ab.description || ab.shortDesc || ab.event, ab.hrDistance) }} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* Pitching header */}
          {team.pitchers?.length > 0 && (
            <>
              <div className="lgp-box-table-hdr lgp-box-pitch-hdr">
                <span className="lgp-box-col-name">Pitcher</span>
                <span className="lgp-box-col-stat">IP</span>
                <span className="lgp-box-col-stat">H</span>
                <span className="lgp-box-col-stat">R</span>
                <span className="lgp-box-col-stat">ER</span>
                <span className="lgp-box-col-stat">BB</span>
                <span className="lgp-box-col-stat">K</span>
                <span className="lgp-box-col-chev" />
              </div>
              {team.pitchers.map((p) => {
                const s = p.stats || {};
                return (
                  <div key={p.id} className="lgp-box-row-full">
                    <span className="lgp-box-col-name">
                      <span className="lgp-box-name-link" onClick={() => navigate(`/team/${teamId}/player/${p.id}`)}>
                        {p.name}
                      </span>
                    </span>
                    <span className="lgp-box-col-stat">{s.ip ?? "—"}</span>
                    <span className="lgp-box-col-stat">{s.h ?? "—"}</span>
                    <span className="lgp-box-col-stat">{s.r ?? "—"}</span>
                    <span className="lgp-box-col-stat">{s.er ?? "—"}</span>
                    <span className="lgp-box-col-stat">{s.bb ?? "—"}</span>
                    <span className="lgp-box-col-stat">{s.k ?? "—"}</span>
                    <span className="lgp-box-col-chev" />
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
