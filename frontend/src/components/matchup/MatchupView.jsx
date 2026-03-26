import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchTodayGame, fetchRoster, fetchGameLineup, fetchProjectedLineup, fetchHotColdPlayers, fetchBullpenAvailability, fetchAllGamesToday } from "../../api/client";
import { formatGameDate, formatGameTime, lastName, formatAvg } from "../../utils/formatters";
import PARK_FACTORS from "../../data/parkFactors";
import LoadingSpinner from "../common/LoadingSpinner";
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
      const data = await resp.json();
      const g = data?.dates?.[0]?.games?.[0];
      if (!g) return null;
      const away = g.teams?.away || {};
      const home = g.teams?.home || {};
      const at = away.team || {};
      const ht = home.team || {};
      const extractP = (p) => p ? { id: p.id, fullName: p.fullName } : null;
      return {
        gamePk: g.gamePk, gameDate: g.gameDate, status: g.status?.detailedState || "",
        isNextGame: true,
        venue: { id: g.venue?.id, name: g.venue?.name || "" },
        venueLocation: g.venue?.location ? `${g.venue.location.city}, ${g.venue.location.stateAbbrev}` : "",
        away: { id: at.id, name: at.name || "", abbreviation: at.abbreviation || "", wins: away.leagueRecord?.wins, losses: away.leagueRecord?.losses, probablePitcher: extractP(away.probablePitcher), logoUrl: `https://www.mlbstatic.com/team-logos/team-cap-on-dark/${at.id}.svg` },
        home: { id: ht.id, name: ht.name || "", abbreviation: ht.abbreviation || "", wins: home.leagueRecord?.wins, losses: home.leagueRecord?.losses, probablePitcher: extractP(home.probablePitcher), logoUrl: `https://www.mlbstatic.com/team-logos/team-cap-on-dark/${ht.id}.svg` },
      };
    },
    enabled: !!routeGamePk,
    staleTime: 1000 * 60 * 5,
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
  const isPreview = game?.isNextGame;
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

  if (isLoading) return <LoadingSpinner text="Loading matchup..." />;

  if (!game) {
    return (
      <div className="matchup-empty">
        <h2>No Upcoming Games</h2>
        <p>No games scheduled in the next 14 days.</p>
        <button className="btn-retry" onClick={() => navigate(`/team/${teamId}/schedule`)}>
          View Schedule
        </button>
      </div>
    );
  }

  const isHome = game.home.id === teamId;
  const opponent = isHome ? game.away : game.home;
  const us = isHome ? game.home : game.away;
  const opponentPitcher = opponent.probablePitcher;
  const ourPitcher = us.probablePitcher;

  const awayBatters = (awayRoster || []).filter((p) => p.position.type !== "Pitcher");
  const homeBatters = (homeRoster || []).filter((p) => p.position.type !== "Pitcher");
  const ourBatters = isHome ? homeBatters : awayBatters;
  const theirBatters = isHome ? awayBatters : homeBatters;

  return (
    <div className="matchup-view">
      <div className="matchup-top-row">
        {isPreview && <div className="matchup-preview-title">Game Preview</div>}
        {!isPreview && <div />}
        <GameSwitcher currentGamePk={game?.gamePk} teamId={teamId} />
      </div>

      {/* Game header */}
      <div className="matchup-header">
        <div className="matchup-team">
          <img src={us.logoUrl} alt={us.abbreviation} className="matchup-logo" />
          <span>{us.abbreviation}</span>
          {us.wins != null && <span className="matchup-record">{us.wins}-{us.losses}</span>}
        </div>
        <div className="matchup-header-center">
          <span className="matchup-vs">{isHome ? "vs" : "@"}</span>
          {isPreview && (
            <span className="matchup-date">{formatGameDate(game.gameDate)} · {formatGameTime(game.gameDate)}</span>
          )}
          {game.venue?.name && (
            <span className="matchup-venue">{game.venue.name}{game.venueLocation ? ` · ${game.venueLocation}` : ""}</span>
          )}
        </div>
        <div className="matchup-team">
          <img src={opponent.logoUrl} alt={opponent.abbreviation} className="matchup-logo" />
          <span>{opponent.abbreviation}</span>
          {opponent.wins != null && <span className="matchup-record">{opponent.wins}-{opponent.losses}</span>}
        </div>
      </div>

      {/* Win probability chart (shows during/after live games) */}
      {game.gamePk && (game.status === "In Progress" || game.status === "Final") && (
        <WinProbability gamePk={game.gamePk} teamId={teamId} isHome={isHome} />
      )}

      {!opponentPitcher && (
        <div className="matchup-notice">
          Opposing starter not yet announced. Check back closer to game time.
        </div>
      )}

      {/* Side-by-side lineups */}
      {game.gamePk && (
        <MatchupLineups
          gamePk={game.gamePk}
          teamId={teamId}
          opponentId={opponent.id}
          usAbbr={us.abbreviation}
          oppAbbr={opponent.abbreviation}
        />
      )}

      {/* Park Factors */}
      {game.venue?.id && PARK_FACTORS[game.venue.id] && (
        <ParkFactorsCard venueId={game.venue.id} venueName={game.venue.name} />
      )}

      {/* Hot & Cold Players */}
      <HotColdSection teamId={teamId} opponentId={opponent.id} usAbbr={us.abbreviation} oppAbbr={opponent.abbreviation} />

      {/* Bullpen Availability */}
      <BullpenSection
        teamId={teamId}
        opponentId={opponent.id}
        usAbbr={us.abbreviation}
        oppAbbr={opponent.abbreviation}
        usStarterId={us.probablePitcher?.id}
        oppStarterId={opponentPitcher?.id}
      />

      {/* Side-by-side pitcher arsenals */}
      {(opponentPitcher || ourPitcher) && (
        <div className="matchup-section">
          <h3>Pitcher Arsenals</h3>
          <div className="matchup-dual-cols">
            <div className="matchup-dual-col">
              {opponentPitcher ? (
                <>
                  <div className="matchup-dual-hdr">{opponent.abbreviation} — {opponentPitcher.fullName}</div>
                  <PitchArsenal playerId={opponentPitcher.id} embedded compact />
                </>
              ) : <div className="matchup-dual-hdr">TBD</div>}
            </div>
            <div className="matchup-dual-col">
              {ourPitcher ? (
                <>
                  <div className="matchup-dual-hdr">{us.abbreviation} — {ourPitcher.fullName}</div>
                  <PitchArsenal playerId={ourPitcher.id} embedded compact />
                </>
              ) : <div className="matchup-dual-hdr">TBD</div>}
            </div>
          </div>
        </div>
      )}

      {/* Side-by-side BvP */}
      {(opponentPitcher || ourPitcher) && (ourBatters.length > 0 || theirBatters.length > 0) && (
        <div className="matchup-section">
          <h3>Batter vs Pitcher</h3>
          <div className="matchup-dual-cols">
            <div className="matchup-dual-col">
              {opponentPitcher && ourBatters.length > 0 ? (
                <>
                  <div className="matchup-dual-hdr">{us.abbreviation} vs {opponentPitcher.fullName}</div>
                  <BatterVsPitcher batters={ourBatters} pitcherId={opponentPitcher.id} pitcherName={opponentPitcher.fullName} compact />
                </>
              ) : <div className="matchup-dual-hdr">—</div>}
            </div>
            <div className="matchup-dual-col">
              {ourPitcher && theirBatters.length > 0 ? (
                <>
                  <div className="matchup-dual-hdr">{opponent.abbreviation} vs {ourPitcher.fullName}</div>
                  <BatterVsPitcher batters={theirBatters} pitcherId={ourPitcher.id} pitcherName={ourPitcher.fullName} compact />
                </>
              ) : <div className="matchup-dual-hdr">—</div>}
            </div>
          </div>
        </div>
      )}

      {/* Park history */}
      <ParkHistory
        teamId={teamId}
        venueId={game.venue.id}
        venueName={game.venue.name}
      />

      {/* Prior matchups this season */}
      <PriorMatchups
        team1Id={teamId}
        team2Id={opponent.id}
        team1Abbr={us.abbreviation}
        team2Abbr={opponent.abbreviation}
      />
    </div>
  );
}

function MatchupLineups({ gamePk, teamId, opponentId, usAbbr, oppAbbr }) {
  const navigate = useNavigate();

  // Try actual lineups first
  const { data: actualUs, isLoading: loadingUs } = useQuery({
    queryKey: ["gameLineup", gamePk, teamId],
    queryFn: () => fetchGameLineup(gamePk, teamId),
    enabled: !!gamePk,
    staleTime: 1000 * 60 * 2,
    refetchInterval: 1000 * 60 * 2,
  });

  const { data: actualOpp, isLoading: loadingOpp } = useQuery({
    queryKey: ["gameLineup", gamePk, opponentId],
    queryFn: () => fetchGameLineup(gamePk, opponentId),
    enabled: !!gamePk,
    staleTime: 1000 * 60 * 2,
    refetchInterval: 1000 * 60 * 2,
  });

  const actualDone = !loadingUs && !loadingOpp;

  // Projected fallbacks — only after actual queries complete
  const { data: projUs } = useQuery({
    queryKey: ["projectedLineup", teamId],
    queryFn: () => fetchProjectedLineup(teamId),
    enabled: actualDone && !actualUs && !!teamId,
    staleTime: 1000 * 60 * 30,
  });

  const { data: projOpp } = useQuery({
    queryKey: ["projectedLineup", opponentId],
    queryFn: () => fetchProjectedLineup(opponentId),
    enabled: actualDone && !actualOpp && !!opponentId,
    staleTime: 1000 * 60 * 30,
  });

  const usLineup = actualUs || projUs;
  const oppLineup = actualOpp || projOpp;
  const isProjected = actualDone && !actualUs && !actualOpp;

  if (!usLineup?.length && !oppLineup?.length) return null;

  const rows = Math.max(usLineup?.length || 0, oppLineup?.length || 0);

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
          <div className="matchup-lineups-col-hdr">{usAbbr}</div>
          {(usLineup || []).map((p) => (
            <div key={p.id} className="matchup-lineup-row sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${p.id}`)}>
              <span className="ml-order">{p.order}</span>
              <span className="ml-name">{lastName(p.fullName)}</span>
              <span className="ml-pos">{p.position}</span>
              <span className="ml-avg">{p.avg}</span>
            </div>
          ))}
        </div>
        <div className="matchup-lineups-col">
          <div className="matchup-lineups-col-hdr">{oppAbbr}</div>
          {(oppLineup || []).map((p) => (
            <div key={p.id} className="matchup-lineup-row sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${p.id}`)}>
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

function ParkFactorsCard({ venueId, venueName }) {
  const park = PARK_FACTORS[venueId];
  if (!park) return null;

  const runBar = Math.min(Math.max(park.runs - 85, 0), 30);
  const hrBar = Math.min(Math.max(park.hr - 85, 0), 30);

  return (
    <div className="matchup-section">
      <h3>Park Factors</h3>
      <div className="park-factors-card">
        <div className="park-factor-label-row">
          <span className="park-factor-venue">{venueName}</span>
          <span className={`park-factor-tag ${park.runs >= 103 ? "hitter" : park.runs <= 97 ? "pitcher" : "neutral"}`}>
            {park.label}
          </span>
        </div>
        <div className="park-factor-row">
          <span className="park-factor-stat">Runs</span>
          <div className="park-factor-bar-bg">
            <div className="park-factor-bar" style={{ width: `${(runBar / 30) * 100}%`, background: park.runs >= 100 ? "var(--win)" : "var(--team-secondary)" }} />
          </div>
          <span className="park-factor-val">{park.runs}</span>
        </div>
        <div className="park-factor-row">
          <span className="park-factor-stat">HR</span>
          <div className="park-factor-bar-bg">
            <div className="park-factor-bar" style={{ width: `${(hrBar / 30) * 100}%`, background: park.hr >= 100 ? "var(--win)" : "var(--team-secondary)" }} />
          </div>
          <span className="park-factor-val">{park.hr}</span>
        </div>
        <span className="park-factor-note">100 = league average</span>
      </div>
    </div>
  );
}

function HotColdSection({ teamId, opponentId, usAbbr, oppAbbr }) {
  const navigate = useNavigate();

  const { data: usData } = useQuery({
    queryKey: ["hotCold", teamId],
    queryFn: () => fetchHotColdPlayers(teamId),
    enabled: !!teamId,
    staleTime: 1000 * 60 * 30,
  });

  const { data: oppData } = useQuery({
    queryKey: ["hotCold", opponentId],
    queryFn: () => fetchHotColdPlayers(opponentId),
    enabled: !!opponentId,
    staleTime: 1000 * 60 * 30,
  });

  const hasData = usData?.hot?.length || oppData?.hot?.length;
  if (!hasData) return null;

  const renderList = (players, label, teamAbbr) => {
    if (!players?.length) return null;
    return (
      <div className="hotcold-group">
        <div className="hotcold-group-title">{label} — {teamAbbr}</div>
        {players.map((p) => (
          <div key={p.id} className="hotcold-row sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${p.id}`)}>
            <span className="hotcold-name">{lastName(p.fullName)}</span>
            <span className="hotcold-pos">{p.position}</span>
            <span className="hotcold-stat">{p.avg}</span>
            <span className="hotcold-ops">{p.ops} OPS</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="matchup-section">
      <h3>Hot & Cold (Last 7 Games)</h3>
      <div className="hotcold-container">
        {renderList(usData?.hot, "Hot", usAbbr)}
        {renderList(oppData?.hot, "Hot", oppAbbr)}
        {renderList(usData?.cold, "Cold", usAbbr)}
        {renderList(oppData?.cold, "Cold", oppAbbr)}
      </div>
    </div>
  );
}

function BullpenSection({ teamId, opponentId, usAbbr, oppAbbr, usStarterId, oppStarterId }) {
  const navigate = useNavigate();

  const { data: usBullpen } = useQuery({
    queryKey: ["bullpen", teamId, usStarterId],
    queryFn: () => fetchBullpenAvailability(teamId, usStarterId ? [usStarterId] : []),
    enabled: !!teamId,
    staleTime: 1000 * 60 * 30,
  });

  const { data: oppBullpen } = useQuery({
    queryKey: ["bullpen", opponentId, oppStarterId],
    queryFn: () => fetchBullpenAvailability(opponentId, oppStarterId ? [oppStarterId] : []),
    enabled: !!opponentId,
    staleTime: 1000 * 60 * 30,
  });

  if (!usBullpen?.length && !oppBullpen?.length) return null;

  const renderBullpen = (pitchers, abbr) => {
    if (!pitchers?.length) return null;
    return (
      <div className="bullpen-team">
        <div className="bullpen-team-hdr">{abbr}</div>
        {pitchers.map((p) => (
          <div key={p.id} className="bullpen-row sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${p.id}`)}>
            <span className={`bullpen-status-dot ${p.status}`} />
            <span className="bullpen-name">{lastName(p.fullName)}</span>
            <span className="bullpen-rest">{p.daysRest < 99 ? `${p.daysRest}d rest` : "—"}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="matchup-section">
      <h3>Bullpen Availability</h3>
      <div className="bullpen-legend">
        <span><span className="bullpen-status-dot available" /> Available</span>
        <span><span className="bullpen-status-dot limited" /> Limited</span>
        <span><span className="bullpen-status-dot unavailable" /> Unavailable</span>
      </div>
      <div className="bullpen-cols">
        {renderBullpen(usBullpen, usAbbr)}
        {renderBullpen(oppBullpen, oppAbbr)}
      </div>
    </div>
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
