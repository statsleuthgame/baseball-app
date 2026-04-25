import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchTodayGame, fetchRoster, fetchGameLineup, fetchProjectedLineup, fetchHotColdPlayers, fetchBullpenAvailability, fetchAllGamesToday, fetchTeamInjuries, fetchSchedule, fetchBvP, fetchPlayerCareerVsTeam } from "../../api/client";
import { formatGameDate, formatGameTime, lastName, formatAvg } from "../../utils/formatters";
import { computeEdgeScore, computeFadeScore, scoreBucket } from "../../utils/edgeScoring";
import PARK_FACTORS from "../../data/parkFactors";
import SkeletonLoader from "../common/SkeletonLoader";
import CollapsibleSection from "../common/CollapsibleSection";
import BatterVsPitcher from "./BatterVsPitcher";
import PitchArsenal from "../player/PitchArsenal";
import WinProbability from "./WinProbability";
import ParkHistory from "./ParkHistory";
import PriorMatchups from "./PriorMatchups";

export default function MatchupView() {
  const { teamId } = useTeam();
  const { gamePk: routeGamePk } = useParams();
  const navigate = useNavigate();

  // If a specific gamePk is in the URL, fetch that game's date to find the game
  const { data: specificGame, isLoading: loadingSpecific } = useQuery({
    queryKey: ["specificGame", routeGamePk],
    queryFn: async () => {
      // Fetch game info via schedule search
      const resp = await fetch(`https://statsapi.mlb.com/api/v1/schedule?gamePk=${routeGamePk}&sportId=1&hydrate=team,probablePitcher,venue(location)`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const g = data?.dates?.[0]?.games?.[0];
      if (!g) return null;
      const away = g.teams?.away || {};
      const home = g.teams?.home || {};
      const at = away.team || {};
      const ht = home.team || {};
      const extractP = (p) => p ? { id: p.id, fullName: p.fullName } : null;
      return {
        gamePk: g.gamePk, gameDate: g.gameDate, status: g.status?.detailedState === "Game Over" ? "Final" : (g.status?.detailedState || ""),
        isNextGame: true,
        venue: { id: g.venue?.id, name: g.venue?.name || "" },
        venueLocation: g.venue?.location ? `${g.venue.location.city}, ${g.venue.location.stateAbbrev}` : "",
        away: { id: at.id, name: at.name || "", abbreviation: at.abbreviation || "", score: away.score, wins: away.leagueRecord?.wins, losses: away.leagueRecord?.losses, probablePitcher: extractP(away.probablePitcher), logoUrl: `https://www.mlbstatic.com/team-logos/team-cap-on-dark/${at.id}.svg` },
        home: { id: ht.id, name: ht.name || "", abbreviation: ht.abbreviation || "", score: home.score, wins: home.leagueRecord?.wins, losses: home.leagueRecord?.losses, probablePitcher: extractP(home.probablePitcher), logoUrl: `https://www.mlbstatic.com/team-logos/team-cap-on-dark/${ht.id}.svg` },
      };
    },
    enabled: !!routeGamePk,
    staleTime: 0, // always refetch for specific games to avoid showing wrong game
  });

  const { data: gameData, isLoading: loadingToday } = useQuery({
    queryKey: ["todayGame", teamId],
    queryFn: () => fetchTodayGame(teamId),
    enabled: !!teamId && !routeGamePk,
    staleTime: 1000 * 60 * 5,
  });

  const isLoading = routeGamePk ? loadingSpecific : loadingToday;
  const rawGame = routeGamePk ? specificGame : gameData;

  // Fetch both rosters
  const game = rawGame && !rawGame.noGame ? (rawGame.status === "Final" && rawGame.nextGame ? rawGame.nextGame : rawGame) : null;
  const isLive = game?.status === "In Progress" || game?.status === "Warmup" || game?.status === "Delayed Start" || game?.status === "Delayed";
  const isFinal = game?.status === "Final";
  const isPreview = !isLive && !isFinal;
  const awayId = game?.away?.id;
  const homeId = game?.home?.id;

  const { data: awayRoster } = useQuery({
    queryKey: ["roster", awayId],
    queryFn: () => fetchRoster(awayId),
    enabled: !!awayId,
    staleTime: 1000 * 60 * 60,
  });

  const { data: homeRoster } = useQuery({
    queryKey: ["roster", homeId],
    queryFn: () => fetchRoster(homeId),
    enabled: !!homeId,
    staleTime: 1000 * 60 * 60,
  });

  // Lineup data for BvP ordering (React Query deduplicates with MatchupLineups queries)
  const { data: awayLineupRaw } = useQuery({
    queryKey: ["gameLineup", game?.gamePk, awayId],
    queryFn: () => fetchGameLineup(game.gamePk, awayId),
    enabled: !!game?.gamePk && !!awayId,
    staleTime: 1000 * 60 * 2,
  });

  const { data: homeLineupRaw } = useQuery({
    queryKey: ["gameLineup", game?.gamePk, homeId],
    queryFn: () => fetchGameLineup(game.gamePk, homeId),
    enabled: !!game?.gamePk && !!homeId,
    staleTime: 1000 * 60 * 2,
  });

  const awayLineupIds = awayLineupRaw?.map(p => p.id) || [];
  const homeLineupIds = homeLineupRaw?.map(p => p.id) || [];

  if (isLoading) return <SkeletonLoader variant="matchup" />;

  if (!game) {
    return <MatchupOffDay teamId={teamId} />;
  }

  const isHome = game.home.id === teamId;

  const awayBatters = (awayRoster || []).filter((p) => p.position.type !== "Pitcher");
  const homeBatters = (homeRoster || []).filter((p) => p.position.type !== "Pitcher");

  const pageTitle = `${game.away.abbreviation} at ${game.home.abbreviation}${(isLive || isFinal) && game.away.score != null ? `, ${game.away.score} to ${game.home.score}` : ""}`;

  return (
    <div className="matchup-view">
      <h1 className="sr-only">Matchup: {pageTitle}</h1>
      {/* Game preview header spans full width above the 2-col split.
          Left column on desktop wide: lineups, park factors, bet edge,
          hot/cold, park history, prior matchups.
          Right column: pitcher arsenals, batter vs pitcher, injuries, bullpen.
          Mobile: everything stacks naturally (parent is flex column). */}
      <div className="matchup-top-row">
        {isLive && <h2 className="matchup-preview-title" style={{ color: "var(--live)" }}>LIVE</h2>}
        {isPreview && <h2 className="matchup-preview-title">Game Preview</h2>}
        {isFinal && <h2 className="matchup-preview-title" style={{ color: "var(--text-muted)" }}>Final</h2>}
        <GameSwitcher currentGamePk={game?.gamePk} teamId={teamId} />
      </div>

      {/* Game header — always away on left, home on right */}
      <div className="matchup-header">
        <button
          type="button"
          className="matchup-team matchup-team-link"
          onClick={() => navigate(`/team/${game.away.id}`)}
          aria-label={`Go to ${game.away.abbreviation} team page`}
        >
          <img src={game.away.logoUrl} alt="" className="matchup-logo" />
          <span>{game.away.abbreviation}</span>
          {game.away.wins != null && <span className="matchup-record">{game.away.wins}-{game.away.losses}</span>}
        </button>
        <div className="matchup-header-center">
          {(isLive || isFinal) && game.away.score != null ? (
            <>
              <div className="matchup-score-row">
                <span className="matchup-score" aria-label={`${game.away.abbreviation} ${game.away.score}`}>{game.away.score}</span>
                <span className="matchup-vs-small" aria-hidden="true">-</span>
                <span className="matchup-score" aria-label={`${game.home.abbreviation} ${game.home.score}`}>{game.home.score}</span>
              </div>
              {isLive && (
                <button
                  type="button"
                  className="matchup-live-hint"
                  onClick={() => navigate(`/team/${teamId}/live/${game.gamePk}`)}
                  aria-label="Open live game view"
                >
                  Tap for live view
                </button>
              )}
            </>
          ) : (
            <>
              <span className="matchup-vs" aria-hidden="true">@</span>
              {isPreview && (
                <span className="matchup-date">{formatGameDate(game.gameDate)} · {formatGameTime(game.gameDate)}</span>
              )}
            </>
          )}
          {game.venue?.name && (
            <span className="matchup-venue">{game.venue.name}{game.venueLocation ? ` · ${game.venueLocation}` : ""}</span>
          )}
        </div>
        <button
          type="button"
          className="matchup-team matchup-team-link"
          onClick={() => navigate(`/team/${game.home.id}`)}
          aria-label={`Go to ${game.home.abbreviation} team page`}
        >
          <img src={game.home.logoUrl} alt="" className="matchup-logo" />
          <span>{game.home.abbreviation}</span>
          {game.home.wins != null && <span className="matchup-record">{game.home.wins}-{game.home.losses}</span>}
        </button>
      </div>

      <div className="matchup-col-left">

      {/* Win probability chart (shows during/after live games) */}
      {game.gamePk && (game.status === "In Progress" || game.status === "Final") && (
        <WinProbability gamePk={game.gamePk} teamId={teamId} isHome={isHome} awayAbbr={game.away.abbreviation} homeAbbr={game.home.abbreviation} awayLogo={game.away.logoUrl} homeLogo={game.home.logoUrl} />
      )}

      {!game.home.probablePitcher && !game.away.probablePitcher && isPreview && (
        <div className="matchup-notice">
          Starters not yet announced. Check back closer to game time.
        </div>
      )}

      {/* Side-by-side lineups */}
      {game.gamePk && (
        <MatchupLineups
          gamePk={game.gamePk}
          awayId={awayId}
          homeId={homeId}
          awayAbbr={game.away.abbreviation}
          homeAbbr={game.home.abbreviation}
          contextTeamId={teamId}
        />
      )}

      {/* Park Factors */}
      {game.venue?.id && PARK_FACTORS[game.venue.id] && (
        <ParkFactorsCard venueId={game.venue.id} venueName={game.venue.name} />
      )}

      {/* Bet Edge (pre-collapsed): top 3 bet-on + top 3 bet-against per team */}
      <MatchupEdgeSection
        awayId={awayId}
        homeId={homeId}
        awayAbbr={game.away.abbreviation}
        homeAbbr={game.home.abbreviation}
        awayPitcher={game.away.probablePitcher}
        homePitcher={game.home.probablePitcher}
      />

      {/* Hot & Cold Players */}
      <HotColdSection awayId={awayId} homeId={homeId} awayAbbr={game.away.abbreviation} homeAbbr={game.home.abbreviation} />

      {/* Park history */}
      <ParkHistory
        teamId={teamId}
        venueId={game.venue.id}
        venueName={game.venue.name}
      />

      {/* Prior matchups this season */}
      <PriorMatchups
        team1Id={awayId}
        team2Id={homeId}
        team1Abbr={game.away.abbreviation}
        team2Abbr={game.home.abbreviation}
      />

      </div>
      <div className="matchup-col-right">

      {/* Side-by-side pitcher arsenals */}
      {(game.away.probablePitcher || game.home.probablePitcher) && (
        <CollapsibleSection title="Pitcher Arsenals" className="matchup-section">
          <div className="matchup-dual-cols">
            <div className="matchup-dual-col">
              {game.away.probablePitcher ? (
                <>
                  <div className="matchup-dual-hdr">{game.away.abbreviation} — {game.away.probablePitcher.fullName}</div>
                  <PitchArsenal playerId={game.away.probablePitcher.id} embedded compact />
                </>
              ) : <div className="matchup-dual-hdr">TBD</div>}
            </div>
            <div className="matchup-dual-col">
              {game.home.probablePitcher ? (
                <>
                  <div className="matchup-dual-hdr">{game.home.abbreviation} — {game.home.probablePitcher.fullName}</div>
                  <PitchArsenal playerId={game.home.probablePitcher.id} embedded compact />
                </>
              ) : <div className="matchup-dual-hdr">TBD</div>}
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Side-by-side BvP */}
      {(game.away.probablePitcher || game.home.probablePitcher) && (awayBatters.length > 0 || homeBatters.length > 0) && (
        <CollapsibleSection title="Batter vs Pitcher" className="matchup-section">
          <div className="matchup-dual-cols">
            <div className="matchup-dual-col">
              {game.home.probablePitcher && awayBatters.length > 0 ? (
                <>
                  <div className="matchup-dual-hdr">{game.away.abbreviation} vs {game.home.probablePitcher.fullName}</div>
                  <BatterVsPitcher batters={awayBatters} pitcherId={game.home.probablePitcher.id} pitcherName={game.home.probablePitcher.fullName} compact lineupIds={awayLineupIds} />
                </>
              ) : <div className="matchup-dual-hdr">—</div>}
            </div>
            <div className="matchup-dual-col">
              {game.away.probablePitcher && homeBatters.length > 0 ? (
                <>
                  <div className="matchup-dual-hdr">{game.home.abbreviation} vs {game.away.probablePitcher.fullName}</div>
                  <BatterVsPitcher batters={homeBatters} pitcherId={game.away.probablePitcher.id} pitcherName={game.away.probablePitcher.fullName} compact lineupIds={homeLineupIds} />
                </>
              ) : <div className="matchup-dual-hdr">—</div>}
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Key Injuries */}
      <InjurySection awayId={awayId} homeId={homeId} awayAbbr={game.away.abbreviation} homeAbbr={game.home.abbreviation} />

      {/* Bullpen Availability */}
      <BullpenSection
        awayId={awayId}
        homeId={homeId}
        awayAbbr={game.away.abbreviation}
        homeAbbr={game.home.abbreviation}
        awayStarterId={game.away.probablePitcher?.id}
        homeStarterId={game.home.probablePitcher?.id}
      />

      </div>
    </div>
  );
}

function MatchupLineups({ gamePk, awayId, homeId, awayAbbr, homeAbbr, contextTeamId }) {
  const navigate = useNavigate();

  // Try actual lineups first — stop polling once both are populated
  const { data: actualAway, isLoading: loadingAway } = useQuery({
    queryKey: ["gameLineup", gamePk, awayId],
    queryFn: () => fetchGameLineup(gamePk, awayId),
    enabled: !!gamePk && !!awayId,
    staleTime: 1000 * 60 * 2,
    refetchInterval: (data) => data ? false : 1000 * 60 * 2,
  });

  const { data: actualHome, isLoading: loadingHome } = useQuery({
    queryKey: ["gameLineup", gamePk, homeId],
    queryFn: () => fetchGameLineup(gamePk, homeId),
    enabled: !!gamePk && !!homeId,
    staleTime: 1000 * 60 * 2,
    refetchInterval: (data) => data ? false : 1000 * 60 * 2,
  });

  const actualDone = !loadingAway && !loadingHome;

  // Projected fallbacks for both teams — only after actual queries complete
  const { data: projAway } = useQuery({
    queryKey: ["projectedLineup", awayId],
    queryFn: () => fetchProjectedLineup(awayId),
    enabled: actualDone && !actualAway && !!awayId,
    staleTime: 1000 * 60 * 30,
  });

  const { data: projHome } = useQuery({
    queryKey: ["projectedLineup", homeId],
    queryFn: () => fetchProjectedLineup(homeId),
    enabled: actualDone && !actualHome && !!homeId,
    staleTime: 1000 * 60 * 30,
  });

  const awayLineup = actualAway || projAway;
  const homeLineup = actualHome || projHome;
  const isProjected = actualDone && !actualAway && !actualHome;

  if (!awayLineup?.length && !homeLineup?.length) return null;

  return (
    <div className="matchup-lineups">
      <div className="matchup-lineups-header">
        <span className="matchup-lineups-title">
          {isProjected ? "Projected Lineups" : "Starting Lineups"}
        </span>
        {isProjected && <span className="matchup-lineups-tag">Based on recent games</span>}
      </div>
      <div className="matchup-lineups-cols">
        <div className="matchup-lineups-col">
          <div className="matchup-lineups-col-hdr">{awayAbbr}</div>
          {(awayLineup || []).map((p) => (
            <button
              key={p.id}
              type="button"
              className="matchup-lineup-row sb-player-link"
              onClick={() => navigate(`/team/${contextTeamId}/player/${p.id}`)}
              aria-label={`View ${p.fullName}, batting ${p.order}, position ${p.position}, average ${p.avg}`}
            >
              <span className="ml-order">{p.order}</span>
              <span className="ml-name">{lastName(p.fullName)}</span>
              <span className="ml-pos">{p.position}</span>
              <span className="ml-avg">{p.avg}</span>
            </button>
          ))}
        </div>
        <div className="matchup-lineups-col">
          <div className="matchup-lineups-col-hdr">{homeAbbr}</div>
          {(homeLineup || []).map((p) => (
            <button
              key={p.id}
              type="button"
              className="matchup-lineup-row sb-player-link"
              onClick={() => navigate(`/team/${contextTeamId}/player/${p.id}`)}
              aria-label={`View ${p.fullName}, batting ${p.order}, position ${p.position}, average ${p.avg}`}
            >
              <span className="ml-order">{p.order}</span>
              <span className="ml-name">{lastName(p.fullName)}</span>
              <span className="ml-pos">{p.position}</span>
              <span className="ml-avg">{p.avg}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ParkFactorsCard({ venueId }) {
  const park = PARK_FACTORS[venueId];
  if (!park) return null;

  const tagClass = park.runs >= 103 ? "hitter" : park.runs <= 97 ? "pitcher" : "neutral";

  return (
    <div className="park-factors-inline">
      <span className={`park-factor-tag ${tagClass}`}>{park.label}</span>
      <span className="park-factor-stats">
        Runs <strong>{park.runs}</strong> · HR <strong>{park.hr}</strong>
      </span>
      <span className="park-factor-note">100 = avg</span>
    </div>
  );
}

// Pre-collapsed per-matchup edge summary: top 3 bet-on and top 3 bet-against
// for each team. Reuses the ["matchupHotCold", teamId] query cache that
// HotColdSection already populates, then fans out BvP + career-vs-team per
// (batter, opposing pitcher/team) and scores with the same functions powering
// the main /edge tab.
function MatchupEdgeSection({
  awayId,
  homeId,
  awayAbbr,
  homeAbbr,
  awayPitcher,
  homePitcher,
}) {
  const { teamId: contextTeamId } = useTeam();
  const navigate = useNavigate();

  const { data: awayHC } = useQuery({
    queryKey: ["matchupHotCold", awayId],
    queryFn: () => fetchHotColdPlayers(awayId),
    enabled: !!awayId,
    staleTime: 1000 * 60 * 30,
  });
  const { data: homeHC } = useQuery({
    queryKey: ["matchupHotCold", homeId],
    queryFn: () => fetchHotColdPlayers(homeId),
    enabled: !!homeId,
    staleTime: 1000 * 60 * 30,
  });

  // Candidates: every hot batter becomes a pick candidate, every cold batter
  // a fade candidate, keyed by which pitcher/team they'll face.
  const candidates = useMemo(() => {
    const out = [];
    const push = (list, kind, ownTeamId, ownAbbr, oppPitcher, oppTeamId, oppAbbr) => {
      for (const b of list || []) {
        out.push({
          key: `${ownTeamId}-${kind}-${b.id}`,
          kind,
          teamId: ownTeamId,
          teamAbbr: ownAbbr,
          batter: b,
          oppPitcher,
          oppTeamId,
          oppAbbr,
        });
      }
    };
    push(awayHC?.hot, "pick", awayId, awayAbbr, homePitcher, homeId, homeAbbr);
    push(awayHC?.cold, "fade", awayId, awayAbbr, homePitcher, homeId, homeAbbr);
    push(homeHC?.hot, "pick", homeId, homeAbbr, awayPitcher, awayId, awayAbbr);
    push(homeHC?.cold, "fade", homeId, homeAbbr, awayPitcher, awayId, awayAbbr);
    return out;
  }, [awayHC, homeHC, awayId, homeId, awayAbbr, homeAbbr, awayPitcher, homePitcher]);

  // BvP per candidate (skip if no opposing pitcher published yet).
  const bvpQueries = useQueries({
    queries: candidates.map((c) => ({
      queryKey: ["edge", "bvp", c.batter.id, c.oppPitcher?.id],
      queryFn: () => fetchBvP(c.batter.id, c.oppPitcher?.id),
      staleTime: 1000 * 60 * 60 * 24,
      enabled: !!c.oppPitcher?.id,
    })),
  });

  // Career vs team per candidate.
  const careerQueries = useQueries({
    queries: candidates.map((c) => ({
      queryKey: ["edge", "careerVsTeam", c.batter.id, c.oppTeamId],
      queryFn: () => fetchPlayerCareerVsTeam(c.batter.id, c.oppTeamId),
      staleTime: 1000 * 60 * 60 * 24,
      enabled: !!c.oppTeamId,
    })),
  });

  const scored = useMemo(() => {
    return candidates.map((c, i) => {
      const bvp = bvpQueries[i]?.data || { pa: 0 };
      const career = careerQueries[i]?.data || { ab: 0, ops: null };
      const score =
        c.kind === "fade"
          ? computeFadeScore({
              l7OPS: c.batter.ops,
              bvpOPS: bvp.ops,
              bvpPA: bvp.pa,
              bvpK: bvp.strikeouts,
              teamContextOPS: career.ops,
              teamContextAB: career.ab,
            })
          : computeEdgeScore({
              l7OPS: c.batter.ops,
              bvpOPS: bvp.ops,
              bvpPA: bvp.pa,
              teamContextOPS: career.ops,
              teamContextAB: career.ab,
            });
      return { ...c, bvp, career, score, confidence: scoreBucket(score) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    candidates,
    bvpQueries.map((q) => q.data?.pa ?? "_").join("|"),
    careerQueries.map((q) => q.data?.ab ?? "_").join("|"),
  ]);

  const top3 = (teamId, kind) =>
    scored
      .filter((s) => s.teamId === teamId && s.kind === kind)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

  const awayPicks = top3(awayId, "pick");
  const awayFades = top3(awayId, "fade");
  const homePicks = top3(homeId, "pick");
  const homeFades = top3(homeId, "fade");

  const nothing =
    !awayPicks.length &&
    !awayFades.length &&
    !homePicks.length &&
    !homeFades.length;
  if (nothing) return null;

  const renderRow = (row) => (
    <button
      key={row.key}
      type="button"
      className="matchup-edge-row sb-player-link"
      onClick={() =>
        navigate(`/team/${contextTeamId || row.teamId}/player/${row.batter.id}`)
      }
      aria-label={`${row.batter.fullName || "Player"}: ${row.confidence.label} ${row.kind === "fade" ? "fade" : "pick"}, score ${row.score.toFixed(2)}. View player page.`}
    >
      <span className="matchup-edge-name">
        {lastName(row.batter.fullName) || row.batter.fullName || "—"}
      </span>
      <span
        className={`matchup-edge-tier matchup-edge-tier-${row.confidence.tone}`}
      >
        {row.confidence.label}
      </span>
      <span className="matchup-edge-score">{row.score.toFixed(2)}</span>
    </button>
  );

  const renderTeamCol = (abbr, picks, fades) => (
    <div className="matchup-edge-col">
      <h4 className="matchup-edge-team-hdr">{abbr}</h4>
      <div className="matchup-edge-group">
        <div className="matchup-edge-group-title pick">
          <span className="matchup-edge-arrow" aria-hidden="true">▲</span> Bet on
        </div>
        {picks.length ? (
          picks.map(renderRow)
        ) : (
          <div className="matchup-edge-empty">No strong picks.</div>
        )}
      </div>
      <div className="matchup-edge-group">
        <div className="matchup-edge-group-title fade">
          <span className="matchup-edge-arrow" aria-hidden="true">▼</span> Bet against
        </div>
        {fades.length ? (
          fades.map(renderRow)
        ) : (
          <div className="matchup-edge-empty">No strong fades.</div>
        )}
      </div>
    </div>
  );

  return (
    <CollapsibleSection title="Bet Edge" defaultOpen={false} className="matchup-section">
      <div className="matchup-edge-grid">
        {renderTeamCol(awayAbbr, awayPicks, awayFades)}
        {renderTeamCol(homeAbbr, homePicks, homeFades)}
      </div>
      <p className="matchup-edge-disclaimer">
        For entertainment only. Not financial advice.
      </p>
    </CollapsibleSection>
  );
}

function HotColdSection({ awayId, homeId, awayAbbr, homeAbbr }) {
  const { teamId: contextTeamId } = useTeam();
  const navigate = useNavigate();

  // Use matchup-specific key — fetchHotColdPlayers returns a different shape than
  // fetchTeamHotCold (live MLB API vs static roster.json), so they must not share
  // the same React Query cache key or the dashboard's cached data leaks into here.
  const { data: awayData } = useQuery({
    queryKey: ["matchupHotCold", awayId],
    queryFn: () => fetchHotColdPlayers(awayId),
    enabled: !!awayId,
    staleTime: 1000 * 60 * 30,
  });

  const { data: homeData } = useQuery({
    queryKey: ["matchupHotCold", homeId],
    queryFn: () => fetchHotColdPlayers(homeId),
    enabled: !!homeId,
    staleTime: 1000 * 60 * 30,
  });

  const hasData = awayData?.hot?.length || homeData?.hot?.length;
  if (!hasData) return null;

  const renderTeamCol = (data, abbr) => {
    if (!data?.hot?.length && !data?.cold?.length) return null;
    return (
      <div className="hotcold-team-col">
        <h4 className="hotcold-team-hdr">{abbr}</h4>
        {data.hot?.length > 0 && (
          <div className="hotcold-group">
            <div className="hotcold-group-title hot">Hot</div>
            {data.hot.map((p) => (
              <button
                key={p.id}
                type="button"
                className="hotcold-row sb-player-link"
                onClick={() => navigate(`/team/${contextTeamId}/player/${p.id}`)}
                aria-label={`Hot: ${p.fullName || "Player"}, average ${formatAvg(p.avg)}. View player page.`}
              >
                <span className="hotcold-name">{lastName(p.fullName) || p.fullName || "—"}</span>
                <span className="hotcold-stat">{formatAvg(p.avg)}</span>
              </button>
            ))}
          </div>
        )}
        {data.cold?.length > 0 && (
          <div className="hotcold-group">
            <div className="hotcold-group-title cold">Cold</div>
            {data.cold.map((p) => (
              <button
                key={p.id}
                type="button"
                className="hotcold-row sb-player-link"
                onClick={() => navigate(`/team/${contextTeamId}/player/${p.id}`)}
                aria-label={`Cold: ${p.fullName || "Player"}, average ${formatAvg(p.avg)}. View player page.`}
              >
                <span className="hotcold-name">{lastName(p.fullName) || p.fullName || "—"}</span>
                <span className="hotcold-stat">{formatAvg(p.avg)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <CollapsibleSection title="Hot & Cold (Last 7 Games)" className="matchup-section">
      <div className="hotcold-side-by-side">
        {renderTeamCol(awayData, awayAbbr)}
        {renderTeamCol(homeData, homeAbbr)}
      </div>
    </CollapsibleSection>
  );
}

function BullpenSection({ awayId, homeId, awayAbbr, homeAbbr, awayStarterId, homeStarterId }) {
  const { teamId: contextTeamId } = useTeam();
  const navigate = useNavigate();

  const { data: awayBullpen } = useQuery({
    queryKey: ["bullpen", awayId, awayStarterId],
    queryFn: () => fetchBullpenAvailability(awayId, awayStarterId ? [awayStarterId] : []),
    enabled: !!awayId,
    staleTime: 1000 * 60 * 30,
  });

  const { data: homeBullpen } = useQuery({
    queryKey: ["bullpen", homeId, homeStarterId],
    queryFn: () => fetchBullpenAvailability(homeId, homeStarterId ? [homeStarterId] : []),
    enabled: !!homeId,
    staleTime: 1000 * 60 * 30,
  });

  if (!awayBullpen?.length && !homeBullpen?.length) return null;

  const statusLabel = (s) => s === "available" ? "Available" : s === "limited" ? "Limited" : s === "unavailable" ? "Unavailable" : s;

  const renderBullpen = (pitchers, abbr) => {
    if (!pitchers?.length) return null;
    return (
      <div className="bullpen-team matchup-dual-col">
        <h4 className="bullpen-team-hdr">{abbr}</h4>
        {pitchers.map((p) => (
          <button
            key={p.id}
            type="button"
            className="bullpen-row sb-player-link"
            onClick={() => navigate(`/team/${contextTeamId}/player/${p.id}`)}
            aria-label={`${p.fullName}, ${statusLabel(p.status)}, ${p.daysRest < 99 ? `${p.daysRest} days rest` : "rest unknown"}. View player page.`}
          >
            <span className={`bullpen-status-dot ${p.status}`} aria-hidden="true" />
            <span className="bullpen-name">{lastName(p.fullName)}</span>
            <span className="bullpen-rest">{p.daysRest < 99 ? `${p.daysRest}d rest` : "—"}</span>
          </button>
        ))}
      </div>
    );
  };

  return (
    <CollapsibleSection title="Bullpen Availability" className="matchup-section">
      <div className="bullpen-legend" role="list" aria-label="Status legend">
        <span role="listitem"><span className="bullpen-status-dot available" aria-hidden="true" /> Available</span>
        <span role="listitem"><span className="bullpen-status-dot limited" aria-hidden="true" /> Limited</span>
        <span role="listitem"><span className="bullpen-status-dot unavailable" aria-hidden="true" /> Unavailable</span>
      </div>
      <div className="matchup-dual-cols">
        {renderBullpen(awayBullpen, awayAbbr)}
        {renderBullpen(homeBullpen, homeAbbr)}
      </div>
    </CollapsibleSection>
  );
}

function GameSwitcher({ currentGamePk, teamId }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const btnRef = useRef(null);

  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;

  const { data: games } = useQuery({
    queryKey: ["allGames", dateStr],
    queryFn: () => fetchAllGamesToday(dateStr),
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!games?.length || games.length <= 1) return null;

  return (
    <div className="game-switcher" ref={containerRef}>
      <button
        type="button"
        ref={btnRef}
        className="game-switcher-btn"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Switch game"
      >
        All Games
        <svg aria-hidden="true" focusable="false" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="game-switcher-dropdown" role="menu" aria-label="Today's games">
          {games.map((g) => (
            <button
              key={g.gamePk}
              type="button"
              role="menuitem"
              className={`game-switcher-item ${g.gamePk === currentGamePk ? "active" : ""}`}
              onClick={() => { setOpen(false); navigate(`/team/${teamId}/matchup/${g.gamePk}`); }}
              aria-current={g.gamePk === currentGamePk ? "page" : undefined}
            >
              <span className="gs-teams">{g.away.abbreviation} @ {g.home.abbreviation}</span>
              <span className="gs-status">
                {g.status === "Final" ? "Final" : g.status === "In Progress" ? "Live" : formatGameTime(g.gameDate)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MatchupOffDay({ teamId }) {
  const navigate = useNavigate();

  const { data: schedule, isLoading } = useQuery({
    queryKey: ["schedule", teamId],
    queryFn: () => fetchSchedule(teamId),
    enabled: !!teamId,
    staleTime: 1000 * 60 * 60,
  });

  const now = new Date();

  const lastGame = schedule
    ?.filter((g) => g.status === "Final")
    .sort((a, b) => new Date(b.gameDate) - new Date(a.gameDate))[0] || null;

  const nextGame = schedule
    ?.filter((g) => g.status !== "Final" && new Date(g.gameDate) > now)
    .sort((a, b) => new Date(a.gameDate) - new Date(b.gameDate))[0] || null;

  const getResult = (g) => {
    if (!g) return {};
    const isHome = Number(g.home.id) === Number(teamId);
    const us = isHome ? g.home : g.away;
    const them = isHome ? g.away : g.home;
    const won = us.isWinner;
    return { us, them, isHome, won };
  };

  return (
    <div className="matchup-empty matchup-offday">
      <h2>Off Day</h2>
      <p>No game today.</p>

      {isLoading && <p className="offday-loading">Loading schedule...</p>}

      {lastGame && (() => {
        const { us, them, isHome, won } = getResult(lastGame);
        return (
          <div className="offday-card">
            <div className="offday-card-label">Last Game</div>
            <div className="offday-card-row">
              <img src={them.logoUrl} alt={them.abbreviation} className="offday-logo" />
              <div className="offday-card-detail">
                <span className="offday-matchup">
                  {isHome ? "vs" : "@"} {them.abbreviation}
                </span>
                <span className="offday-date">{formatGameDate(lastGame.gameDate)}</span>
              </div>
              <div className="offday-result">
                <span className={`offday-wl ${won ? "win" : "loss"}`}>{won ? "W" : "L"}</span>
                <span className="offday-score">{us.score}–{them.score}</span>
              </div>
            </div>
          </div>
        );
      })()}

      {nextGame && (() => {
        const isHome = Number(nextGame.home.id) === Number(teamId);
        const them = isHome ? nextGame.away : nextGame.home;
        return (
          <div className="offday-card">
            <div className="offday-card-label">Next Game</div>
            <div className="offday-card-row">
              <img src={them.logoUrl} alt={them.abbreviation} className="offday-logo" />
              <div className="offday-card-detail">
                <span className="offday-matchup">
                  {isHome ? "vs" : "@"} {them.abbreviation}
                </span>
                <span className="offday-date">
                  {formatGameDate(nextGame.gameDate)} · {formatGameTime(nextGame.gameDate)}
                </span>
              </div>
              {them.probablePitcher && (
                <div className="offday-pitcher">
                  <span className="offday-pitcher-label">SP</span>
                  <span>{them.probablePitcher.fullName}</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {!isLoading && !lastGame && !nextGame && (
        <p>No games scheduled in the next 14 days.</p>
      )}

      <button className="btn-retry" onClick={() => navigate(`/team/${teamId}/schedule`)}>
        View Schedule
      </button>
    </div>
  );
}

function InjurySection({ awayId, homeId, awayAbbr, homeAbbr }) {
  const { teamId: contextTeamId } = useTeam();
  const navigate = useNavigate();

  const { data: awayInjuries } = useQuery({
    queryKey: ["injuries", awayId],
    queryFn: () => fetchTeamInjuries(awayId),
    enabled: !!awayId,
    staleTime: 1000 * 60 * 60,
  });

  const { data: homeInjuries } = useQuery({
    queryKey: ["injuries", homeId],
    queryFn: () => fetchTeamInjuries(homeId),
    enabled: !!homeId,
    staleTime: 1000 * 60 * 60,
  });

  if (!awayInjuries?.length && !homeInjuries?.length) return null;

  const renderTeam = (injuries, abbr) => {
    if (!injuries?.length) return null;
    return (
      <div className="injury-team">
        <h4 className="injury-team-hdr">{abbr}</h4>
        {injuries.map((p) => (
          <button
            key={p.id}
            type="button"
            className="injury-row sb-player-link"
            onClick={() => navigate(`/team/${contextTeamId}/player/${p.id}`)}
            aria-label={`${p.fullName}, ${p.position}, ${p.ilType}. View player page.`}
          >
            <span className="injury-name">{p.fullName}</span>
            <span className="injury-pos">{p.position}</span>
            <span className="injury-il">{p.ilType.replace("Injured ", "IL-")}</span>
          </button>
        ))}
      </div>
    );
  };

  return (
    <CollapsibleSection title="Key Injuries" className="matchup-section">
      <div className="injury-cols">
        {renderTeam(awayInjuries, awayAbbr)}
        {renderTeam(homeInjuries, homeAbbr)}
      </div>
    </CollapsibleSection>
  );
}

