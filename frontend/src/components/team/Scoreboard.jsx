import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchAllGamesToday, fetchPitcherSeasonStats, fetchBvP, fetchRoster, fetchGameDetail, fetchGameLineup, fetchProjectedLineup, fetchLiveGameState } from "../../api/client";
import { formatGameTime, getTeamAbbr, lastName, teamDisplayName } from "../../utils/formatters";
import SkeletonLoader from "../common/SkeletonLoader";
import PlayerPhoto from "../common/PlayerPhoto";
import ALL_TEAMS from "../../data/teams";

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

function TopPerformer({ gamePk, side, teamId }) {
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ["gameDetail", gamePk],
    queryFn: () => fetchGameDetail(gamePk),
    enabled: !!gamePk,
    staleTime: 1000 * 60 * 60,
  });

  if (!data) return null;

  const batters = side === "away" ? data.away : data.home;
  if (!batters?.length) return null;

  let best = null;
  let bestScore = 0;
  for (const b of batters) {
    const s = b.stats;
    const score = (s.h || 0) * 2 + (s.hr || 0) * 4 + (s.rbi || 0) * 2 + (s.r || 0);
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }

  if (!best || bestScore === 0) return null;

  const s = best.stats;
  const line = `${s.h}-${s.ab}${s.hr ? `, ${s.hr} HR` : ""}${s.rbi ? `, ${s.rbi} RBI` : ""}`;

  return (
    <span
      className="sb-top-performer sb-player-link"
      role="link"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${best.id}`); }}
    >
      {lastName(best.name)} {line}
    </span>
  );
}

function PitcherRecord({ pitcherId, type }) {
  const { data } = useQuery({
    queryKey: ["pitcherSeasonStats", pitcherId],
    queryFn: () => fetchPitcherSeasonStats(pitcherId),
    enabled: !!pitcherId,
    staleTime: 1000 * 60 * 60,
  });
  if (!data) return null;
  if (type === "save") return <span className="sb-decision-record">({data.saves || 0})</span>;
  return <span className="sb-decision-record">({data.wins}-{data.losses})</span>;
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

function MatchupHero({ game }) {
  return (
    <div className="sb-matchup-hero">
      <HeroTeam side="away" team={game.away} />
      <span className="sb-hero-vs" aria-hidden="true">VS</span>
      <HeroTeam side="home" team={game.home} />
    </div>
  );
}

function HeroTeam({ side, team }) {
  return (
    <div className={`sb-hero-team sb-hero-${side}`}>
      <div className="sb-hero-team-logo-wrap">
        <img src={team.logoUrl} alt={team.abbreviation} className="sb-hero-team-logo" />
      </div>
      <div className="sb-hero-team-text">
        <span className="sb-hero-team-name">{team.abbreviation}</span>
        {team.wins != null && (
          <span className="sb-hero-team-record">{team.wins}-{team.losses}</span>
        )}
      </div>
    </div>
  );
}

function PitcherMatchupLine({ game, teamId, navigate, hero = false }) {
  const away = game.away.probablePitcher;
  const home = game.home.probablePitcher;
  if (!away?.id && !home?.id) return null;

  const clickPitcher = (p) => (e) => {
    if (!p?.id) return;
    e.stopPropagation();
    navigate(`/team/${teamId}/player/${p.id}`);
  };

  const renderSlot = (p, side) => {
    const has = !!p?.id;
    const displayName = hero
      ? (p?.fullName || "TBD")
      : (p?.fullName ? lastName(p.fullName) : "TBD");

    if (hero) {
      return (
        <div
          className={`sb-pitcher-line-slot sb-pitcher-line-slot-${side} sb-pitcher-line-slot-hero ${has ? "sb-player-link" : ""}`}
          onClick={clickPitcher(p)}
        >
          {has && <PlayerPhoto playerId={p.id} name={p.fullName} size={28} className="sb-pitcher-hero-photo" />}
          <div className="sb-pitcher-hero-text">
            <span className="sb-pitcher-line-name">{displayName}</span>
            {has && <PitcherStats pitcherId={p.id} />}
          </div>
        </div>
      );
    }

    return (
      <div
        className={`sb-pitcher-line-slot sb-pitcher-line-slot-${side} ${has ? "sb-player-link" : ""}`}
        onClick={clickPitcher(p)}
      >
        <span className="sb-pitcher-line-name">{displayName}</span>
        {has && <PitcherStats pitcherId={p.id} />}
      </div>
    );
  };

  return (
    <div className={`sb-pitcher-line ${hero ? "sb-pitcher-line-hero" : "sb-pitcher-line-compact"}`}>
      <span className="sb-pitcher-line-label">Pitching</span>
      <div className="sb-pitcher-line-row">
        {renderSlot(away, "away")}
        {renderSlot(home, "home")}
      </div>
    </div>
  );
}

function ScoreDisplay({ value, className = "" }) {
  const prev = useRef(value);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (prev.current !== value && prev.current !== undefined && prev.current !== null) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 700);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);
  return <span className={`scoreboard-score ${className} ${flash ? "sb-score-just-changed" : ""}`}>{value}</span>;
}

function InningProgressBar({ inning, total = 9 }) {
  const segs = Math.max(total, inning ?? 0);
  return (
    <div className="sb-inning-bar" aria-hidden="true">
      {Array.from({ length: segs }).map((_, i) => {
        const n = i + 1;
        const cls = inning != null && n < inning ? "done" : n === inning ? "current" : "";
        return <span key={n} className={`sb-inning-seg ${cls}`} />;
      })}
    </div>
  );
}

function deriveWeatherMod(condition) {
  if (!condition) return "";
  const c = condition.toLowerCase();
  if (c.includes("rain") || c.includes("drizzle") || c.includes("shower")) return "sb-weather-rain";
  if (c.includes("sunny") || c.includes("clear")) return "sb-weather-sunny";
  if (c.includes("cloud") || c.includes("overcast")) return "sb-weather-cloudy";
  if (c.includes("dome") || c.includes("roof")) return "sb-weather-dome";
  return "";
}

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
        <span className="sb-batter-name-link" role="link" tabIndex={0} onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${batter.id}`); }}>{batter.name}</span>
        <span className="sb-batter-spacer" />
        <span className="sb-batter-stat">{batter.stats.ab}</span>
        <span className="sb-batter-stat">{batter.stats.r}</span>
        <span className="sb-batter-stat">{batter.stats.h}</span>
        <span className="sb-batter-stat">{batter.stats.hr}</span>
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
          {batter.atBats.map((ab, i) => {
            const ord = ab.inning === 1 ? "1st" : ab.inning === 2 ? "2nd" : ab.inning === 3 ? "3rd" : `${ab.inning}th`;
            return (
              <div key={i} className={`sb-atbat ${ab.isScoring ? "sb-atbat-scoring" : ""}`}>
                <span className="sb-atbat-inning">{ord}</span>
                <span className="sb-atbat-event">{ab.shortDesc || ab.event}</span>
                {ab.rbi > 0 && <span className="sb-atbat-rbi">{ab.rbi} RBI</span>}
              </div>
            );
          })}
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
        <span className="sb-batter-stat sb-stat-hdr">HR</span>
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

function GameDetail({ gamePk, awayAbbr, homeAbbr, awayId, homeId, teamId }) {
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
            const battingTeamId = isTop ? awayId : homeId;
            const color = ALL_TEAMS[battingTeamId]?.primary || "var(--team-secondary)";
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

function LiveGameInfo({ gamePk, teamId, isOurGame }) {
  const navigate = useNavigate();
  const { data: liveState } = useQuery({
    queryKey: ["liveGameState", gamePk],
    queryFn: () => fetchLiveGameState(gamePk),
    enabled: !!gamePk,
    staleTime: 1000 * 20,
    refetchInterval: 1000 * 20,
  });

  const { data: gameDetail } = useQuery({
    queryKey: ["gameDetail", gamePk],
    queryFn: () => fetchGameDetail(gamePk),
    enabled: !!gamePk,
    staleTime: 1000 * 60 * 2,
    refetchInterval: 1000 * 60,
  });

  if (!liveState) return null;

  const lastPlay = gameDetail?.scoringPlays?.[gameDetail.scoringPlays.length - 1];
  const tickerText = lastPlay
    ? `Top ${lastPlay.inning === undefined ? "" : lastPlay.inning} · ${lastPlay.description}`
    : null;

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
        <svg className={`sb-live-diamond ${isOurGame ? "sb-our-diamond" : ""}`} width="52" height="52" viewBox="-2 -2 56 56">
          <rect x="17" y="2" width="12" height="12" rx="1.5" transform="rotate(45 23 8)" className={`sb-live-base ${liveState.onSecond ? "occupied" : ""}`} />
          <rect x="30" y="15" width="12" height="12" rx="1.5" transform="rotate(45 36 21)" className={`sb-live-base ${liveState.onFirst ? "occupied" : ""}`} />
          <rect x="4" y="15" width="12" height="12" rx="1.5" transform="rotate(45 10 21)" className={`sb-live-base ${liveState.onThird ? "occupied" : ""}`} />
          <circle cx="23" cy="34" r="2.5" fill="var(--text-muted)" opacity="0.3" />
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
      {tickerText && (
        <div className="sb-last-play" aria-live="polite">
          <span className="sb-last-play-label">Last</span>
          <span className="sb-last-play-text">{tickerText}</span>
        </div>
      )}
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
  const rawDate = searchParams.get("date");
  const paramDate = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
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

  const { data: games, isLoading, error } = useQuery({
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

  // Sort: our team first, partner team second (SEA↔ATL), then live, scheduled, final
  const PARTNER_TEAMS = { 136: 144, 144: 136 }; // SEA ↔ ATL
  const partnerTeamId = PARTNER_TEAMS[teamId];

  const sorted = games?.length
    ? [...games].sort((a, b) => {
        const gameTeams = (g) => [g.home.id, g.away.id];
        const aIsOurs = gameTeams(a).includes(teamId);
        const bIsOurs = gameTeams(b).includes(teamId);
        const aIsPartner = partnerTeamId && gameTeams(a).includes(partnerTeamId);
        const bIsPartner = partnerTeamId && gameTeams(b).includes(partnerTeamId);

        // Our team always first
        if (aIsOurs && !bIsOurs) return -1;
        if (!aIsOurs && bIsOurs) return 1;
        // Partner team second
        if (aIsPartner && !bIsPartner && !bIsOurs) return -1;
        if (!aIsPartner && !aIsOurs && bIsPartner) return 1;

        const statusOrder = { "In Progress": 0, "Delayed": 0.5, "Delayed Start": 0.5, "Pre-Game": 1, Warmup: 1, Scheduled: 2, Final: 3 };
        return (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
      })
    : [];

  const isMyTeamGame = (g) =>
    g.home.id === teamId ||
    g.away.id === teamId ||
    (partnerTeamId && (g.home.id === partnerTeamId || g.away.id === partnerTeamId));

  const groups = { myTeams: [], live: [], upcoming: [], final: [] };
  for (const g of sorted) {
    if (isMyTeamGame(g)) groups.myTeams.push(g);
    else if (g.status === "In Progress" || g.status === "Delayed" || g.status === "Delayed Start") groups.live.push(g);
    else if (g.status === "Final" || g.status === "Game Over") groups.final.push(g);
    else groups.upcoming.push(g);
  }

  return (
    <div className="scoreboard-page">
      <div className="scoreboard-date-nav">
        <div className="scoreboard-date-center">
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
          <button className="scoreboard-date-btn" onClick={() => goDay(1)} aria-label="Next day">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
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
      </div>

      {isLoading && <SkeletonLoader variant="scores" />}

      {error && <div className="scoreboard-error">Failed to load scores. Pull down to refresh.</div>}

      {!isLoading && !error && !sorted.length && (
        <div className="scoreboard-empty">
          <h2>No Games</h2>
          <p>No games scheduled for {formatDateLabel(selectedDate)}.</p>
        </div>
      )}

      {sorted.length > 0 && (
        <div className="scoreboard-list">
          {(() => {
          const renderCard = (game) => {
            const isOurGame = game.home.id === teamId || game.away.id === teamId;
            const isLive = game.status === "In Progress";
            const isDelayed = game.status === "Delayed Start" || game.status === "Delayed";
            const isFinal = game.status === "Final" || game.status === "Game Over";
            const isScheduled = !isLive && !isDelayed && !isFinal;

            const isExpanded = expandedGame === game.gamePk;
            const canExpand = isLive || isFinal;

            const awayWon = isFinal && game.away.score > game.home.score;
            const homeWon = isFinal && game.home.score > game.away.score;

            const awayColor = ALL_TEAMS[game.away.id]?.primary || "transparent";
            const homeColor = ALL_TEAMS[game.home.id]?.primary || "transparent";
            const scoreDiff = Math.abs((game.away.score ?? 0) - (game.home.score ?? 0));
            const isCloseGame = isLive && scoreDiff <= 2 && (game.inning ?? 0) >= 6;
            const isBlowout = isLive && scoreDiff >= 6 && (game.inning ?? 0) >= 6;
            const weatherMod = isScheduled ? deriveWeatherMod(game.weather?.condition) : "";

            return (
              <div
                key={game.gamePk}
                className={`scoreboard-card ${isOurGame ? "our-game" : ""} ${isLive ? "live" : ""} ${isCloseGame ? "sb-close-game" : ""} ${isBlowout ? "sb-blowout" : ""} ${weatherMod} ${canExpand ? "sb-tappable" : ""}`}
                style={{ "--away-color": awayColor, "--home-color": homeColor }}
                onClick={canExpand ? () => setExpandedGame(isExpanded ? null : game.gamePk) : undefined}
                role={canExpand ? "button" : undefined}
                tabIndex={canExpand ? 0 : undefined}
                onKeyDown={canExpand ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedGame(isExpanded ? null : game.gamePk); } } : undefined}
              >
                {isOurGame && (
                  <img
                    className="sb-hero-watermark"
                    src={game.home.id === teamId ? game.home.logoUrl : game.away.logoUrl}
                    alt=""
                    aria-hidden="true"
                  />
                )}
                <div className="sb-matchup-link" onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/${isLive || isFinal ? "live" : "matchup"}/${game.gamePk}`); }}>
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
                {isScheduled && <div className="scoreboard-status-badge sb-scheduled-time">{formatGameTime(game.gameDate)}</div>}

                {isScheduled && (
                  <>
                    <MatchupHero game={game} />
                    <PitcherMatchupLine game={game} teamId={teamId} navigate={navigate} hero={isMyTeamGame(game)} />
                  </>
                )}

                {!isScheduled && (
                  <div className="scoreboard-teams">
                    <div className={`scoreboard-team-row ${isFinal ? (awayWon ? "sb-winner" : "sb-loser") : ""}`}>
                      <img src={game.away.logoUrl} alt={game.away.abbreviation} className="scoreboard-logo" />
                      <span className="scoreboard-abbr">{game.away.abbreviation}</span>
                      {!isFinal && game.away.wins != null && (
                        <span className="scoreboard-record">{game.away.wins}-{game.away.losses}</span>
                      )}
                      {isFinal && <TopPerformer gamePk={game.gamePk} side="away" teamId={teamId} />}
                      {(isLive || isFinal) && (
                        <ScoreDisplay value={game.away.score} />
                      )}
                    </div>
                    <div className={`scoreboard-team-row ${isFinal ? (homeWon ? "sb-winner" : "sb-loser") : ""}`}>
                      <img src={game.home.logoUrl} alt={game.home.abbreviation} className="scoreboard-logo" />
                      <span className="scoreboard-abbr">{game.home.abbreviation}</span>
                      {!isFinal && game.home.wins != null && (
                        <span className="scoreboard-record">{game.home.wins}-{game.home.losses}</span>
                      )}
                      {isFinal && <TopPerformer gamePk={game.gamePk} side="home" teamId={teamId} />}
                      {(isLive || isFinal) && (
                        <ScoreDisplay value={game.home.score} />
                      )}
                    </div>
                  </div>
                )}
                {(isLive || isFinal) && (
                  <InningProgressBar
                    inning={isFinal ? (game.linescore?.innings?.length ?? 9) + 1 : game.inning}
                    total={isFinal ? (game.linescore?.innings?.length ?? 9) : 9}
                  />
                )}
                </div>

                {/* Live game: batter, pitcher, diamond, outs, count */}
                {isLive && game.gamePk && (
                  <LiveGameInfo gamePk={game.gamePk} teamId={teamId} isOurGame={isOurGame} />
                )}

                {/* Decisions for final games */}
                {isFinal && game.decisions && (
                  <div className="sb-decisions">
                    {game.decisions.winner && (
                      <span className="sb-decision">
                        <span className="sb-decision-label">W:</span>
                        <span className="sb-player-link" onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${game.decisions.winner.id}`); }}>
                          {lastName(game.decisions.winner.name)}
                        </span>
                        <PitcherRecord pitcherId={game.decisions.winner.id} type="wl" />
                      </span>
                    )}
                    {game.decisions.loser && (
                      <span className="sb-decision">
                        <span className="sb-decision-label">L:</span>
                        <span className="sb-player-link" onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${game.decisions.loser.id}`); }}>
                          {lastName(game.decisions.loser.name)}
                        </span>
                        <PitcherRecord pitcherId={game.decisions.loser.id} type="wl" />
                      </span>
                    )}
                    {game.decisions.save && (
                      <span className="sb-decision">
                        <span className="sb-decision-label">SV:</span>
                        <span className="sb-player-link" onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${game.decisions.save.id}`); }}>
                          {lastName(game.decisions.save.name)}
                        </span>
                        <PitcherRecord pitcherId={game.decisions.save.id} type="save" />
                      </span>
                    )}
                  </div>
                )}

                {/* Watch button for our live games (no venue row) */}
                {isOurGame && isLive && (
                  <button
                    className="scoreboard-watch-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.location.href = `https://www.mlb.com/tv/g${game.gamePk}`;
                    }}
                    aria-label="Watch game"
                  >
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    Watch
                  </button>
                )}

                {/* Gameday link for all active games */}
                {isLive && !isOurGame && (
                  <a
                    className="scoreboard-gameday-link"
                    href={`https://www.mlb.com/tv/g${game.gamePk}`}
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

                {/* Expand indicator (live/final only — scheduled cards route to matchup on tap) */}
                {canExpand && (
                  <div className="sb-expand-hint">
                    <span className="sb-expand-label">{isExpanded ? "Hide" : "Stats"}</span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                )}

                {/* Expanded game detail */}
                {isExpanded && !isScheduled && (
                  <div className="sb-game-detail" onClick={(e) => e.stopPropagation()}>
                    <Linescore linescore={game.linescore} away={game.away} home={game.home} />
                    <GameDetail gamePk={game.gamePk} awayAbbr={game.away.abbreviation} homeAbbr={game.home.abbreviation} awayId={game.away.id} homeId={game.home.id} teamId={teamId} />
                  </div>
                )}

                {isLive && <span className="sb-grass-strip" aria-hidden="true" />}
              </div>
            );
          };
          return (
            <>
              {groups.myTeams.length > 0 && (
                <>
                  <h3 className="sb-section-hdr">My Teams</h3>
                  {groups.myTeams.map(renderCard)}
                </>
              )}
              {groups.live.length > 0 && (
                <>
                  <h3 className="sb-section-hdr sb-section-hdr-live">
                    <span className="sb-section-hdr-dot" aria-hidden="true" />Live
                  </h3>
                  {groups.live.map(renderCard)}
                </>
              )}
              {groups.upcoming.length > 0 && (
                <>
                  <h3 className="sb-section-hdr">Upcoming</h3>
                  <div className="sb-upcoming-grid">
                    {groups.upcoming.map(renderCard)}
                  </div>
                </>
              )}
              {groups.final.length > 0 && (
                <>
                  <h3 className="sb-section-hdr">Final</h3>
                  {groups.final.map(renderCard)}
                </>
              )}
            </>
          );
          })()}
        </div>
      )}
    </div>
  );
}
