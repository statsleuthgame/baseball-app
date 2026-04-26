import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTeam } from "../../context/TeamContext";
import { fetchLiveGameState, fetchGameDetail, fetchWinProbability, fetchAllGamesToday } from "../../api/client";
import { lastName, teamDisplayName } from "../../utils/formatters";
import { useIsMobile } from "../../utils/useIsMobile";
import ALL_TEAMS from "../../data/teams";
import { lazy, Suspense } from "react";
const BallInPlay3D = lazy(() => import("../ballflight3d/BallInPlay3D"));
import PlayerPhoto from "../common/PlayerPhoto";
import LoadingSpinner from "../common/LoadingSpinner";

// Extract a short pitch-type abbreviation (FB, SL, CB, etc.) from pitchInfo text.
function pitchTypeAbbr(pitchInfo) {
  if (!pitchInfo) return "";
  const s = pitchInfo.toLowerCase();
  if (s.includes("4-seam") || (s.includes("fastball") && !s.includes("cut") && !s.includes("split"))) return "FB";
  if (s.includes("sinker") || s.includes("2-seam")) return "SI";
  if (s.includes("cutter")) return "CT";
  if (s.includes("sweeper") || s.includes("slurve")) return "SW";
  if (s.includes("slider")) return "SL";
  if (s.includes("curveball") || s.includes("curve")) return "CB";
  if (s.includes("knuckle-curve") || s.includes("knuckle curve")) return "KC";
  if (s.includes("knuckle")) return "KN";
  if (s.includes("changeup") || s.includes("change-up") || s.includes("change up")) return "CH";
  if (s.includes("split") || s.includes("forkball")) return "SP";
  if (s.includes("eephus")) return "EP";
  return "";
}

function pitchVelo(pitchInfo) {
  if (!pitchInfo) return null;
  const m = pitchInfo.match(/([\d.]+)\s*mph/i);
  return m ? Math.round(parseFloat(m[1])) : null;
}

// Bold hit types and add HR distance in scoring descriptions.
// Returns an array of React nodes — no dangerouslySetInnerHTML needed.
function formatScoringDesc(desc, hrDistance) {
  if (!desc) return null;
  let working = desc;
  if (hrDistance && /\bhomers\b/i.test(working)) {
    working = working.replace(/\b(homers)\b/i, `$1 (${hrDistance} ft)`);
  }
  const pattern = /\b(singles|doubles|triples|homers|walks|hit by pitch|grand slam|sacrifice fly|sac fly)\b/gi;
  const parts = [];
  let lastIndex = 0;
  let match;
  let key = 0;
  while ((match = pattern.exec(working)) !== null) {
    if (match.index > lastIndex) parts.push(working.slice(lastIndex, match.index));
    parts.push(<strong key={key++}>{match[0]}</strong>);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < working.length) parts.push(working.slice(lastIndex));
  return parts.length ? parts : working;
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
        gamePk: g.gamePk, gameDate: g.gameDate, status: g.status?.detailedState === "Game Over" ? "Final" : (g.status?.detailedState || ""),
        venue: g.venue?.name || "", venueId: g.venue?.id,
        venueLocation: g.venue?.location ? `${g.venue.location.city}, ${g.venue.location.stateAbbrev}` : "",
        away: { id: away.team?.id, abbreviation: away.team?.abbreviation || "", score: away.score, logoUrl: `https://www.mlbstatic.com/team-logos/team-cap-on-dark/${away.team?.id}.svg` },
        home: { id: home.team?.id, abbreviation: home.team?.abbreviation || "", score: home.score, logoUrl: `https://www.mlbstatic.com/team-logos/team-cap-on-dark/${home.team?.id}.svg` },
      };
    },
    enabled: !!gamePk, staleTime: 1000 * 30, refetchInterval: 1000 * 30,
  });

  const gameIsFinal = gameInfo?.status === "Final";

  const { data: liveState, dataUpdatedAt } = useQuery({
    queryKey: ["liveGameState", gamePk],
    queryFn: () => fetchLiveGameState(gamePk),
    enabled: !!gamePk, staleTime: gameIsFinal ? Infinity : 1000 * 5, refetchInterval: gameIsFinal ? false : 1000 * 5,
  });

  const { data: wpData } = useQuery({
    queryKey: ["winProb", gamePk],
    queryFn: () => fetchWinProbability(gamePk),
    enabled: !!gamePk, staleTime: gameIsFinal ? Infinity : 1000 * 30, refetchInterval: gameIsFinal ? false : 1000 * 30,
  });

  // All live games for game switcher strip
  const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })();
  const { data: allGames } = useQuery({
    queryKey: ["allGamesToday", todayStr],
    queryFn: () => fetchAllGamesToday(todayStr),
    staleTime: 1000 * 60, refetchInterval: 1000 * 30,
  });
  const liveGames = (allGames || [])
    .filter(g => ["In Progress", "Warmup", "Delayed", "Delayed Start"].includes(g.status))
    .sort((a, b) => {
      // Sort by games closest to finishing: higher inning first, bottom before top
      const innA = (a.inning || 0) * 2 + (a.inningHalf === "Bottom" ? 1 : 0);
      const innB = (b.inning || 0) * 2 + (b.inningHalf === "Bottom" ? 1 : 0);
      return innB - innA;
    });

  // Default the box score open on desktop, collapsed on mobile. Lazy-init so
  // it picks up the viewport width on first render (the AppShell remounts
  // LiveGamePage on each gamePk change via ErrorBoundary's key, so this fires
  // every time the user navigates to a different game).
  const [boxOpen, setBoxOpen] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return !window.matchMedia("(max-width: 640px)").matches;
  });
  const [replayData, setReplayData] = useState(null); // scoring play hit data for replay
  const [replayKey, setReplayKey] = useState(0);
  // Fetch box data when the user opens the toggle, OR when the wide-desktop
  // Final layout forces both team boxes visible (FinalTeamBox needs boxData
  // unconditionally). Keep refetch tied to boxOpen so we don't poll when the
  // user isn't actively looking at it.
  const isFinalStatus = gameInfo?.status === "Final";
  const { data: boxData } = useQuery({
    queryKey: ["gameDetail", gamePk],
    queryFn: () => fetchGameDetail(gamePk),
    enabled: (boxOpen || isFinalStatus) && !!gamePk,
    staleTime: 1000 * 60,
    refetchInterval: boxOpen ? 1000 * 30 : false,
  });

  // === BIP state model ===
  // activeBipHit is the ONLY signal that shows the 3D viewer. It is set to a
  // snapshot of the hit at the moment we detect a fresh hit during polling,
  // and cleared after ~12s / on batter change / on game switch. It is NEVER
  // populated from the initial liveState read, so pre-existing hits in the
  // game (which liveState.lastHitData always contains) can't flash the BIP
  // on refresh or navigation.
  const [activeBipHit, setActiveBipHit] = useState(null);
  const bipTimerRef = useRef(null);
  const lastHitRef = useRef(null);
  // Pre-play runner snapshot for the 3D animation
  const prevRunnersRef = useRef({ first: false, second: false, third: false });
  const prevRunnerNamesRef = useRef({});
  const lastBatterIdRef = useRef(null);

  // Sticky at-bat cache — preserves the last non-empty pitch list for the current
  // batter so the strike zone doesn't flicker if the API momentarily returns an
  // empty currentAtBat between polls (seen during AB transitions).
  const [stickyAtBat, setStickyAtBat] = useState({ batterId: null, pitches: [] });

  // Track side changes (Top↔Bottom) to show "Coming Up" only during transitions
  const [sideJustChanged, setSideJustChanged] = useState(false);
  const prevHalfRef = useRef(null);
  const sideTimerRef = useRef(null);

  // On first mount for a given game, record the current hit key without triggering BIP
  const initializedRef = useRef(false);

  const clearBip = () => {
    setActiveBipHit(null);
    if (bipTimerRef.current) { clearTimeout(bipTimerRef.current); bipTimerRef.current = null; }
  };

  // Reset everything when switching between games (same LiveGamePage route,
  // different gamePk — refs otherwise persist across the nav)
  useEffect(() => {
    initializedRef.current = false;
    lastHitRef.current = null;
    lastBatterIdRef.current = null;
    prevRunnersRef.current = { first: false, second: false, third: false };
    prevRunnerNamesRef.current = {};
    prevHalfRef.current = null;
    setActiveBipHit(null);
    setSideJustChanged(false);
    setStickyAtBat({ batterId: null, pitches: [] });
    if (bipTimerRef.current) { clearTimeout(bipTimerRef.current); bipTimerRef.current = null; }
    if (sideTimerRef.current) { clearTimeout(sideTimerRef.current); sideTimerRef.current = null; }
  }, [gamePk]);

  // Keep stickyAtBat in sync with liveState — only shrink it when the batter changes
  useEffect(() => {
    const bid = liveState?.batter?.id;
    if (!bid) return;
    const pitches = liveState?.currentAtBat || [];
    setStickyAtBat((prev) => {
      if (prev.batterId !== bid) return { batterId: bid, pitches };
      if (pitches.length >= prev.pitches.length) return { batterId: bid, pitches };
      return prev;
    });
  }, [liveState?.currentAtBat, liveState?.batter?.id]);

  // Clear any active BIP as soon as a new batter steps up
  useEffect(() => {
    const id = liveState?.batter?.id;
    if (!id) return;
    if (lastBatterIdRef.current && id !== lastBatterIdRef.current) {
      clearBip();
    }
    lastBatterIdRef.current = id;
  }, [liveState?.batter?.id]);

  // Hit detection — only fires activeBipHit for hits detected AFTER the game was opened
  useEffect(() => {
    const hit = liveState?.lastHitData;
    const hitKey = hit ? `${hit.batterName || ""}|${hit.event || ""}|${hit.x}|${hit.y}` : null;

    // First poll for this game: record the hit key but DO NOT trigger BIP.
    // This guarantees stale game state (any hit that occurred before the user
    // opened the page) is never replayed.
    if (!initializedRef.current) {
      initializedRef.current = true;
      if (hitKey) lastHitRef.current = hitKey;
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
      return;
    }

    if (hitKey && hitKey !== lastHitRef.current) {
      lastHitRef.current = hitKey;
      setActiveBipHit({
        hitData: hit,
        runners: { ...prevRunnersRef.current },
        runnerNames: {
          ...prevRunnerNamesRef.current,
          batter: hit?.batterName || liveState?.batter?.fullName || "",
        },
      });
      if (bipTimerRef.current) clearTimeout(bipTimerRef.current);
      bipTimerRef.current = setTimeout(() => setActiveBipHit(null), 12000);
    }

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
  }, [liveState?.lastHitData, liveState?.onFirst, liveState?.onSecond, liveState?.onThird]);

  // Detect inning half changes
  useEffect(() => {
    if (!liveState?.inningHalf) return;
    const currentHalf = `${liveState.inning}-${liveState.inningHalf}`;
    if (prevHalfRef.current && prevHalfRef.current !== currentHalf) {
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

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      if (bipTimerRef.current) clearTimeout(bipTimerRef.current);
      if (sideTimerRef.current) clearTimeout(sideTimerRef.current);
    };
  }, []);

  const isLive = gameInfo ? ["In Progress", "Warmup", "Delayed Start", "Delayed"].includes(gameInfo.status) : false;
  const isFinal = gameInfo?.status === "Final";
  // Wide desktop layout kicks in at ≥1024px (matches .app-content--wide in CSS).
  const isWide = useIsMobile("(min-width: 1024px)");

  if (isLoading) return <LoadingSpinner text="Loading game..." />;
  if (!gameInfo) return <div className="matchup-empty"><h2>Game not found</h2></div>;

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
      {/* Game switcher strip — between nav and hero, only when 2+ live games */}
      {liveGames.length >= 2 && (
        <div className="lgp-game-strip">
          {liveGames.map(g => {
            const half = g.inningHalf === "Top" ? "T" : g.inningHalf === "Bottom" ? "B" : "";
            return (
              <button
                key={g.gamePk}
                className={`lgp-game-pill${String(g.gamePk) === String(gamePk) ? " active" : ""}`}
                onClick={() => navigate(`/team/${teamId}/live/${g.gamePk}`)}
              >
                <span className="lgp-pill-teams">{g.away.abbreviation} {g.away.score ?? 0}</span>
                <span className="lgp-pill-at">@</span>
                <span className="lgp-pill-teams">{g.home.abbreviation} {g.home.score ?? 0}</span>
                {g.inning && <span className="lgp-pill-inning">· {half}{g.inning}</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* ===== HERO HUD ===== */}
      <div className={`lgp-hero-hud${isFinal ? " lgp-hero-hud--final" : ""}`}>
        <button className="lgp-hud-back" onClick={() => navigate(-1)} aria-label="Go back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <div className="lgp-hud-top-right">
          {isLive && (
            <span className="lgp-hud-live-pill">
              <span key={dataUpdatedAt} className="lgp-hud-live-dot" />
              LIVE
            </span>
          )}
        </div>
        {isFinal && (
          <div className="lgp-hud-final-tag">FINAL{liveState?.linescore?.innings?.length > 9 ? ` / ${liveState.linescore.innings.length}` : ""}</div>
        )}
        <div className="lgp-hud-scores">
          <div className="lgp-hud-team">
            <img src={gameInfo.away.logoUrl} alt={gameInfo.away.abbreviation} className="lgp-hud-logo" />
            <span className="lgp-hud-abbr">{gameInfo.away.abbreviation}</span>
          </div>
          <span className="lgp-hud-score">{liveState?.linescore?.away?.runs ?? gameInfo.away.score ?? 0}</span>
          <span className="lgp-hud-dash">—</span>
          <span className="lgp-hud-score">{liveState?.linescore?.home?.runs ?? gameInfo.home.score ?? 0}</span>
          <div className="lgp-hud-team lgp-hud-team-right">
            <span className="lgp-hud-abbr">{gameInfo.home.abbreviation}</span>
            <img src={gameInfo.home.logoUrl} alt={gameInfo.home.abbreviation} className="lgp-hud-logo" />
          </div>
        </div>

        {isLive && liveState && (
          <div className="lgp-hud-state">
            <span className="lgp-hud-state-chunk">
              <span className="lgp-hud-state-label">{liveState.inningHalf === "Top" ? "TOP" : "BOT"}</span>
              <span className="lgp-hud-state-value">{liveState.inning}</span>
            </span>
            <span className="lgp-hud-state-sep">·</span>
            <span className="lgp-hud-state-chunk">
              <span className="lgp-hud-state-label">OUT</span>
              <span className="lgp-hud-state-value">{liveState.outs}</span>
            </span>
            <span className="lgp-hud-state-sep">·</span>
            <span className="lgp-hud-state-chunk">
              <span className="lgp-hud-state-label">COUNT</span>
              <span className="lgp-hud-state-value">{liveState.balls}-{liveState.strikes}</span>
            </span>
          </div>
        )}

        {isLive && liveState && (
          <div className="lgp-hud-bases">
            <svg className="lgp-hud-diamond" width="56" height="56" viewBox="-2 -2 60 60">
              <rect x="18" y="2" width="12" height="12" rx="1.5" transform="rotate(45 24 8)" className={`lgp-hud-base ${liveState.onSecond ? "on" : ""}`} />
              <rect x="32" y="16" width="12" height="12" rx="1.5" transform="rotate(45 38 22)" className={`lgp-hud-base ${liveState.onFirst ? "on" : ""}`} />
              <rect x="4" y="16" width="12" height="12" rx="1.5" transform="rotate(45 10 22)" className={`lgp-hud-base ${liveState.onThird ? "on" : ""}`} />
              <circle cx="24" cy="36" r="2.5" fill="var(--text-muted)" opacity="0.3" />
            </svg>
            <div className="lgp-hud-runners">
              {(liveState.runnerThird || liveState.runnerSecond || liveState.runnerFirst) ? (
                <>
                  {liveState.runnerThird && (
                    <span className="lgp-hud-runner-chip">
                      <span className="lgp-hud-runner-base">3B</span>
                      {lastName(liveState.runnerThird.fullName)}
                    </span>
                  )}
                  {liveState.runnerSecond && (
                    <span className="lgp-hud-runner-chip">
                      <span className="lgp-hud-runner-base">2B</span>
                      {lastName(liveState.runnerSecond.fullName)}
                    </span>
                  )}
                  {liveState.runnerFirst && (
                    <span className="lgp-hud-runner-chip">
                      <span className="lgp-hud-runner-base">1B</span>
                      {lastName(liveState.runnerFirst.fullName)}
                    </span>
                  )}
                </>
              ) : (
                <span className="lgp-hud-bases-empty">Bases empty</span>
              )}
            </div>
          </div>
        )}

      </div>

      {isFinal && isWide ? (
        <div className="lgp-body lgp-body--final">
          {/* Full-width linescore directly under the HUD */}
          {liveState?.linescore && (() => {
            const innings = liveState.linescore?.innings || [];
            const maxInn = Math.max(9, innings.length);
            const fullInnings = Array.from({ length: maxInn }, (_, i) => {
              const real = innings.find((inn) => inn.num === i + 1);
              return { num: i + 1, away: real?.away ?? "", home: real?.home ?? "" };
            });
            return (
              <div className="lgp-section lgp-final-linescore">
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

          {/* Split box scores — away on left, home on right */}
          {boxData && (
            <>
              <FinalTeamBox
                className="lgp-final-box-away"
                teamInfo={gameInfo.away}
                score={liveState?.linescore?.away?.runs ?? gameInfo.away.score}
                batters={boxData.away}
                pitchers={boxData.awayPitchers}
                teamId={teamId}
                navigate={navigate}
              />
              <FinalTeamBox
                className="lgp-final-box-home"
                teamInfo={gameInfo.home}
                score={liveState?.linescore?.home?.runs ?? gameInfo.home.score}
                batters={boxData.home}
                pitchers={boxData.homePitchers}
                teamId={teamId}
                navigate={navigate}
              />
            </>
          )}

          {/* Full-width scoring summary */}
          {liveState?.scoringPlays?.length > 0 && (
            <div className="lgp-section lgp-final-scoring">
              <span className="lgp-section-label">Scoring</span>
              <div className="live-scoring-list">
                {liveState.scoringPlays.map((p) => {
                  const scoringTeamId = p.halfInning === "top" ? gameInfo.away.id : gameInfo.home.id;
                  const teamColor = ALL_TEAMS[scoringTeamId]?.primary || "var(--team-secondary)";
                  const hd = p.hitData;
                  const isHR = (p.event && p.event.toLowerCase().includes("home run")) || (hd?.event && hd.event.toLowerCase().includes("home run"));
                  const metrics = [];
                  if (isHR) {
                    if (hd?.exitVelo) metrics.push(`${Math.round(hd.exitVelo * 10) / 10} MPH`);
                    if (hd?.distance) metrics.push(`${Math.round(hd.distance)} FT`);
                    if (hd?.launchAngle != null) metrics.push(`${Math.round(hd.launchAngle)}° LA`);
                  }
                  return (
                    <div
                      key={`${p.inning}-${p.halfInning}-${p.awayScore}-${p.homeScore}`}
                      className="lgp-scoring-card"
                      style={{ "--card-color": teamColor }}
                    >
                      <div className="lgp-scoring-top">
                        <span className="lgp-scoring-inning-chip">{p.halfInning === "top" ? "T" : "B"}{p.inning}</span>
                        <span className="lgp-scoring-desc">{formatScoringDesc(p.description, p.hrDistance)}</span>
                        <span className="lgp-scoring-score-box">{p.awayScore}<span>–</span>{p.homeScore}</span>
                      </div>
                      {metrics.length > 0 && (
                        <div className="lgp-scoring-metrics">
                          {metrics.map((m, i) => (
                            <span key={i} className="lgp-scoring-metric">{m}</span>
                          ))}
                        </div>
                      )}
                      {hd && (
                        <button className="lgp-scoring-replay" onClick={() => { setReplayData(p); setReplayKey(k => k + 1); }}>
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

          {/* Full-width footer (venue + weather + matchup link) */}
          {(() => {
            const ag = allGames?.find(g => String(g.gamePk) === String(gamePk));
            const weather = ag?.weather;
            return (
              <div className="lgp-footer lgp-final-footer">
                <div className="lgp-footer-info">
                  <span className="lgp-venue-text">{gameInfo.venue}{gameInfo.venueLocation ? ` · ${gameInfo.venueLocation}` : ""}</span>
                  {weather && (weather.condition || weather.temp) && (
                    <span className="lgp-weather-text">
                      {weather.condition || ""}
                      {weather.temp != null && ` · ${weather.temp}°F`}
                      {weather.wind ? ` · ${weather.wind}` : ""}
                    </span>
                  )}
                </div>
                <button className="lgp-matchup-btn" onClick={() => navigate(`/team/${teamId}/matchup/${gamePk}`)}>
                  View Full Matchup
                </button>
              </div>
            );
          })()}

          {/* Replay overlay (fixed-positioned; DOM location doesn't matter) */}
          {replayData && (
            <div className="lgp-replay-overlay">
              <div className="lgp-replay-header">
                <span className="lgp-replay-label">REPLAY</span>
                <button className="lgp-replay-close" onClick={() => setReplayData(null)}>✕</button>
              </div>
              <Suspense fallback={<div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center", color: "#888" }}>Loading...</div>}>
                <BallInPlay3D
                  key={replayKey}
                  hitData={replayData.hitData}
                  venueTeamId={gameInfo.home.id}
                  runnersOn={replayData.runnersOn || {}}
                  runnerNames={{ ...(replayData.runnerNames || {}), batter: replayData.hitData?.batterName || "" }}
                />
              </Suspense>
            </div>
          )}
        </div>
      ) : (
      <div className="lgp-body lgp-body--split">
      <div className="lgp-body-left">

      {/* ===== ZONE B+C: AT-BAT + VISUAL (combined) — hide when game is final ===== */}
      {!isFinal && liveState?.batter && liveState?.pitcher && (
        <div className="lgp-section lgp-area-matchup">
          {/* Matchup cards: Batter (batting team color) | Pitcher (pitching team color) */}
          {(() => {
            const battingTeamId = liveState.inningHalf === "Top" ? gameInfo.away.id : gameInfo.home.id;
            const pitchingTeamId = liveState.inningHalf === "Top" ? gameInfo.home.id : gameInfo.away.id;
            const battingLogo = liveState.inningHalf === "Top" ? gameInfo.away.logoUrl : gameInfo.home.logoUrl;
            const pitchingLogo = liveState.inningHalf === "Top" ? gameInfo.home.logoUrl : gameInfo.away.logoUrl;
            const battingColor = ALL_TEAMS[battingTeamId]?.primary || "var(--team-secondary)";
            const pitchingColor = ALL_TEAMS[pitchingTeamId]?.primary || "var(--team-secondary)";

            return (
              <div className="lgp-matchup-cards">
                <BatterCard batter={liveState.batter} teamColor={battingColor} teamLogo={battingLogo} teamId={teamId} navigate={navigate} />
                <PitcherCard pitcher={liveState.pitcher} teamColor={pitchingColor} teamLogo={pitchingLogo} teamId={teamId} navigate={navigate} />
              </div>
            );
          })()}

          {/* Visual area: strike zone / ball-in-play / next up (framed as a broadcast feature) */}
          {(() => {
            const battingTeamLogo2 = liveState.inningHalf === "Top" ? gameInfo.away.logoUrl : gameInfo.home.logoUrl;
            const showBip = !!activeBipHit;
            const pitchesForZone = stickyAtBat.batterId === liveState.batter?.id ? stickyAtBat.pitches : (liveState.currentAtBat || []);
            const showZone = pitchesForZone.length > 0 && !showBip;

            const halfLabel = liveState.inningHalf === "Top" ? "TOP" : "BOT";
            const frameHeader = (label) => (
              <div className="lgp-feature-header">
                <span className="lgp-feature-label">{label}</span>
                {liveState.inning != null && (
                  <>
                    <span className="lgp-feature-sep">·</span>
                    <span className="lgp-feature-inning">{halfLabel} {liveState.inning}</span>
                  </>
                )}
              </div>
            );

            if (showBip) return (
              <div className="lgp-feature lgp-feature-bip">
                {frameHeader("Last Play")}
                <div className="lgp-bip-section">
                  <Suspense fallback={<div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center", color: "#888" }}>Loading 3D viewer...</div>}>
                    <BallInPlay3D
                      hitData={activeBipHit.hitData}
                      venueTeamId={gameInfo.home.id}
                      runnersOn={activeBipHit.runners}
                      runnerNames={activeBipHit.runnerNames}
                      outs={liveState?.outs}
                    />
                  </Suspense>
                </div>
              </div>
            );

            if (showZone) return (
              <div className="lgp-feature lgp-feature-zone">
                {frameHeader("At Bat")}
                <div className="lgp-zone-centered lgp-zone-with-bg">
                  <img src={battingTeamLogo2} alt="" className="lgp-zone-bg-logo" />
                  <span className="lgp-pitch-result">
                    {(() => {
                      const p = pitchesForZone[pitchesForZone.length - 1];
                      if (!p) return <>&nbsp;</>;
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
                  <StrikeZone pitches={pitchesForZone} />
                  <div className="lgp-pitch-legend">
                    <span className="lgp-legend-item"><span className="lgp-legend-dot" style={{ background: "#22c55e" }} /> Ball</span>
                    <span className="lgp-legend-item"><span className="lgp-legend-dot" style={{ background: "#ef4444" }} /> Strike</span>
                    <span className="lgp-legend-item"><span className="lgp-legend-dot" style={{ background: "#888", border: "1.5px solid #ef4444" }} /> Foul</span>
                    <span className="lgp-legend-item"><span className="lgp-legend-dot" style={{ background: "#3b82f6" }} /> In Play</span>
                  </div>
                </div>
              </div>
            );

            // Coming Up only when the inning half actually changed (Top↔Bottom)
            if (sideJustChanged) {
              const nextUp = [liveState.batter, liveState.onDeck, liveState.inHole].filter(Boolean);
              return (
                <div className="lgp-feature lgp-feature-comingup">
                  {frameHeader("Coming Up")}
                  <div className="lgp-next-up">
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
                </div>
              );
            }

            // Normal between-at-bat pause — empty zone with logo (legend always rendered to prevent layout shift)
            return (
              <div className="lgp-feature lgp-feature-zone">
                {frameHeader("At Bat")}
                <div className="lgp-zone-centered lgp-zone-with-bg">
                  <img src={battingTeamLogo2} alt="" className="lgp-zone-bg-logo" />
                  <span className="lgp-pitch-result">&nbsp;</span>
                  <StrikeZone pitches={[]} />
                  <div className="lgp-pitch-legend">
                    <span className="lgp-legend-item"><span className="lgp-legend-dot" style={{ background: "#22c55e" }} /> Ball</span>
                    <span className="lgp-legend-item"><span className="lgp-legend-dot" style={{ background: "#ef4444" }} /> Strike</span>
                    <span className="lgp-legend-item"><span className="lgp-legend-dot" style={{ background: "#888", border: "1.5px solid #ef4444" }} /> Foul</span>
                    <span className="lgp-legend-item"><span className="lgp-legend-dot" style={{ background: "#3b82f6" }} /> In Play</span>
                  </div>
                </div>
              </div>
            );
          })()}

        </div>
      )}

      {/* ===== DUE UP (centered) ===== */}
      {!isFinal && (liveState?.onDeck || liveState?.inHole) && (
        <div className="lgp-due-strip lgp-area-dueup">
          <span className="lgp-due-strip-label">Due Up</span>
          <div className="lgp-due-strip-list">
            {[liveState.onDeck, liveState.inHole].filter(Boolean).map((p) => {
              const stats = [];
              if (p.ab > 0) stats.push(`${p.h}-${p.ab}`);
              if (p.hr > 0) stats.push(`${p.hr} HR`);
              if (p.rbi > 0) stats.push(`${p.rbi} RBI`);
              return (
                <div key={p.id} className="lgp-due-strip-player sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${p.id}`)}>
                  <PlayerPhoto playerId={p.id} name={p.fullName} size={26} className="lgp-due-strip-photo" />
                  <span className="lgp-due-strip-name">{p.fullName}</span>
                  {stats.length > 0 && <span className="lgp-due-strip-stats">{stats.join(" · ")}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      </div>
      <div className="lgp-body-right">

      {/* ===== LINESCORE ===== */}
      {liveState?.linescore && (() => {
        const innings = liveState.linescore?.innings || [];
        const maxInn = Math.max(9, innings.length);
        const fullInnings = Array.from({ length: maxInn }, (_, i) => {
          const real = innings.find((inn) => inn.num === i + 1);
          return { num: i + 1, away: real?.away ?? "", home: real?.home ?? "" };
        });
        return (
          <div className="lgp-section lgp-area-linescore">
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
              hitData={replayData.hitData}
              venueTeamId={gameInfo.home.id}
              runnersOn={replayData.runnersOn || {}}
              runnerNames={{ ...(replayData.runnerNames || {}), batter: replayData.hitData?.batterName || "" }}
            />
          </Suspense>
        </div>
      )}

      {/* ===== BOX SCORE (collapsed by default, opens on tap) ===== */}
      <div className="lgp-area-box">
        <BoxScoreSection
          boxOpen={boxOpen}
          setBoxOpen={setBoxOpen}
          boxData={boxData}
          gameInfo={gameInfo}
          teamId={teamId}
        />
      </div>

      {/* ===== SCORING SUMMARY — rich cards with hit metrics chyron ===== */}
      {liveState?.scoringPlays?.length > 0 && (
        <div className="lgp-section lgp-area-scoring">
          <span className="lgp-section-label">Scoring</span>
          <div className="live-scoring-list">
            {liveState.scoringPlays.map((p) => {
              const scoringTeamId = p.halfInning === "top" ? gameInfo.away.id : gameInfo.home.id;
              const teamColor = ALL_TEAMS[scoringTeamId]?.primary || "var(--team-secondary)";
              const hd = p.hitData;
              const isHR = (p.event && p.event.toLowerCase().includes("home run")) || (hd?.event && hd.event.toLowerCase().includes("home run"));
              const metrics = [];
              if (isHR) {
                if (hd?.exitVelo) metrics.push(`${Math.round(hd.exitVelo * 10) / 10} MPH`);
                if (hd?.distance) metrics.push(`${Math.round(hd.distance)} FT`);
                if (hd?.launchAngle != null) metrics.push(`${Math.round(hd.launchAngle)}° LA`);
              }
              return (
                <div
                  key={`${p.inning}-${p.halfInning}-${p.awayScore}-${p.homeScore}`}
                  className="lgp-scoring-card"
                  style={{ "--card-color": teamColor }}
                >
                  <div className="lgp-scoring-top">
                    <span className="lgp-scoring-inning-chip">{p.halfInning === "top" ? "T" : "B"}{p.inning}</span>
                    <span className="lgp-scoring-desc">{formatScoringDesc(p.description, p.hrDistance)}</span>
                    <span className="lgp-scoring-score-box">{p.awayScore}<span>–</span>{p.homeScore}</span>
                  </div>
                  {metrics.length > 0 && (
                    <div className="lgp-scoring-metrics">
                      {metrics.map((m, i) => (
                        <span key={i} className="lgp-scoring-metric">{m}</span>
                      ))}
                    </div>
                  )}
                  {hd && (
                    <button className="lgp-scoring-replay" onClick={() => { setReplayData(p); setReplayKey(k => k + 1); }}>
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

      {/* ===== ZONE H: VENUE + WEATHER + MATCHUP ===== */}
      {(() => {
        const ag = allGames?.find(g => String(g.gamePk) === String(gamePk));
        const weather = ag?.weather;
        return (
          <div className="lgp-footer lgp-area-footer">
            <div className="lgp-footer-info">
              <span className="lgp-venue-text">{gameInfo.venue}{gameInfo.venueLocation ? ` · ${gameInfo.venueLocation}` : ""}</span>
              {weather && (weather.condition || weather.temp) && (
                <span className="lgp-weather-text">
                  {weather.condition || ""}
                  {weather.temp != null && ` · ${weather.temp}°F`}
                  {weather.wind ? ` · ${weather.wind}` : ""}
                </span>
              )}
            </div>
            <button className="lgp-matchup-btn" onClick={() => navigate(`/team/${teamId}/matchup/${gamePk}`)}>
              View Full Matchup
            </button>
          </div>
        );
      })()}
      </div>
      </div>
      )}
    </div>
  );
}

function TopPerformersStrip({ teams, navigate, teamId }) {
  const scoreBatter = (s) => (s.h || 0) * 2 + (s.hr || 0) * 4 + (s.rbi || 0) * 2 + (s.r || 0);
  const ipToOuts = (ip) => {
    if (ip == null) return 0;
    const [inn = "0", part = "0"] = String(ip).split(".");
    return (parseInt(inn) || 0) * 3 + (parseInt(part) || 0);
  };
  const scorePitcher = (s) => {
    const outs = ipToOuts(s.ip);
    if (outs < 3) return -Infinity;
    return (s.k || 0) * 1.5 - (s.er || 0) * 3 - (s.bb || 0) + outs * 0.4;
  };

  const pickBatter = (list) => {
    if (!list?.length) return null;
    let best = null, bestScore = 0;
    for (const b of list) {
      const sc = scoreBatter(b.stats || {});
      if (sc > bestScore) { bestScore = sc; best = b; }
    }
    return bestScore > 0 ? best : null;
  };
  const pickPitcher = (list) => {
    if (!list?.length) return null;
    let best = null, bestScore = -Infinity;
    for (const p of list) {
      const sc = scorePitcher(p.stats || {});
      if (sc > bestScore) { bestScore = sc; best = p; }
    }
    return bestScore > -Infinity ? best : null;
  };

  const awayBatter = pickBatter(teams.away.batters);
  const homeBatter = pickBatter(teams.home.batters);
  const awayPitcher = pickPitcher(teams.away.pitchers);
  const homePitcher = pickPitcher(teams.home.pitchers);

  const items = [];
  if (awayBatter) {
    const s = awayBatter.stats;
    items.push({ team: teams.away.abbr, logo: teams.away.logo, role: "Batting", player: awayBatter, line: `${s.h}-for-${s.ab}${s.hr ? `, ${s.hr} HR` : ""}${s.rbi ? `, ${s.rbi} RBI` : ""}` });
  }
  if (homeBatter) {
    const s = homeBatter.stats;
    items.push({ team: teams.home.abbr, logo: teams.home.logo, role: "Batting", player: homeBatter, line: `${s.h}-for-${s.ab}${s.hr ? `, ${s.hr} HR` : ""}${s.rbi ? `, ${s.rbi} RBI` : ""}` });
  }
  if (awayPitcher) {
    const s = awayPitcher.stats;
    items.push({ team: teams.away.abbr, logo: teams.away.logo, role: "Pitching", player: awayPitcher, line: `${s.ip} IP, ${s.er ?? 0} ER, ${s.k ?? 0} K` });
  }
  if (homePitcher) {
    const s = homePitcher.stats;
    items.push({ team: teams.home.abbr, logo: teams.home.logo, role: "Pitching", player: homePitcher, line: `${s.ip} IP, ${s.er ?? 0} ER, ${s.k ?? 0} K` });
  }

  if (!items.length) return null;

  return (
    <div className="lgp-top-performers">
      <span className="lgp-section-label">Top Performers</span>
      <div className="lgp-tp-grid">
        {items.map((it, i) => (
          <div key={i} className="lgp-tp-item sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${it.player.id}`)}>
            <div className="lgp-tp-head">
              <img src={it.logo} alt="" className="lgp-tp-logo" />
              <span className="lgp-tp-role">{it.role}</span>
            </div>
            <span className="lgp-tp-name">{it.player.name}</span>
            <span className="lgp-tp-line">{it.line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BatterCard({ batter, teamColor, teamLogo, teamId, navigate }) {
  const b = batter;
  const today = [];
  if (b.ab != null) today.push(`${b.h || 0}-for-${b.ab}`);
  if (b.hr > 0) today.push(`${b.hr} HR`);
  if (b.rbi > 0) today.push(`${b.rbi} RBI`);
  if (b.k > 0) today.push(`${b.k} K`);
  if (b.bb > 0) today.push(`${b.bb} BB`);
  if (b.hbp > 0) today.push(`${b.hbp} HBP`);

  return (
    <div
      className="lgp-matchup-card lgp-matchup-batter sb-player-link"
      style={{ "--card-color": teamColor }}
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/team/${teamId}/player/${b.id}`)}
      onKeyDown={(e) => e.key === "Enter" && navigate(`/team/${teamId}/player/${b.id}`)}
    >
      <div className="lgp-matchup-role">
        <img src={teamLogo} alt="" className="lgp-matchup-team-logo" />
        <span className="lgp-matchup-role-label">Batting</span>
      </div>
      <div className="lgp-matchup-player">
        <PlayerPhoto playerId={b.id} name={b.fullName} size={36} className="lgp-matchup-photo" />
        <div className="lgp-matchup-name-wrap">
          <span className="lgp-matchup-name">{b.fullName}</span>
          <span className="lgp-matchup-season">Season Avg {b.avg || ".000"}</span>
        </div>
      </div>
      <div className="lgp-matchup-today">
        {today.length > 0 ? (
          today.map((t, i) => (
            <span key={i} className="lgp-matchup-stat-chip">{t}</span>
          ))
        ) : (
          <span className="lgp-matchup-no-ab">First AB</span>
        )}
      </div>
    </div>
  );
}

function PitcherCard({ pitcher, teamColor, teamLogo, teamId, navigate }) {
  const p = pitcher;
  const gs = p.gameStats || {};
  const pitches = gs.pitches ?? 0;

  const today = [];
  if (gs.ip != null) today.push(`${gs.ip} IP`);
  if (gs.er != null) today.push(`${gs.er} ER`);
  if (gs.k != null) today.push(`${gs.k} K`);
  if (gs.h != null) today.push(`${gs.h} H`);
  if (pitches > 0) today.push(`${pitches} pitches`);

  return (
    <div
      className="lgp-matchup-card lgp-matchup-pitcher sb-player-link"
      style={{ "--card-color": teamColor }}
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/team/${teamId}/player/${p.id}`)}
      onKeyDown={(e) => e.key === "Enter" && navigate(`/team/${teamId}/player/${p.id}`)}
    >
      <div className="lgp-matchup-role">
        <img src={teamLogo} alt="" className="lgp-matchup-team-logo" />
        <span className="lgp-matchup-role-label">Pitching</span>
      </div>
      <div className="lgp-matchup-player">
        <PlayerPhoto playerId={p.id} name={p.fullName} size={36} className="lgp-matchup-photo" />
        <div className="lgp-matchup-name-wrap">
          <span className="lgp-matchup-name">{p.fullName}</span>
          <span className="lgp-matchup-season">Season ERA {gs.era ?? "—"}</span>
        </div>
      </div>
      <div className="lgp-matchup-today">
        {today.map((t, i) => (
          <span key={i} className="lgp-matchup-stat-chip">{t}</span>
        ))}
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
  const isMobile = useIsMobile();
  const isFinal = gameInfo?.status === "Final";
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
          {(!isMobile || isFinal) && (
            <TopPerformersStrip teams={teams} navigate={navigate} teamId={teamId} />
          )}

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
            <span className="lgp-box-col-stat">HR</span>
            <span className="lgp-box-col-stat">R</span>
            <span className="lgp-box-col-stat">RBI</span>
            <span className="lgp-box-col-stat">BB</span>
            <span className="lgp-box-col-stat">K</span>
            <span className="lgp-box-col-stat">SB</span>
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
                  <span className="lgp-box-col-stat">{s.hr ?? "—"}</span>
                  <span className="lgp-box-col-stat">{s.r ?? "—"}</span>
                  <span className="lgp-box-col-stat">{s.rbi ?? "—"}</span>
                  <span className="lgp-box-col-stat">{s.bb ?? "—"}</span>
                  <span className="lgp-box-col-stat">{s.k ?? "—"}</span>
                  <span className="lgp-box-col-stat">{s.sb ?? "—"}</span>
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
                          <span className="lgp-box-ab-event">{formatScoringDesc(ab.description || ab.shortDesc || ab.event, ab.hrDistance)}</span>
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

// === Final-desktop-only: full single-team box (batters + pitchers) ===
// Used in the 2-column split below the HUD when game is Final + wide viewport.
// No tabs, always open, includes team header.
function FinalTeamBox({ className, teamInfo, score, batters, pitchers, teamId, navigate }) {
  const [openBatter, setOpenBatter] = useState(null);
  return (
    <div className={`lgp-section lgp-final-team-box ${className || ""}`}>
      <div className="lgp-final-team-head">
        <img src={teamInfo.logoUrl} alt="" className="lgp-final-team-logo" />
        <span className="lgp-final-team-abbr">{teamInfo.abbreviation}</span>
        <span className="lgp-final-team-score">{score ?? 0}</span>
      </div>

      <div className="lgp-box-table-hdr">
        <span className="lgp-box-col-name">Batter</span>
        <span className="lgp-box-col-stat">AB</span>
        <span className="lgp-box-col-stat">H</span>
        <span className="lgp-box-col-stat">HR</span>
        <span className="lgp-box-col-stat">R</span>
        <span className="lgp-box-col-stat">RBI</span>
        <span className="lgp-box-col-stat">BB</span>
        <span className="lgp-box-col-stat">K</span>
        <span className="lgp-box-col-stat">SB</span>
        <span className="lgp-box-col-chev" />
      </div>

      {batters?.map((b) => {
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
              <span className="lgp-box-col-stat">{s.hr ?? "—"}</span>
              <span className="lgp-box-col-stat">{s.r ?? "—"}</span>
              <span className="lgp-box-col-stat">{s.rbi ?? "—"}</span>
              <span className="lgp-box-col-stat">{s.bb ?? "—"}</span>
              <span className="lgp-box-col-stat">{s.k ?? "—"}</span>
              <span className="lgp-box-col-stat">{s.sb ?? "—"}</span>
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
                      <span className="lgp-box-ab-event">{formatScoringDesc(ab.description || ab.shortDesc || ab.event, ab.hrDistance)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {pitchers?.length > 0 && (
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
          {pitchers.map((p) => {
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
  );
}
