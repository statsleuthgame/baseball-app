import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchAllGamesToday, fetchPitcherSeasonStats, fetchBvP, fetchRoster, fetchGameDetail, fetchGameLineup, fetchProjectedLineup, fetchLiveGameState } from "../../api/client";
import { formatGameTime, getTeamAbbr, lastName, teamDisplayName } from "../../utils/formatters";
import LoadingSpinner from "../common/LoadingSpinner";
import PlayerPhoto from "../common/PlayerPhoto";

const fmt = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const WEATHER_ICONS = {
  sunny: "☀️", clear: "☀️", "partly cloudy": "⛅", cloudy: "☁️",
  overcast: "☁️", rain: "🌧️", drizzle: "🌧️", snow: "🌨️",
  dome: "🏟️", roof: "🏟️", retractable: "🏟️",
};

function weatherIcon(condition) {
  if (!condition) return "🌤️";
  const lower = condition.toLowerCase();
  for (const [key, icon] of Object.entries(WEATHER_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return "🌤️";
}

function formatDateLabel(dateStr) {
  const today = fmt(new Date());
  if (dateStr === today) return "Today";

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateStr === fmt(yesterday)) return "Yesterday";

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dateStr === fmt(tomorrow)) return "Tomorrow";

  const d = new Date(dateStr + "T12:00:00");
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function PitcherStats({ pitcherId }) {
  const { data } = useQuery({
    queryKey: ["pitcherSeasonStats", pitcherId],
    queryFn: () => fetchPitcherSeasonStats(pitcherId),
    enabled: !!pitcherId,
    staleTime: 1000 * 60 * 60,
  });

  if (!data) return null;

  return (
    <span className="sb-pitcher-stats">
      {data.wins}-{data.losses}, {data.era} ERA
    </span>
  );
}

async function fetchBvPBatch(teamId, pitcherId) {
  try {
    const roster = await fetchRoster(teamId);
    const batters = (roster || []).filter((p) => p.position.type !== "Pitcher").slice(0, 9);
    if (!batters.length) return [];
    const results = await Promise.all(
      batters.map(async (b) => {
        try {
          const bvp = await fetchBvP(b.id, pitcherId);
          return { ...b, bvp };
        } catch { return { ...b, bvp: null }; }
      })
    );
    return results
      .filter((m) => m.bvp && m.bvp.pa >= 3)
      .sort((a, b) => (b.bvp.pa || 0) - (a.bvp.pa || 0))
      .slice(0, 3);
  } catch { return []; }
}

function BvPPreview({ teamId, pitcherId }) {
  const navigate = useNavigate();
  const { data: matchups } = useQuery({
    queryKey: ["bvpBatch", teamId, pitcherId],
    queryFn: () => fetchBvPBatch(teamId, pitcherId),
    enabled: !!teamId && !!pitcherId,
    staleTime: 1000 * 60 * 60,
  });

  if (!matchups?.length) return null;

  return (
    <div className="sb-bvp-preview">
      <span className="sb-bvp-title">Key Matchups vs Starter</span>
      {matchups.map((m) => {
        const avg = m.bvp.ab > 0 ? (m.bvp.hits / m.bvp.ab).toFixed(3).replace(/^0/, "") : ".000";
        return (
          <div key={m.id} className="sb-bvp-row sb-tappable" onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${m.id}`); }}>
            <span className="sb-bvp-name">{lastName(m.fullName)}</span>
            <span className="sb-bvp-stat">
              {m.bvp.hits}-{m.bvp.ab} ({avg})
              {m.bvp.homeRuns > 0 ? `, ${m.bvp.homeRuns} HR` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Linescore({ linescore, away, home }) {
  if (!linescore?.innings?.length) return null;

  return (
    <div className="sb-linescore">
      <table className="sb-linescore-table">
        <thead>
          <tr>
            <th></th>
            {linescore.innings.map((inn) => (
              <th key={inn.num}>{inn.num}</th>
            ))}
            <th className="sb-ls-total">R</th>
            <th className="sb-ls-total">H</th>
            <th className="sb-ls-total">E</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="sb-ls-team">{away.abbreviation}</td>
            {linescore.innings.map((inn) => (
              <td key={inn.num}>{inn.away !== "" ? inn.away : "-"}</td>
            ))}
            <td className="sb-ls-total">{linescore.away.runs}</td>
            <td className="sb-ls-total">{linescore.away.hits}</td>
            <td className="sb-ls-total">{linescore.away.errors}</td>
          </tr>
          <tr>
            <td className="sb-ls-team">{home.abbreviation}</td>
            {linescore.innings.map((inn) => (
              <td key={inn.num}>{inn.home !== "" ? inn.home : "-"}</td>
            ))}
            <td className="sb-ls-total">{linescore.home.runs}</td>
            <td className="sb-ls-total">{linescore.home.hits}</td>
            <td className="sb-ls-total">{linescore.home.errors}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// Most prominent logo color per team
const TEAM_COLORS = {
  ARI: "#A71930", ATL: "#CE1141", BAL: "#DF4601", BOS: "#BD3039",
  CHC: "#0E3386", CWS: "#C4CED4", CIN: "#C6011F", CLE: "#E31937",
  COL: "#333366", DET: "#0C2C56", HOU: "#EB6E1F", KC: "#004687",
  LAA: "#BA0021", LAD: "#005A9C", MIA: "#00A3E0", MIL: "#12284B",
  MIN: "#D31145", NYM: "#FF5910", NYY: "#003087", OAK: "#003831",
  ATH: "#003831", PHI: "#E81828", PIT: "#FDB827", SD: "#2F241D",
  SF: "#FD5A1E", SEA: "#005C5C", STL: "#C41E3A", TB: "#092C5C",
  TEX: "#003278", TOR: "#134A8E", WSH: "#AB0003",
};

function BatterRow({ batter, teamId }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const hasABs = batter.atBats.length > 0;

  return (
    <div className="sb-batter">
      <div
        className={`sb-batter-row ${hasABs ? "sb-tappable" : ""}`}
        onClick={hasABs ? () => setOpen(!open) : undefined}
      >
        <span className="sb-batter-pos">{batter.position}</span>
        <span className="sb-batter-name sb-player-link" onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${batter.id}`); }}>{batter.name}</span>
        <span className="sb-batter-stat">{batter.stats.ab}</span>
        <span className="sb-batter-stat">{batter.stats.r}</span>
        <span className="sb-batter-stat">{batter.stats.h}</span>
        <span className="sb-batter-stat">{batter.stats.rbi}</span>
        <span className="sb-batter-stat">{batter.stats.bb}</span>
        <span className="sb-batter-stat">{batter.stats.k}</span>
        {hasABs && (
          <svg className="sb-batter-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: open ? "rotate(180deg)" : "none" }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </div>
      {open && (
        <div className="sb-atbats">
          {batter.atBats.map((ab, i) => (
            <div key={i} className={`sb-atbat ${ab.isScoring ? "sb-atbat-scoring" : ""}`}>
              <span className="sb-atbat-inning">{ab.inning}{ab.inning === 1 ? "st" : ab.inning === 2 ? "nd" : ab.inning === 3 ? "rd" : "th"}</span>
              <span className="sb-atbat-event">
                {ab.event}{ab.hrDistance ? ` (${ab.hrDistance} ft)` : ""}
              </span>
              {ab.rbi > 0 && <span className="sb-atbat-rbi">{ab.rbi} RBI</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamBoxScore({ batters, abbr, teamId }) {
  if (!batters?.length) return null;

  return (
    <div className="sb-team-box">
      <div className="sb-box-header">
        <span className="sb-batter-pos"></span>
        <span className="sb-batter-name sb-box-team">{teamDisplayName(abbr)}</span>
        <span className="sb-batter-stat sb-stat-hdr">AB</span>
        <span className="sb-batter-stat sb-stat-hdr">R</span>
        <span className="sb-batter-stat sb-stat-hdr">H</span>
        <span className="sb-batter-stat sb-stat-hdr">RBI</span>
        <span className="sb-batter-stat sb-stat-hdr">BB</span>
        <span className="sb-batter-stat sb-stat-hdr">K</span>
        <span style={{ width: 10 }}></span>
      </div>
      {batters.map((b) => (
        <BatterRow key={b.id} batter={b} teamId={teamId} />
      ))}
    </div>
  );
}

function TeamPitchingBox({ pitchers, abbr, teamId }) {
  const navigate = useNavigate();
  if (!pitchers?.length) return null;

  return (
    <div className="sb-team-box sb-pitching-box">
      <div className="sb-box-header">
        <span className="sb-batter-name sb-box-team">{teamDisplayName(abbr)} Pitching</span>
        <span className="sb-batter-stat sb-stat-hdr">IP</span>
        <span className="sb-batter-stat sb-stat-hdr">H</span>
        <span className="sb-batter-stat sb-stat-hdr">R</span>
        <span className="sb-batter-stat sb-stat-hdr">ER</span>
        <span className="sb-batter-stat sb-stat-hdr">BB</span>
        <span className="sb-batter-stat sb-stat-hdr">K</span>
        <span className="sb-batter-stat sb-stat-hdr sb-pc-hdr">PC</span>
      </div>
      {pitchers.map((p) => (
        <div key={p.id} className="sb-batter-row">
          <span
            className="sb-batter-name sb-player-link"
            onClick={() => navigate(`/team/${teamId}/player/${p.id}`)}
          >
            {p.name}{p.note ? ` ${p.note}` : ""}
          </span>
          <span className="sb-batter-stat">{p.stats.ip}</span>
          <span className="sb-batter-stat">{p.stats.h}</span>
          <span className="sb-batter-stat">{p.stats.r}</span>
          <span className="sb-batter-stat">{p.stats.er}</span>
          <span className="sb-batter-stat">{p.stats.bb}</span>
          <span className="sb-batter-stat">{p.stats.k}</span>
          <span className="sb-batter-stat sb-pc">{p.stats.pitches}</span>
        </div>
      ))}
    </div>
  );
}

function GameDetail({ gamePk, awayAbbr, homeAbbr, teamId }) {
  const [tab, setTab] = useState("scoring");

  const { data, isLoading } = useQuery({
    queryKey: ["gameDetail", gamePk],
    queryFn: () => fetchGameDetail(gamePk),
    enabled: !!gamePk,
    staleTime: 1000 * 60 * 5,
  });

  if (isLoading) return <div className="sb-plays-loading">Loading...</div>;
  if (!data) return <div className="sb-plays-empty">No data available</div>;

  return (
    <div>
      <div className="sb-detail-tabs">
        <button className={`sb-detail-tab ${tab === "scoring" ? "sb-detail-tab-active" : ""}`} onClick={() => setTab("scoring")}>Scoring</button>
        <button className={`sb-detail-tab ${tab === "boxscore" ? "sb-detail-tab-active" : ""}`} onClick={() => setTab("boxscore")}>Box Score</button>
      </div>

      {tab === "scoring" && (
        <div className="sb-scoring-plays">
          {!data.scoringPlays?.length ? (
            <div className="sb-plays-empty">No scoring plays</div>
          ) : data.scoringPlays.map((play, i) => {
            const isTop = play.halfInning === "top";
            const battingAbbr = isTop ? awayAbbr : homeAbbr;
            const color = TEAM_COLORS[battingAbbr] || "var(--team-secondary)";
            const isHR = play.event === "Home Run";

            // Inject HR distance and bold the hit type keyword
            let desc = play.description;
            if (isHR && play.hrDistance) {
              desc = desc.replace(/homers/, `homers (${play.hrDistance} ft)`);
            }
            const hitPattern = /\b(singles|doubles|triples|homers|walks|grand slam|sacrifice fly|sacrifice bunt|hit by pitch|scores on)\b/i;
            const hitMatch = desc.match(hitPattern);
            let descParts;
            if (hitMatch) {
              const idx = hitMatch.index;
              const word = hitMatch[0];
              descParts = <>{desc.slice(0, idx)}<strong>{word}</strong>{desc.slice(idx + word.length)}</>;
            } else {
              descParts = desc;
            }

            return (
              <div key={i} className="sb-play" style={{ borderLeftColor: color }}>
                <div className="sb-play-header">
                  <span className="sb-play-inning">{isTop ? "Top" : "Bot"} {play.inning}</span>
                  <span className="sb-play-score">{play.awayScore}-{play.homeScore}</span>
                </div>
                <p className="sb-play-desc">{descParts}</p>
              </div>
            );
          })}
        </div>
      )}

      {tab === "boxscore" && (
        <div className="sb-boxscore">
          <TeamBoxScore batters={data.away} abbr={awayAbbr} teamId={teamId} />
          <TeamPitchingBox pitchers={data.awayPitchers} abbr={awayAbbr} teamId={teamId} />
          <TeamBoxScore batters={data.home} abbr={homeAbbr} teamId={teamId} />
          <TeamPitchingBox pitchers={data.homePitchers} abbr={homeAbbr} teamId={teamId} />
        </div>
      )}
    </div>
  );
}

function LiveGameInfo({ gamePk, teamId }) {
  const navigate = useNavigate();
  const { data: liveState } = useQuery({
    queryKey: ["liveGameState", gamePk],
    queryFn: () => fetchLiveGameState(gamePk),
    enabled: !!gamePk,
    staleTime: 1000 * 20,
    refetchInterval: 1000 * 20,
  });

  if (!liveState) return null;

  return (
    <div className="sb-live-info">
      <div className="sb-live-info-row">
        {liveState.batter && (
          <div className="sb-live-player sb-player-link" onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${liveState.batter.id}`); }}>
            <PlayerPhoto playerId={liveState.batter.id} name={liveState.batter.fullName} size={22} />
            <div className="sb-live-player-info">
              <span className="sb-live-player-name">{lastName(liveState.batter.fullName)}</span>
              <span className="sb-live-player-sub">AB{liveState.batter.avg ? ` · ${liveState.batter.avg}` : ""}</span>
            </div>
          </div>
        )}
        <svg className="sb-live-diamond" width="44" height="46" viewBox="0 0 44 46">
          <rect x="15" y="4" width="12" height="12" rx="1.5" transform="rotate(45 21 10)" className={`sb-live-base ${liveState.onSecond ? "occupied" : ""}`} />
          <rect x="25" y="14" width="12" height="12" rx="1.5" transform="rotate(45 31 20)" className={`sb-live-base ${liveState.onFirst ? "occupied" : ""}`} />
          <rect x="5" y="14" width="12" height="12" rx="1.5" transform="rotate(45 11 20)" className={`sb-live-base ${liveState.onThird ? "occupied" : ""}`} />
          <circle cx="21" cy="34" r="2.5" fill="var(--text-muted)" opacity="0.3" />
        </svg>
        {liveState.pitcher && (
          <div className="sb-live-player sb-player-link" onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${liveState.pitcher.id}`); }}>
            <PlayerPhoto playerId={liveState.pitcher.id} name={liveState.pitcher.fullName} size={22} />
            <div className="sb-live-player-info">
              <span className="sb-live-player-name">{lastName(liveState.pitcher.fullName)}</span>
              <span className="sb-live-player-sub">P{liveState.pitcher.gameStats ? ` · ${liveState.pitcher.gameStats.ip} IP` : ""}</span>
            </div>
          </div>
        )}
      </div>
      <div className="sb-live-situation">
        <div className="sb-live-outs">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`sb-live-out-dot ${i < liveState.outs ? "filled" : ""}`} />
          ))}
          <span>{liveState.outs} out</span>
        </div>
        <span className="sb-live-count">{liveState.balls}-{liveState.strikes}</span>
      </div>
    </div>
  );
}

function ScoreboardLineups({ gamePk, awayId, homeId, awayAbbr, homeAbbr, teamId }) {
  const navigate = useNavigate();

  const { data: actualAway, isLoading: loadingAway } = useQuery({
    queryKey: ["gameLineup", gamePk, awayId],
    queryFn: () => fetchGameLineup(gamePk, awayId),
    enabled: !!gamePk,
    staleTime: 1000 * 60 * 2,
  });

  const { data: actualHome, isLoading: loadingHome } = useQuery({
    queryKey: ["gameLineup", gamePk, homeId],
    queryFn: () => fetchGameLineup(gamePk, homeId),
    enabled: !!gamePk,
    staleTime: 1000 * 60 * 2,
  });

  const actualDone = !loadingAway && !loadingHome;

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

  if (!awayLineup?.length && !homeLineup?.length) return <div className="sb-plays-loading">Loading lineups...</div>;

  return (
    <div className="sb-lineups">
      {isProjected && <div className="sb-lineups-tag">Projected · Based on recent games</div>}
      <div className="sb-lineups-cols">
        <div className="sb-lineups-col">
          <div className="sb-lineups-hdr">{awayAbbr}</div>
          {(awayLineup || []).map((p) => (
            <div key={p.id} className="sb-lineups-row sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${p.id}`)}>
              <span className="sb-lu-order">{p.order}</span>
              <span className="sb-lu-name">{lastName(p.fullName)}</span>
              <span className="sb-lu-pos">{p.position}</span>
              <span className="sb-lu-avg">{p.avg}</span>
            </div>
          ))}
        </div>
        <div className="sb-lineups-col">
          <div className="sb-lineups-hdr">{homeAbbr}</div>
          {(homeLineup || []).map((p) => (
            <div key={p.id} className="sb-lineups-row sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${p.id}`)}>
              <span className="sb-lu-order">{p.order}</span>
              <span className="sb-lu-name">{lastName(p.fullName)}</span>
              <span className="sb-lu-pos">{p.position}</span>
              <span className="sb-lu-avg">{p.avg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Scoreboard() {
  const { teamId } = useTeam();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const paramDate = searchParams.get("date");
  const [selectedDate, setSelectedDateRaw] = useState(paramDate || fmt(new Date()));
  const [expandedGame, setExpandedGame] = useState(null);
  const dateInputRef = useRef(null);

  const setSelectedDate = (d) => {
    setSelectedDateRaw(d);
    const today = fmt(new Date());
    if (d === today) {
      setSearchParams({}, { replace: false });
    } else {
      setSearchParams({ date: d }, { replace: false });
    }
  };

  const isToday = selectedDate === fmt(new Date());

  const { data: games, isLoading } = useQuery({
    queryKey: ["allGames", selectedDate],
    queryFn: () => fetchAllGamesToday(selectedDate),
    staleTime: isToday ? 1000 * 60 * 2 : 1000 * 60 * 60,
    refetchInterval: isToday ? 1000 * 60 * 2 : false,
  });

  const goDay = (offset) => {
    const d = new Date(selectedDate + "T12:00:00");
    d.setDate(d.getDate() + offset);
    setSelectedDate(fmt(d));
  };

  // Sort: our team first, then live, scheduled, final
  const sorted = games?.length
    ? [...games].sort((a, b) => {
        const gameTeams = (g) => [g.home.id, g.away.id];
        const aIsOurs = gameTeams(a).includes(teamId);
        const bIsOurs = gameTeams(b).includes(teamId);
        if (aIsOurs && !bIsOurs) return -1;
        if (!aIsOurs && bIsOurs) return 1;

        const statusOrder = { "In Progress": 0, "Delayed": 0.5, "Delayed Start": 0.5, "Pre-Game": 1, Warmup: 1, Scheduled: 2, Final: 3 };
        return (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
      })
    : [];

  return (
    <div className="scoreboard-page">
      <div className="scoreboard-date-nav">
        <button className="scoreboard-date-btn" onClick={() => goDay(-1)} aria-label="Previous day">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button
          className="scoreboard-date-label"
          onClick={() => setSelectedDate(fmt(new Date()))}
          aria-label="Go to today"
        >
          {formatDateLabel(selectedDate)}
        </button>
        <button
          className="scoreboard-date-btn sb-cal-btn"
          onClick={() => dateInputRef.current?.showPicker?.() || dateInputRef.current?.click()}
          aria-label="Pick a date"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <input
            ref={dateInputRef}
            type="date"
            className="sb-date-input-hidden"
            value={selectedDate}
            onChange={(e) => { if (e.target.value) setSelectedDate(e.target.value); }}
            tabIndex={-1}
          />
        </button>
        <button className="scoreboard-date-btn" onClick={() => goDay(1)} aria-label="Next day">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {isLoading && <LoadingSpinner text="Loading scores..." />}

      {!isLoading && !sorted.length && (
        <div className="scoreboard-empty">
          <h2>No Games</h2>
          <p>No games scheduled for {formatDateLabel(selectedDate)}.</p>
        </div>
      )}

      {sorted.length > 0 && (
        <div className="scoreboard-list">
          {sorted.map((game) => {
            const isOurGame = game.home.id === teamId || game.away.id === teamId;
            const isLive = game.status === "In Progress";
            const isDelayed = game.status === "Delayed Start" || game.status === "Delayed";
            const isFinal = game.status === "Final";
            const isScheduled = !isLive && !isDelayed && !isFinal;

            // For our scheduled games, figure out opposing pitcher
            const weAreHome = game.home.id === teamId;
            const opposingPitcher = isOurGame && isScheduled
              ? (weAreHome ? game.away.probablePitcher : game.home.probablePitcher)
              : null;

            const isExpanded = expandedGame === game.gamePk;
            const canExpand = isLive || isFinal || isScheduled;

            const awayWon = isFinal && game.away.score > game.home.score;
            const homeWon = isFinal && game.home.score > game.away.score;

            return (
              <div
                key={game.gamePk}
                className={`scoreboard-card ${isOurGame ? "our-game" : ""} ${isLive ? "live" : ""} ${canExpand ? "sb-tappable" : ""}`}
                onClick={canExpand ? () => setExpandedGame(isExpanded ? null : game.gamePk) : undefined}
              >
                {isLive && (
                  <div className="scoreboard-live-badge">
                    {game.inningHalf === "Top" ? "Top" : "Bot"} {game.inning}
                  </div>
                )}
                {isDelayed && (
                  <div className="scoreboard-status-badge sb-delayed-badge">Delayed</div>
                )}
                {isFinal && (
                  <div className="scoreboard-status-badge">
                    Final{game.linescore && game.linescore.innings.length > 9 ? `/${game.linescore.innings.length}` : ""}
                  </div>
                )}
                {isScheduled && <div className="scoreboard-status-badge">{formatGameTime(game.gameDate)}</div>}

                <div className="scoreboard-teams">
                  <div className={`scoreboard-team-row ${isFinal ? (awayWon ? "sb-winner" : "sb-loser") : ""}`}>
                    <img src={game.away.logoUrl} alt={game.away.abbreviation} className="scoreboard-logo" />
                    <span className="scoreboard-abbr">{game.away.abbreviation}</span>
                    {game.away.wins != null && (
                      <span className="scoreboard-record">{game.away.wins}-{game.away.losses}</span>
                    )}
                    {isScheduled && (
                      <div
                        className="sb-inline-pitcher sb-player-link"
                        onClick={(e) => { if (game.away.probablePitcher?.id) { e.stopPropagation(); navigate(`/team/${teamId}/player/${game.away.probablePitcher.id}`); } }}
                      >
                        {game.away.probablePitcher?.id && (
                          <PlayerPhoto playerId={game.away.probablePitcher.id} name={game.away.probablePitcher.fullName} size={24} className="sb-inline-pitcher-photo" />
                        )}
                        <div className="sb-inline-pitcher-info">
                          <span className="sb-inline-pitcher-name">{game.away.probablePitcher?.fullName || "TBD"}</span>
                          {game.away.probablePitcher?.id && <PitcherStats pitcherId={game.away.probablePitcher.id} />}
                        </div>
                      </div>
                    )}
                    <span className="scoreboard-score">
                      {(isLive || isFinal) ? game.away.score : ""}
                    </span>
                  </div>
                  <div className={`scoreboard-team-row ${isFinal ? (homeWon ? "sb-winner" : "sb-loser") : ""}`}>
                    <img src={game.home.logoUrl} alt={game.home.abbreviation} className="scoreboard-logo" />
                    <span className="scoreboard-abbr">{game.home.abbreviation}</span>
                    {game.home.wins != null && (
                      <span className="scoreboard-record">{game.home.wins}-{game.home.losses}</span>
                    )}
                    {isScheduled && (
                      <div
                        className="sb-inline-pitcher sb-player-link"
                        onClick={(e) => { if (game.home.probablePitcher?.id) { e.stopPropagation(); navigate(`/team/${teamId}/player/${game.home.probablePitcher.id}`); } }}
                      >
                        {game.home.probablePitcher?.id && (
                          <PlayerPhoto playerId={game.home.probablePitcher.id} name={game.home.probablePitcher.fullName} size={24} className="sb-inline-pitcher-photo" />
                        )}
                        <div className="sb-inline-pitcher-info">
                          <span className="sb-inline-pitcher-name">{game.home.probablePitcher?.fullName || "TBD"}</span>
                          {game.home.probablePitcher?.id && <PitcherStats pitcherId={game.home.probablePitcher.id} />}
                        </div>
                      </div>
                    )}
                    <span className="scoreboard-score">
                      {(isLive || isFinal) ? game.home.score : ""}
                    </span>
                  </div>
                </div>

                {/* Live game: batter, pitcher, diamond, outs, count */}
                {isLive && game.gamePk && (
                  <LiveGameInfo gamePk={game.gamePk} teamId={teamId} />
                )}

                {/* Venue + weather + watch for scheduled games */}
                {isScheduled && (game.venue || game.weather) && (
                  <div className="sb-venue-weather">
                    <div className="sb-venue-info">
                      {game.venue && <span className="sb-venue-name">{game.venue}</span>}
                      {game.venueLocation && <span className="sb-venue-location">{game.venueLocation}</span>}
                      {game.weather && (
                        <span className="sb-venue-weather-line">
                          {weatherIcon(game.weather.condition)} {game.weather.temp}°F
                          {game.weather.wind && <span className="sb-wind"> · {game.weather.wind}</span>}
                        </span>
                      )}
                    </div>
                    {isOurGame && (
                      <button
                        className="sb-venue-watch-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.location.href = `mlbatbat://game?game_pk=${game.gamePk}`;
                          setTimeout(() => window.open(`https://www.mlb.tv/game/${game.gamePk}`, "_blank"), 1500);
                        }}
                        aria-label="Watch game"
                      >
                        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                        Watch
                      </button>
                    )}
                  </div>
                )}

                {/* Watch button for our live games (no venue row) */}
                {isOurGame && isLive && (
                  <button
                    className="scoreboard-watch-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(`https://www.mlb.tv/game/${game.gamePk}`, "_blank");
                    }}
                    aria-label="Watch game"
                  >
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    Watch
                  </button>
                )}

                {/* BvP preview for our scheduled games */}
                {isOurGame && isScheduled && opposingPitcher?.id && (
                  <BvPPreview teamId={teamId} pitcherId={opposingPitcher.id} />
                )}

                {/* Gameday link for all active games */}
                {isLive && !isOurGame && (
                  <a
                    className="scoreboard-gameday-link"
                    href={`https://www.mlb.com/gameday/${game.gamePk}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    aria-label="View on MLB Gameday"
                  >
                    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    Gameday
                  </a>
                )}

                {/* Expand indicator */}
                {canExpand && (
                  <div className="sb-expand-hint">
                    <span className="sb-expand-label">{isExpanded ? "Hide" : (isScheduled ? "Lineups" : "Stats")}</span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                )}

                {/* Expanded game detail */}
                {isExpanded && !isScheduled && (
                  <div className="sb-game-detail" onClick={(e) => e.stopPropagation()}>
                    <Linescore linescore={game.linescore} away={game.away} home={game.home} />
                    <GameDetail gamePk={game.gamePk} awayAbbr={game.away.abbreviation} homeAbbr={game.home.abbreviation} teamId={teamId} />
                  </div>
                )}

                {/* Expanded lineups for scheduled games */}
                {isExpanded && isScheduled && (
                  <div className="sb-game-detail" onClick={(e) => e.stopPropagation()}>
                    <ScoreboardLineups
                      gamePk={game.gamePk}
                      awayId={game.away.id}
                      homeId={game.home.id}
                      awayAbbr={game.away.abbreviation}
                      homeAbbr={game.home.abbreviation}
                      teamId={teamId}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
