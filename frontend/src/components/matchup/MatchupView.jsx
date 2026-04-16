import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchTodayGame, fetchRoster, fetchGameLineup, fetchProjectedLineup, fetchHotColdPlayers, fetchBullpenAvailability, fetchAllGamesToday, fetchTeamInjuries, fetchSchedule } from "../../api/client";
import { formatGameDate, formatGameTime, lastName, formatAvg } from "../../utils/formatters";
import PARK_FACTORS from "../../data/parkFactors";
import SkeletonLoader from "../common/SkeletonLoader";
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

  return (
    <div className="matchup-view">
      <div className="matchup-top-row">
        {isLive && <div className="matchup-preview-title" style={{ color: "var(--live)" }}>LIVE</div>}
        {isPreview && <div className="matchup-preview-title">Game Preview</div>}
        {isFinal && <div className="matchup-preview-title" style={{ color: "var(--text-muted)" }}>Final</div>}
        <GameSwitcher currentGamePk={game?.gamePk} teamId={teamId} />
      </div>

      {/* Game header — always away on left, home on right */}
      <div className={`matchup-header ${isLive ? "sb-player-link" : ""}`} onClick={isLive ? () => navigate(`/team/${teamId}/live/${game.gamePk}`) : undefined}>
        <div className="matchup-team">
          <img src={game.away.logoUrl} alt={game.away.abbreviation} className="matchup-logo" />
          <span>{game.away.abbreviation}</span>
          {game.away.wins != null && <span className="matchup-record">{game.away.wins}-{game.away.losses}</span>}
        </div>
        <div className="matchup-header-center">
          {(isLive || isFinal) && game.away.score != null ? (
            <>
              <div className="matchup-score-row">
                <span className="matchup-score">{game.away.score}</span>
                <span className="matchup-vs-small">-</span>
                <span className="matchup-score">{game.home.score}</span>
              </div>
              {isLive && <span className="matchup-live-hint">Tap for live view</span>}
            </>
          ) : (
            <>
              <span className="matchup-vs">@</span>
              {isPreview && (
                <span className="matchup-date">{formatGameDate(game.gameDate)} · {formatGameTime(game.gameDate)}</span>
              )}
            </>
          )}
          {game.venue?.name && (
            <span className="matchup-venue">{game.venue.name}{game.venueLocation ? ` · ${game.venueLocation}` : ""}</span>
          )}
        </div>
        <div className="matchup-team">
          <img src={game.home.logoUrl} alt={game.home.abbreviation} className="matchup-logo" />
          <span>{game.home.abbreviation}</span>
          {game.home.wins != null && <span className="matchup-record">{game.home.wins}-{game.home.losses}</span>}
        </div>
      </div>

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

      {/* Hot & Cold Players */}
      <HotColdSection awayId={awayId} homeId={homeId} awayAbbr={game.away.abbreviation} homeAbbr={game.home.abbreviation} />

      {/* Side-by-side pitcher arsenals */}
      {(game.away.probablePitcher || game.home.probablePitcher) && (
        <CollapsibleSection title="Pitcher Arsenals">
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
        <CollapsibleSection title="Batter vs Pitcher">
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
            <div key={p.id} className="matchup-lineup-row sb-player-link" onClick={() => navigate(`/team/${contextTeamId}/player/${p.id}`)}>
              <span className="ml-order">{p.order}</span>
              <span className="ml-name">{lastName(p.fullName)}</span>
              <span className="ml-pos">{p.position}</span>
              <span className="ml-avg">{p.avg}</span>
            </div>
          ))}
        </div>
        <div className="matchup-lineups-col">
          <div className="matchup-lineups-col-hdr">{homeAbbr}</div>
          {(homeLineup || []).map((p) => (
            <div key={p.id} className="matchup-lineup-row sb-player-link" onClick={() => navigate(`/team/${contextTeamId}/player/${p.id}`)}>
              <span className="ml-order">{p.order}</span>
              <span className="ml-name">{lastName(p.fullName)}</span>
              <span className="ml-pos">{p.position}</span>
              <span className="ml-avg">{p.avg}</span>
            </div>
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

function HotColdSection({ awayId, homeId, awayAbbr, homeAbbr }) {
  const { teamId: contextTeamId } = useTeam();
  const navigate = useNavigate();

  const { data: awayData } = useQuery({
    queryKey: ["hotCold", awayId],
    queryFn: () => fetchHotColdPlayers(awayId),
    enabled: !!awayId,
    staleTime: 1000 * 60 * 30,
  });

  const { data: homeData } = useQuery({
    queryKey: ["hotCold", homeId],
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
        <div className="hotcold-team-hdr">{abbr}</div>
        {data.hot?.length > 0 && (
          <div className="hotcold-group">
            <div className="hotcold-group-title hot">Hot</div>
            {data.hot.map((p) => (
              <div key={p.id} className="hotcold-row sb-player-link" onClick={() => navigate(`/team/${contextTeamId}/player/${p.id}`)}>
                <span className="hotcold-name">{lastName(p.fullName) || p.fullName || "—"}</span>
                <span className="hotcold-stat">{formatAvg(p.avg)}</span>
              </div>
            ))}
          </div>
        )}
        {data.cold?.length > 0 && (
          <div className="hotcold-group">
            <div className="hotcold-group-title cold">Cold</div>
            {data.cold.map((p) => (
              <div key={p.id} className="hotcold-row sb-player-link" onClick={() => navigate(`/team/${contextTeamId}/player/${p.id}`)}>
                <span className="hotcold-name">{lastName(p.fullName) || p.fullName || "—"}</span>
                <span className="hotcold-stat">{formatAvg(p.avg)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <CollapsibleSection title="Hot & Cold (Last 7 Games)">
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

  const renderBullpen = (pitchers, abbr) => {
    if (!pitchers?.length) return null;
    return (
      <div className="bullpen-team matchup-dual-col">
        <div className="bullpen-team-hdr">{abbr}</div>
        {pitchers.map((p) => (
          <div key={p.id} className="bullpen-row sb-player-link" onClick={() => navigate(`/team/${contextTeamId}/player/${p.id}`)}>
            <span className={`bullpen-status-dot ${p.status}`} />
            <span className="bullpen-name">{lastName(p.fullName)}</span>
            <span className="bullpen-rest">{p.daysRest < 99 ? `${p.daysRest}d rest` : "—"}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <CollapsibleSection title="Bullpen Availability">
      <div className="bullpen-legend">
        <span><span className="bullpen-status-dot available" /> Available</span>
        <span><span className="bullpen-status-dot limited" /> Limited</span>
        <span><span className="bullpen-status-dot unavailable" /> Unavailable</span>
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

  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;

  const { data: games } = useQuery({
    queryKey: ["allGames", dateStr],
    queryFn: () => fetchAllGamesToday(dateStr),
    staleTime: 1000 * 60 * 5,
  });

  if (!games?.length || games.length <= 1) return null;

  return (
    <div className="game-switcher">
      <button className="game-switcher-btn" onClick={() => setOpen(!open)}>
        All Games
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="game-switcher-dropdown">
          {games.map((g) => (
            <button
              key={g.gamePk}
              className={`game-switcher-item ${g.gamePk === currentGamePk ? "active" : ""}`}
              onClick={() => { setOpen(false); navigate(`/team/${teamId}/matchup/${g.gamePk}`); }}
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
        <div className="injury-team-hdr">{abbr}</div>
        {injuries.map((p) => (
          <div key={p.id} className="injury-row sb-player-link" onClick={() => navigate(`/team/${contextTeamId}/player/${p.id}`)}>
            <span className="injury-name">{p.fullName}</span>
            <span className="injury-pos">{p.position}</span>
            <span className="injury-il">{p.ilType.replace("Injured ", "IL-")}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <CollapsibleSection title="Key Injuries">
      <div className="injury-cols">
        {renderTeam(awayInjuries, awayAbbr)}
        {renderTeam(homeInjuries, homeAbbr)}
      </div>
    </CollapsibleSection>
  );
}

function CollapsibleSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="matchup-section collapsible-section">
      <div className="collapsible-header" onClick={() => setOpen(!open)}>
        <h3>{title}</h3>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
      {open && children}
    </div>
  );
}
