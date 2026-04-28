import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchAllGamesToday, fetchPitcherSeasonStats, fetchBvP, fetchRoster, fetchGameDetail, fetchGameLineup, fetchProjectedLineup, fetchLiveGameState, fetchOddsForDate, ODDS_PROXY_CONFIGURED } from "../../api/client";
import { formatGameTime, getTeamAbbr, lastName, shortName, teamDisplayName, teamNickname } from "../../utils/formatters";
import SkeletonLoader from "../common/SkeletonLoader";
import PlayerPhoto from "../common/PlayerPhoto";
import { Tabs, TabList, Tab, TabPanel } from "../common/Tabs";
import ALL_TEAMS from "../../data/teams";
import { useIsMobile } from "../../utils/useIsMobile";

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

function describeBases(liveState) {
  const on = [];
  if (liveState.onFirst) on.push("first");
  if (liveState.onSecond) on.push("second");
  if (liveState.onThird) on.push("third");
  if (on.length === 0) return "Bases empty";
  return `Runners on ${on.join(", ")}`;
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
    <button
      type="button"
      className="sb-top-performer sb-player-link"
      onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${best.id}`); }}
      aria-label={`${best.name}: ${line}. View player page.`}
    >
      {lastName(best.name)} {line}
    </button>
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
        const hrText = m.bvp.homeRuns > 0 ? `, ${m.bvp.homeRuns} HR` : "";
        return (
          <button
            key={m.id}
            type="button"
            className="sb-bvp-row sb-tappable"
            onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${m.id}`); }}
            aria-label={`${m.fullName}: ${m.bvp.hits} for ${m.bvp.ab}, ${avg}${hrText}. View player page.`}
          >
            <span className="sb-bvp-name">{lastName(m.fullName)}</span>
            <span className="sb-bvp-stat">
              {m.bvp.hits}-{m.bvp.ab} ({avg}){hrText}
            </span>
          </button>
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
        <caption className="sr-only">
          Linescore: {away.abbreviation} versus {home.abbreviation}
        </caption>
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">Team</span></th>
            {linescore.innings.map((inn) => (
              <th key={inn.num} scope="col">{inn.num}</th>
            ))}
            <th scope="col" className="sb-ls-total">R</th>
            <th scope="col" className="sb-ls-total">H</th>
            <th scope="col" className="sb-ls-total">E</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className="sb-ls-team">{away.abbreviation}</th>
            {linescore.innings.map((inn) => (
              <td key={inn.num}>{inn.away !== "" ? inn.away : "-"}</td>
            ))}
            <td className="sb-ls-total">{linescore.away.runs}</td>
            <td className="sb-ls-total">{linescore.away.hits}</td>
            <td className="sb-ls-total">{linescore.away.errors}</td>
          </tr>
          <tr>
            <th scope="row" className="sb-ls-team">{home.abbreviation}</th>
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

function OddsRefreshBar({ oddsQuery }) {
  const { data, isFetching, isError, error, refetch, dataUpdatedAt } = oddsQuery;
  const [tick, setTick] = useState(0);
  // re-render every 30s so the "updated Xm ago" label stays fresh
  useEffect(() => {
    if (!dataUpdatedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, [dataUpdatedAt]);

  let status = null;
  if (isFetching) {
    status = <span className="sb-odds-status">Refreshing…</span>;
  } else if (isError) {
    status = <span className="sb-odds-status sb-odds-status--err">Odds unavailable{error?.message ? ` (${error.message})` : ""}</span>;
  } else if (dataUpdatedAt) {
    const mins = Math.max(0, Math.round((Date.now() - dataUpdatedAt) / 60000));
    const label = mins === 0 ? "just now" : `${mins}m ago`;
    const count = data?.byMatchup?.size ?? 0;
    status = <span className="sb-odds-status">Updated {label} · {count} game{count === 1 ? "" : "s"}</span>;
  } else {
    status = <span className="sb-odds-status sb-odds-status--muted">Tap to load pregame moneylines</span>;
  }

  return (
    <div className="sb-odds-bar" role="region" aria-label="Pregame moneyline odds controls" data-tick={tick}>
      <button
        type="button"
        className="sb-odds-refresh-btn"
        onClick={() => refetch()}
        disabled={isFetching}
        aria-busy={isFetching}
      >
        <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
        <span>{dataUpdatedAt ? "Refresh Odds" : "Load Odds"}</span>
      </button>
      {status}
    </div>
  );
}

function formatMoneyline(price) {
  if (typeof price !== "number" || !Number.isFinite(price)) return null;
  const rounded = Math.round(price);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function MoneylinePill({ side }) {
  if (!side || typeof side.price !== "number") return null;
  const text = formatMoneyline(side.price);
  if (!text) return null;
  const cls = side.price < 0 ? "sb-ml-pill sb-ml-pill--neg" : "sb-ml-pill sb-ml-pill--pos";
  const aria = `Moneyline ${text}, consensus across ${side.n_books || 0} book${side.n_books === 1 ? "" : "s"}`;
  return (
    <span className={cls} aria-label={aria} title={`Median across ${side.n_books || 0} US books`}>
      {text}
    </span>
  );
}

function MatchupHero({ game, awayOdds, homeOdds }) {
  return (
    <div className="sb-matchup-hero">
      <HeroTeam side="away" team={game.away} odds={awayOdds} />
      <span className="sb-hero-vs" aria-hidden="true">VS</span>
      <HeroTeam side="home" team={game.home} odds={homeOdds} />
    </div>
  );
}

function HeroTeam({ side, team, odds }) {
  return (
    <div className={`sb-hero-team sb-hero-${side}`}>
      <div className="sb-hero-team-logo-wrap">
        <img src={team.logoUrl} alt="" className="sb-hero-team-logo" />
      </div>
      <div className="sb-hero-team-text">
        <span className="sb-hero-team-name">{team.abbreviation}</span>
        {team.wins != null && (
          <span className="sb-hero-team-record">{team.wins}-{team.losses}</span>
        )}
        <MoneylinePill side={odds} />
      </div>
    </div>
  );
}

function PitcherMatchupLine({ game, teamId, navigate, hero = false }) {
  const away = game.away.probablePitcher;
  const home = game.home.probablePitcher;
  if (!away?.id && !home?.id) return null;

  const renderSlot = (p, side) => {
    const has = !!p?.id;
    const displayName = hero
      ? (p?.fullName || "TBD")
      : (p?.fullName ? lastName(p.fullName) : "TBD");

    const slotClass = `sb-pitcher-line-slot sb-pitcher-line-slot-${side}${hero ? " sb-pitcher-line-slot-hero" : ""}`;

    if (!has) {
      return (
        <div className={slotClass}>
          {hero ? (
            <div className="sb-pitcher-hero-text">
              <span className="sb-pitcher-line-name">{displayName}</span>
            </div>
          ) : (
            <span className="sb-pitcher-line-name">{displayName}</span>
          )}
        </div>
      );
    }

    return (
      <button
        type="button"
        className={`${slotClass} sb-player-link`}
        onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${p.id}`); }}
        aria-label={`View ${p.fullName} player page`}
      >
        {hero ? (
          <>
            <PlayerPhoto playerId={p.id} name={p.fullName} size={28} className="sb-pitcher-hero-photo" />
            <div className="sb-pitcher-hero-text">
              <span className="sb-pitcher-line-name">{displayName}</span>
              <PitcherStats pitcherId={p.id} />
            </div>
          </>
        ) : (
          <>
            <span className="sb-pitcher-line-name">{displayName}</span>
            <PitcherStats pitcherId={p.id} />
          </>
        )}
      </button>
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

function MobileGameCard({ game, oddsRow, teamId, navigate, isMyTeam }) {
  const isLive = game.status === "In Progress";
  const isDelayed = game.status === "Delayed Start" || game.status === "Delayed";
  const isFinal = game.status === "Final" || game.status === "Game Over";
  const isScheduled = !isLive && !isDelayed && !isFinal;

  const awayWon = isFinal && game.away.score > game.home.score;
  const homeWon = isFinal && game.home.score > game.away.score;

  const matchupRoute = `/team/${teamId}/${isLive || isFinal ? "live" : "matchup"}/${game.gamePk}`;
  const actionLabel = (isLive || isFinal) ? "Stats" : "Matchup";

  let statusEl = null;
  if (isLive) {
    const half = game.inningHalf === "Top" ? "Top" : "Bot";
    statusEl = (
      <div
        className="sb-m-status sb-m-status--live"
        aria-label={`Live, ${half === "Top" ? "top" : "bottom"} of inning ${game.inning}`}
      >
        <span className="sb-m-live-dot" aria-hidden="true" />
        LIVE · {half} {game.inning}
      </div>
    );
  } else if (isDelayed) {
    statusEl = <div className="sb-m-status sb-m-status--delayed">DELAYED</div>;
  } else if (isFinal) {
    const extra = game.linescore && game.linescore.innings.length > 9 ? `/${game.linescore.innings.length}` : "";
    statusEl = <div className="sb-m-status sb-m-status--final">FINAL{extra}</div>;
  }

  const renderRowRight = (team, isFirstRow) => {
    if (isLive || isFinal) {
      return <span className="sb-m-score">{team.score ?? "—"}</span>;
    }
    // Scheduled or delayed: show time on the first row only.
    return isFirstRow
      ? <span className="sb-m-time">{formatGameTime(game.gameDate)}</span>
      : null;
  };

  const renderTeamRow = (team, isHome, isFirstRow) => {
    const isWinner = isFinal && (isHome ? homeWon : awayWon);
    const isLoser = isFinal && !isWinner && game.away.score !== game.home.score;
    const pitcher = team.probablePitcher;
    const pitcherShort = pitcher?.fullName ? shortName(pitcher.fullName) : null;
    const recordLabel = team.wins != null ? `, record ${team.wins} and ${team.losses}` : "";
    const scoreLabel = (isLive || isFinal) ? `, score ${team.score}` : "";
    const pitcherLabel = pitcherShort ? `, pitcher ${pitcher.fullName}` : "";
    return (
      <button
        type="button"
        className={`sb-m-team-row${isWinner ? " sb-m-winner" : ""}${isLoser ? " sb-m-loser" : ""}`}
        onClick={() => navigate(matchupRoute)}
        aria-label={`${team.name}${recordLabel}${pitcherLabel}${scoreLabel}. View ${isLive || isFinal ? "live game" : "matchup"}.`}
      >
        <img src={team.logoUrl} alt="" className="sb-m-logo" />
        <span className="sb-m-name-block">
          <span className="sb-m-name">{teamNickname(team.abbreviation)}</span>
          {pitcherShort && <span className="sb-m-pitcher">{pitcherShort}</span>}
        </span>
        <span className="sb-m-record">
          {team.wins != null ? `${team.wins}-${team.losses}` : ""}
        </span>
        <div className="sb-m-right">
          {renderRowRight(team, isFirstRow)}
        </div>
      </button>
    );
  };

  // Pregame odds — single row, three cells: away ML · home ML · total line.
  // Only the total LINE is shown (no over/under prices); price detail lives
  // on the dedicated Edge tab. Cells flex with space-between so they breathe.
  const awayML = isScheduled ? formatMoneyline(oddsRow?.away?.price) : null;
  const homeML = isScheduled ? formatMoneyline(oddsRow?.home?.price) : null;
  const hasMoneyline = !!(awayML && homeML);
  const totalLine = isScheduled && oddsRow?.total?.line != null ? oddsRow.total.line : null;
  const showOddsCard = hasMoneyline || totalLine != null;

  const oddsAriaParts = [];
  if (hasMoneyline) {
    oddsAriaParts.push(`Moneyline ${game.away.abbreviation} ${awayML}, ${game.home.abbreviation} ${homeML}`);
  }
  if (totalLine != null) {
    oddsAriaParts.push(`Total ${totalLine}`);
  }

  return (
    <article
      className={`scoreboard-card sb-m-card${isLive ? " live" : ""}${isMyTeam ? " our-game" : ""}`}
      aria-label={`${game.away.abbreviation} at ${game.home.abbreviation}`}
    >
      {statusEl}
      <div className="sb-m-rows">
        {renderTeamRow(game.away, false, true)}
        {renderTeamRow(game.home, true, false)}
      </div>

      {showOddsCard && (
        <div
          className="sb-m-odds-flat"
          role="group"
          aria-label={oddsAriaParts.join("; ")}
        >
          {hasMoneyline && (
            <>
              <span className="sb-m-odds-cell">
                <span className="sb-m-odds-team">{game.away.abbreviation}</span>
                <span className="sb-m-odds-price">{awayML}</span>
              </span>
              <span className="sb-m-odds-cell">
                <span className="sb-m-odds-team">{game.home.abbreviation}</span>
                <span className="sb-m-odds-price">{homeML}</span>
              </span>
            </>
          )}
          {totalLine != null && (
            <span className="sb-m-odds-cell sb-m-odds-cell--total">
              <span className="sb-m-odds-team">Total</span>
              <span className="sb-m-odds-price">{totalLine}</span>
            </span>
          )}
        </div>
      )}

      <button
        type="button"
        className="sb-m-action"
        onClick={() => navigate(matchupRoute)}
        aria-label={`Open ${actionLabel.toLowerCase()} page`}
      >
        {actionLabel} ›
      </button>
    </article>
  );
}

function ScoreDisplay({ value, className = "", label }) {
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
  return (
    <span
      className={`scoreboard-score ${className} ${flash ? "sb-score-just-changed" : ""}`}
      aria-live="polite"
      aria-atomic="true"
      aria-label={label ? `${label}: ${value}` : undefined}
    >
      {value}
    </span>
  );
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
  const panelId = `batter-abs-${batter.id}`;

  const summary = `${batter.name}, ${batter.position}: ${batter.stats.ab} at-bats, ${batter.stats.r} runs, ${batter.stats.h} hits, ${batter.stats.hr} home runs, ${batter.stats.rbi} RBI, ${batter.stats.bb} walks, ${batter.stats.k} strikeouts`;

  return (
    <div className="sb-batter">
      {hasABs ? (
        <button
          type="button"
          className="sb-batter-row sb-tappable"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          aria-label={`${summary}. Toggle at-bats.`}
        >
          <span className="sb-batter-pos" aria-hidden="true">{batter.position}</span>
          <span className="sb-batter-name" aria-hidden="true">{batter.name}</span>
          <span className="sb-batter-spacer" aria-hidden="true" />
          <span className="sb-batter-stat" aria-hidden="true">{batter.stats.ab}</span>
          <span className="sb-batter-stat" aria-hidden="true">{batter.stats.r}</span>
          <span className="sb-batter-stat" aria-hidden="true">{batter.stats.h}</span>
          <span className="sb-batter-stat" aria-hidden="true">{batter.stats.hr}</span>
          <span className="sb-batter-stat" aria-hidden="true">{batter.stats.rbi}</span>
          <span className="sb-batter-stat" aria-hidden="true">{batter.stats.bb}</span>
          <span className="sb-batter-stat" aria-hidden="true">{batter.stats.k}</span>
          <svg
            className="sb-batter-chevron"
            width="10" height="10" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2.5"
            aria-hidden="true" focusable="false"
            style={{ transform: open ? "rotate(180deg)" : "none" }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          className="sb-batter-row"
          onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${batter.id}`); }}
          aria-label={`${summary}. View player page.`}
        >
          <span className="sb-batter-pos" aria-hidden="true">{batter.position}</span>
          <span className="sb-batter-name" aria-hidden="true">{batter.name}</span>
          <span className="sb-batter-spacer" aria-hidden="true" />
          <span className="sb-batter-stat" aria-hidden="true">{batter.stats.ab}</span>
          <span className="sb-batter-stat" aria-hidden="true">{batter.stats.r}</span>
          <span className="sb-batter-stat" aria-hidden="true">{batter.stats.h}</span>
          <span className="sb-batter-stat" aria-hidden="true">{batter.stats.hr}</span>
          <span className="sb-batter-stat" aria-hidden="true">{batter.stats.rbi}</span>
          <span className="sb-batter-stat" aria-hidden="true">{batter.stats.bb}</span>
          <span className="sb-batter-stat" aria-hidden="true">{batter.stats.k}</span>
        </button>
      )}
      {open && hasABs && (
        <div className="sb-atbats" id={panelId} role="region" aria-label={`${batter.name} at-bats`}>
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
    <div className="sb-team-box" role="table" aria-label={`${teamDisplayName(abbr)} box score`}>
      <div className="sb-box-header" role="rowgroup">
        <div role="row">
          <span className="sb-batter-pos" role="columnheader"></span>
          <span className="sb-batter-name sb-box-team" role="columnheader">{teamDisplayName(abbr)}</span>
          <span className="sb-batter-stat sb-stat-hdr" role="columnheader" title="At-bats">AB</span>
          <span className="sb-batter-stat sb-stat-hdr" role="columnheader" title="Runs">R</span>
          <span className="sb-batter-stat sb-stat-hdr" role="columnheader" title="Hits">H</span>
          <span className="sb-batter-stat sb-stat-hdr" role="columnheader" title="Home runs">HR</span>
          <span className="sb-batter-stat sb-stat-hdr" role="columnheader" title="Runs batted in">RBI</span>
          <span className="sb-batter-stat sb-stat-hdr" role="columnheader" title="Walks">BB</span>
          <span className="sb-batter-stat sb-stat-hdr" role="columnheader" title="Strikeouts">K</span>
          <span style={{ width: 10 }}></span>
        </div>
      </div>
      <div role="rowgroup">
        {batters.map((b) => (
          <BatterRow key={b.id} batter={b} teamId={teamId} />
        ))}
      </div>
    </div>
  );
}

function TeamPitchingBox({ pitchers, abbr, teamId }) {
  const navigate = useNavigate();
  if (!pitchers?.length) return null;

  return (
    <div className="sb-team-box sb-pitching-box" role="table" aria-label={`${teamDisplayName(abbr)} pitching box score`}>
      <div className="sb-box-header" role="rowgroup">
        <div role="row">
          <span className="sb-batter-name sb-box-team" role="columnheader">{teamDisplayName(abbr)} Pitching</span>
          <span className="sb-batter-stat sb-stat-hdr" role="columnheader" title="Innings pitched">IP</span>
          <span className="sb-batter-stat sb-stat-hdr" role="columnheader" title="Hits">H</span>
          <span className="sb-batter-stat sb-stat-hdr" role="columnheader" title="Runs">R</span>
          <span className="sb-batter-stat sb-stat-hdr" role="columnheader" title="Earned runs">ER</span>
          <span className="sb-batter-stat sb-stat-hdr" role="columnheader" title="Walks">BB</span>
          <span className="sb-batter-stat sb-stat-hdr" role="columnheader" title="Strikeouts">K</span>
          <span className="sb-batter-stat sb-stat-hdr sb-pc-hdr" role="columnheader" title="Pitch count">PC</span>
        </div>
      </div>
      <div role="rowgroup">
        {pitchers.map((p) => {
          const summary = `${p.name}${p.note ? ` ${p.note}` : ""}: ${p.stats.ip} innings, ${p.stats.h} hits, ${p.stats.r} runs, ${p.stats.er} earned runs, ${p.stats.bb} walks, ${p.stats.k} strikeouts, ${p.stats.pitches} pitches`;
          return (
            <button
              key={p.id}
              type="button"
              className="sb-batter-row"
              role="row"
              onClick={() => navigate(`/team/${teamId}/player/${p.id}`)}
              aria-label={`${summary}. View player page.`}
            >
              <span className="sb-batter-name" role="cell" aria-hidden="true">{p.name}{p.note ? ` ${p.note}` : ""}</span>
              <span className="sb-batter-stat" role="cell" aria-hidden="true">{p.stats.ip}</span>
              <span className="sb-batter-stat" role="cell" aria-hidden="true">{p.stats.h}</span>
              <span className="sb-batter-stat" role="cell" aria-hidden="true">{p.stats.r}</span>
              <span className="sb-batter-stat" role="cell" aria-hidden="true">{p.stats.er}</span>
              <span className="sb-batter-stat" role="cell" aria-hidden="true">{p.stats.bb}</span>
              <span className="sb-batter-stat" role="cell" aria-hidden="true">{p.stats.k}</span>
              <span className="sb-batter-stat sb-pc" role="cell" aria-hidden="true">{p.stats.pitches}</span>
            </button>
          );
        })}
      </div>
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

  if (isLoading) return <div className="sb-plays-loading" role="status" aria-live="polite">Loading…</div>;
  if (!data) return <div className="sb-plays-empty">No data available</div>;

  return (
    <Tabs value={tab} onChange={setTab} ariaLabel="Game detail view">
      <TabList className="sb-detail-tabs">
        <Tab tabKey="scoring" className="sb-detail-tab" activeClassName="sb-detail-tab-active">Scoring</Tab>
        <Tab tabKey="boxscore" className="sb-detail-tab" activeClassName="sb-detail-tab-active">Box Score</Tab>
      </TabList>

      <TabPanel tabKey="scoring">
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
      </TabPanel>

      <TabPanel tabKey="boxscore">
        <div className="sb-boxscore">
          <TeamBoxScore batters={data.away} abbr={awayAbbr} teamId={teamId} />
          <TeamPitchingBox pitchers={data.awayPitchers} abbr={awayAbbr} teamId={teamId} />
          <TeamBoxScore batters={data.home} abbr={homeAbbr} teamId={teamId} />
          <TeamPitchingBox pitchers={data.homePitchers} abbr={homeAbbr} teamId={teamId} />
        </div>
      </TabPanel>
    </Tabs>
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

  const basesLabel = describeBases(liveState);

  return (
    <div className="sb-live-info">
      <div className="sb-live-info-row">
        {liveState.batter && (
          <button
            type="button"
            className="sb-live-player sb-player-link"
            onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${liveState.batter.id}`); }}
            aria-label={`View batter ${liveState.batter.fullName}${liveState.batter.avg ? `, batting average ${liveState.batter.avg}` : ""}`}
          >
            <PlayerPhoto playerId={liveState.batter.id} name={liveState.batter.fullName} size={22} />
            <div className="sb-live-player-info">
              <span className="sb-live-player-name">{lastName(liveState.batter.fullName)}</span>
              <span className="sb-live-player-sub">AB{liveState.batter.avg ? ` · ${liveState.batter.avg}` : ""}</span>
            </div>
          </button>
        )}
        <svg
          className={`sb-live-diamond ${isOurGame ? "sb-our-diamond" : ""}`}
          width="52" height="52" viewBox="-2 -2 56 56"
          role="img"
          aria-label={basesLabel}
        >
          <title>{basesLabel}</title>
          <rect x="17" y="2" width="12" height="12" rx="1.5" transform="rotate(45 23 8)" className={`sb-live-base ${liveState.onSecond ? "occupied" : ""}`} />
          <rect x="30" y="15" width="12" height="12" rx="1.5" transform="rotate(45 36 21)" className={`sb-live-base ${liveState.onFirst ? "occupied" : ""}`} />
          <rect x="4" y="15" width="12" height="12" rx="1.5" transform="rotate(45 10 21)" className={`sb-live-base ${liveState.onThird ? "occupied" : ""}`} />
          <circle cx="23" cy="34" r="2.5" fill="var(--text-muted)" opacity="0.3" />
        </svg>
        {liveState.pitcher && (
          <button
            type="button"
            className="sb-live-player sb-player-link"
            onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${liveState.pitcher.id}`); }}
            aria-label={`View pitcher ${liveState.pitcher.fullName}${liveState.pitcher.gameStats ? `, ${liveState.pitcher.gameStats.ip} innings pitched` : ""}`}
          >
            <PlayerPhoto playerId={liveState.pitcher.id} name={liveState.pitcher.fullName} size={22} />
            <div className="sb-live-player-info">
              <span className="sb-live-player-name">{lastName(liveState.pitcher.fullName)}</span>
              <span className="sb-live-player-sub">P{liveState.pitcher.gameStats ? ` · ${liveState.pitcher.gameStats.ip} IP` : ""}</span>
            </div>
          </button>
        )}
      </div>
      <div className="sb-live-situation" role="status" aria-live="polite">
        <div className="sb-live-outs">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`sb-live-out-dot ${i < liveState.outs ? "filled" : ""}`} aria-hidden="true" />
          ))}
          <span>{liveState.outs} out</span>
        </div>
        <span className="sb-live-count" aria-label={`Count: ${liveState.balls} balls, ${liveState.strikes} strikes`}>
          {liveState.balls}-{liveState.strikes}
        </span>
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

  if (!awayLineup?.length && !homeLineup?.length) return <div className="sb-plays-loading" role="status" aria-live="polite">Loading lineups…</div>;

  const renderLineup = (lineup, abbr) => (
    <div className="sb-lineups-col">
      <div className="sb-lineups-hdr">{abbr}</div>
      {(lineup || []).map((p) => (
        <button
          key={p.id}
          type="button"
          className="sb-lineups-row sb-player-link"
          onClick={() => navigate(`/team/${teamId}/player/${p.id}`)}
          aria-label={`View ${p.fullName}, batting ${p.order}, position ${p.position}, average ${p.avg}`}
        >
          <span className="sb-lu-order">{p.order}</span>
          <span className="sb-lu-name">{lastName(p.fullName)}</span>
          <span className="sb-lu-pos">{p.position}</span>
          <span className="sb-lu-avg">{p.avg}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="sb-lineups">
      {isProjected && <div className="sb-lineups-tag">Projected · Based on recent games</div>}
      <div className="sb-lineups-cols">
        {renderLineup(awayLineup, awayAbbr)}
        {renderLineup(homeLineup, homeAbbr)}
      </div>
    </div>
  );
}

export default function Scoreboard() {
  const { teamId } = useTeam();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawDate = searchParams.get("date");
  const paramDate = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
  const [selectedDate, setSelectedDateRaw] = useState(paramDate || fmt(new Date()));
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

  // Manual-only — only fetched when the user clicks "Refresh Odds".
  const oddsQuery = useQuery({
    queryKey: ["odds", selectedDate],
    queryFn: () => fetchOddsForDate(selectedDate),
    enabled: false,
    staleTime: Infinity,
    retry: 0,
  });
  const oddsByMatchup = oddsQuery.data?.byMatchup;

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
      <h1 className="sr-only">Scores for {formatDateLabel(selectedDate)}</h1>
      <div className="scoreboard-date-nav" role="group" aria-label="Date navigation">
        <div className="scoreboard-date-center">
          <button type="button" className="scoreboard-date-btn" onClick={() => goDay(-1)} aria-label="Previous day">
            <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            type="button"
            className="scoreboard-date-label"
            onClick={() => setSelectedDate(fmt(new Date()))}
            aria-label="Go to today"
          >
            {formatDateLabel(selectedDate)}
          </button>
          <button type="button" className="scoreboard-date-btn" onClick={() => goDay(1)} aria-label="Next day">
            <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
        <button
          type="button"
          className="scoreboard-date-btn sb-cal-btn"
          onClick={() => dateInputRef.current?.showPicker?.() || dateInputRef.current?.click()}
          aria-label="Pick a date"
        >
          <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
            aria-label="Date picker"
          />
        </button>
      </div>

      {ODDS_PROXY_CONFIGURED && groups.upcoming.length + groups.myTeams.filter(g => g.status !== "Final" && g.status !== "Game Over" && g.status !== "In Progress").length > 0 && (
        <OddsRefreshBar oddsQuery={oddsQuery} />
      )}

      {isLoading && <SkeletonLoader variant="scores" />}

      {error && <div className="scoreboard-error" role="alert">Failed to load scores. Pull down to refresh.</div>}

      {!isLoading && !error && !sorted.length && (
        <div className="scoreboard-empty">
          <h2>No Games</h2>
          <p>No games scheduled for {formatDateLabel(selectedDate)}.</p>
        </div>
      )}

      {(() => {
        const leftHasContent = groups.myTeams.length > 0 || groups.upcoming.length > 0 || groups.final.length > 0;
        const rightHasContent = groups.live.length > 0;
        const isSingle = !leftHasContent || !rightHasContent;
        return sorted.length > 0 && (
        <div className={`scoreboard-list${isSingle ? " scoreboard-list--single" : ""}`}>
          {(() => {
          const renderCard = (game) => {
            const isOurGame = game.home.id === teamId || game.away.id === teamId;
            const isLive = game.status === "In Progress";
            const isDelayed = game.status === "Delayed Start" || game.status === "Delayed";
            const isFinal = game.status === "Final" || game.status === "Game Over";
            const isScheduled = !isLive && !isDelayed && !isFinal;

            if (isMobile) {
              const oddsRow = isScheduled
                ? oddsByMatchup?.get(`${game.away.name}@${game.home.name}`)
                : null;
              return (
                <MobileGameCard
                  key={game.gamePk}
                  game={game}
                  oddsRow={oddsRow}
                  teamId={teamId}
                  navigate={navigate}
                  isMyTeam={isMyTeamGame(game)}
                />
              );
            }

            const showStatsLink = isLive || isFinal;
            const matchupRoute = `/team/${teamId}/${isLive || isFinal ? "live" : "matchup"}/${game.gamePk}`;

            const awayWon = isFinal && game.away.score > game.home.score;
            const homeWon = isFinal && game.home.score > game.away.score;

            const awayColor = ALL_TEAMS[game.away.id]?.primary || "transparent";
            const homeColor = ALL_TEAMS[game.home.id]?.primary || "transparent";
            const scoreDiff = Math.abs((game.away.score ?? 0) - (game.home.score ?? 0));
            const isCloseGame = isLive && scoreDiff <= 2 && (game.inning ?? 0) >= 6;
            const isBlowout = isLive && scoreDiff >= 6 && (game.inning ?? 0) >= 6;
            const weatherMod = isScheduled ? deriveWeatherMod(game.weather?.condition) : "";

            const matchupLabel = `${game.away.abbreviation} at ${game.home.abbreviation}${isLive || isFinal ? `, score ${game.away.score} to ${game.home.score}` : ""}`;
            const primaryActionLabel = isLive
              ? `View live game: ${matchupLabel}`
              : isFinal
              ? `View final game details: ${matchupLabel}`
              : `View matchup: ${matchupLabel}, ${formatGameTime(game.gameDate)}`;

            return (
              <article
                key={game.gamePk}
                className={`scoreboard-card ${isOurGame ? "our-game" : ""} ${isLive ? "live" : ""} ${isCloseGame ? "sb-close-game" : ""} ${isBlowout ? "sb-blowout" : ""} ${weatherMod}`}
                style={{ "--away-color": awayColor, "--home-color": homeColor }}
                aria-label={matchupLabel}
              >
                {isOurGame && (
                  <img
                    className="sb-hero-watermark"
                    src={game.home.id === teamId ? game.home.logoUrl : game.away.logoUrl}
                    alt=""
                    aria-hidden="true"
                  />
                )}
                <div className="sb-matchup-link">
                {isLive && (
                  <div className="scoreboard-live-badge" aria-label={`Live, ${game.inningHalf === "Top" ? "top" : "bottom"} of inning ${game.inning}`}>
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

                {isScheduled && (() => {
                  const oddsRow = oddsByMatchup?.get(`${game.away.name}@${game.home.name}`);
                  return (
                    <>
                      <MatchupHero game={game} awayOdds={oddsRow?.away} homeOdds={oddsRow?.home} />
                      <PitcherMatchupLine game={game} teamId={teamId} navigate={navigate} hero={isMyTeamGame(game)} />
                    </>
                  );
                })()}

                {!isScheduled && (
                  <div className="scoreboard-teams">
                    <div className={`scoreboard-team-row ${isFinal ? (awayWon ? "sb-winner" : "sb-loser") : ""}`}>
                      <button
                        type="button"
                        className="scoreboard-team-link"
                        onClick={(e) => { e.stopPropagation(); navigate(`/team/${game.away.id}`); }}
                        aria-label={`Go to ${game.away.abbreviation} team page`}
                      >
                        <img src={game.away.logoUrl} alt="" className="scoreboard-logo" />
                        <span className="scoreboard-abbr">{game.away.abbreviation}</span>
                      </button>
                      {!isFinal && game.away.wins != null && (
                        <span className="scoreboard-record" aria-label={`Record ${game.away.wins} wins, ${game.away.losses} losses`}>
                          {game.away.wins}-{game.away.losses}
                        </span>
                      )}
                      {isFinal && (!isMobile || isMyTeamGame(game)) && <TopPerformer gamePk={game.gamePk} side="away" teamId={teamId} />}
                      {(isLive || isFinal) && (
                        <ScoreDisplay value={game.away.score} label={`${game.away.abbreviation} score`} />
                      )}
                    </div>
                    <div className={`scoreboard-team-row ${isFinal ? (homeWon ? "sb-winner" : "sb-loser") : ""}`}>
                      <button
                        type="button"
                        className="scoreboard-team-link"
                        onClick={(e) => { e.stopPropagation(); navigate(`/team/${game.home.id}`); }}
                        aria-label={`Go to ${game.home.abbreviation} team page`}
                      >
                        <img src={game.home.logoUrl} alt="" className="scoreboard-logo" />
                        <span className="scoreboard-abbr">{game.home.abbreviation}</span>
                      </button>
                      {!isFinal && game.home.wins != null && (
                        <span className="scoreboard-record" aria-label={`Record ${game.home.wins} wins, ${game.home.losses} losses`}>
                          {game.home.wins}-{game.home.losses}
                        </span>
                      )}
                      {isFinal && (!isMobile || isMyTeamGame(game)) && <TopPerformer gamePk={game.gamePk} side="home" teamId={teamId} />}
                      {(isLive || isFinal) && (
                        <ScoreDisplay value={game.home.score} label={`${game.home.abbreviation} score`} />
                      )}
                    </div>
                  </div>
                )}
                {isLive && (
                  <InningProgressBar inning={game.inning} total={9} />
                )}
                </div>

                {/* Live game: batter, pitcher, diamond, outs, count */}
                {isLive && game.gamePk && (
                  <LiveGameInfo gamePk={game.gamePk} teamId={teamId} isOurGame={isOurGame} />
                )}

                {/* Decisions for final games (desktop only — hidden on mobile to slim the card) */}
                {isFinal && !isMobile && game.decisions && (
                  <div className="sb-decisions">
                    {game.decisions.winner && (
                      <span className="sb-decision">
                        <span className="sb-decision-label">W:</span>
                        <button
                          type="button"
                          className="sb-player-link sb-decision-link"
                          onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${game.decisions.winner.id}`); }}
                          aria-label={`Winning pitcher: ${game.decisions.winner.name}. View player page.`}
                        >
                          {lastName(game.decisions.winner.name)}
                        </button>
                        <PitcherRecord pitcherId={game.decisions.winner.id} type="wl" />
                      </span>
                    )}
                    {game.decisions.loser && (
                      <span className="sb-decision">
                        <span className="sb-decision-label">L:</span>
                        <button
                          type="button"
                          className="sb-player-link sb-decision-link"
                          onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${game.decisions.loser.id}`); }}
                          aria-label={`Losing pitcher: ${game.decisions.loser.name}. View player page.`}
                        >
                          {lastName(game.decisions.loser.name)}
                        </button>
                        <PitcherRecord pitcherId={game.decisions.loser.id} type="wl" />
                      </span>
                    )}
                    {game.decisions.save && (
                      <span className="sb-decision">
                        <span className="sb-decision-label">SV:</span>
                        <button
                          type="button"
                          className="sb-player-link sb-decision-link"
                          onClick={(e) => { e.stopPropagation(); navigate(`/team/${teamId}/player/${game.decisions.save.id}`); }}
                          aria-label={`Save pitcher: ${game.decisions.save.name}. View player page.`}
                        >
                          {lastName(game.decisions.save.name)}
                        </button>
                        <PitcherRecord pitcherId={game.decisions.save.id} type="save" />
                      </span>
                    )}
                  </div>
                )}

                {/* Watch button for our live games (no venue row) */}
                {isOurGame && isLive && (
                  <a
                    className="scoreboard-watch-btn"
                    href={`https://www.mlb.com/tv/g${game.gamePk}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Watch game on MLB (opens in new tab)"
                  >
                    <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    Watch
                  </a>
                )}

                {/* Gameday link for all active games */}
                {isLive && !isOurGame && (
                  <a
                    className="scoreboard-gameday-link"
                    href={`https://www.mlb.com/tv/g${game.gamePk}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="View on MLB Gameday (opens in new tab)"
                  >
                    <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    Gameday
                  </a>
                )}

                {/* Stats link → navigates to the matchup/live page (live & final only) */}
                <button
                  type="button"
                  className="sb-expand-hint"
                  onClick={() => navigate(matchupRoute)}
                  aria-label={primaryActionLabel}
                >
                  <span className="sb-expand-label">{showStatsLink ? "Stats" : "Matchup"}</span>
                  <svg aria-hidden="true" focusable="false" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 6 15 12 9 18" />
                  </svg>
                </button>

                {isLive && <span className="sb-grass-strip" aria-hidden="true" />}
              </article>
            );
          };
          const myTeamsSection = groups.myTeams.length > 0 && (
            <section aria-labelledby="sb-my-teams-hdr">
              <h2 id="sb-my-teams-hdr" className="sb-section-hdr">My Teams</h2>
              {groups.myTeams.map(renderCard)}
            </section>
          );
          const liveSection = groups.live.length > 0 && (
            <section aria-labelledby="sb-live-hdr">
              <h2 id="sb-live-hdr" className="sb-section-hdr sb-section-hdr-live">
                <span className="sb-section-hdr-dot" aria-hidden="true" />Live
              </h2>
              {groups.live.map(renderCard)}
            </section>
          );
          const upcomingSection = groups.upcoming.length > 0 && (
            <section aria-labelledby="sb-upcoming-hdr">
              <h2 id="sb-upcoming-hdr" className="sb-section-hdr">Upcoming</h2>
              <div className="sb-upcoming-grid">
                {groups.upcoming.map(renderCard)}
              </div>
            </section>
          );
          const finalSection = groups.final.length > 0 && (
            <section aria-labelledby="sb-final-hdr">
              <h2 id="sb-final-hdr" className="sb-section-hdr">Final</h2>
              <div className="sb-final-grid">
                {groups.final.map(renderCard)}
              </div>
            </section>
          );

          if (isMobile) {
            // Mobile: flat stack with Live below My Teams (not at bottom).
            return (
              <>
                {myTeamsSection}
                {liveSection}
                {upcomingSection}
                {finalSection}
              </>
            );
          }
          return (
            <>
              {/* Desktop wide: left column carries My Teams + Upcoming + Final;
                  right column carries Live (side-by-side via the grid in CSS). */}
              <div className="sb-col-left">
                {myTeamsSection}
                {upcomingSection}
                {finalSection}
              </div>
              {liveSection && <div className="sb-col-right">{liveSection}</div>}
            </>
          );
          })()}
        </div>
        );
      })()}
    </div>
  );
}
