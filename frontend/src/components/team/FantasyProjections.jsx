import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTeam } from "../../context/TeamContext";
import {
  fetchFantasyProjections,
  fetchTodayLineups,
  fetchLiveFantasyScores,
} from "../../api/client";
import { lastName } from "../../utils/formatters";
import PlayerPhoto from "../common/PlayerPhoto";

const TOP_N_DISPLAY = 10;

/**
 * Fantasy Projections section — ranks every eligible hitter on today's slate
 * by projected PrizePicks fantasy score (EFP).
 *
 * All the math is on the backend (backend/app/services/fantasy.py). We just
 * fetch, filter by My Teams, render cards.
 */
export default function FantasyProjections({ myTeamsOnly = false }) {
  const navigate = useNavigate();
  const { team } = useTeam();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["fantasy", "projections"],
    queryFn: () => fetchFantasyProjections(),
    staleTime: 5 * 60 * 1000,
  });

  // Live lineups — refetched every 5 minutes so scratches / late-posted
  // lineups flow through while the user is on the page.
  const { data: lineupsByTeam = {}, isFetched: lineupsFetched } = useQuery({
    queryKey: ["fantasy", "lineups"],
    queryFn: () => fetchTodayLineups(),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  // Live in-progress fantasy scores — refetched every 60s. Absent from the
  // map means the batter's game hasn't started (or has ended Final).
  const { data: liveScoresByPlayer = {} } = useQuery({
    queryKey: ["fantasy", "liveScores"],
    queryFn: () => fetchLiveFantasyScores(),
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  });

  const projections = data?.projections || [];
  const metrics = data?.metrics || {};
  const calibrated = !!data?.calibrated;

  const filtered = useMemo(() => {
    // 1. Annotate each row with lineup status.
    //    - confirmed: team has a posted lineup AND batter is in it
    //    - excluded: team has a posted lineup AND batter is NOT in it
    //    - pending:  team has not posted a lineup yet (treat as "show anyway")
    const annotated = projections.map((p) => {
      const lineup = lineupsByTeam[p.team_id];
      if (!Array.isArray(lineup) || lineup.length === 0) {
        return { ...p, _lineupStatus: "pending" };
      }
      const inLineup = lineup.includes(p.player_id);
      return { ...p, _lineupStatus: inLineup ? "confirmed" : "excluded" };
    });

    // 2. Drop excluded players entirely.
    let passed = annotated.filter((p) => p._lineupStatus !== "excluded");

    // 3. My Teams filter on top.
    if (myTeamsOnly && team?.id) {
      passed = passed.filter(
        (p) => p.team_id === team.id || p.opp_team_id === team.id
      );
    }

    // 4. Cap at the display top-N (static JSON now serves 30 rows).
    return passed.slice(0, TOP_N_DISPLAY);
  }, [projections, lineupsByTeam, myTeamsOnly, team]);

  // Count how many projections had lineup info — used in the footer so
  // the user can tell "no lineups posted yet" from "filter removed everyone".
  const confirmedCount = filtered.filter((p) => p._lineupStatus === "confirmed").length;
  const anyLineupsPosted = Object.keys(lineupsByTeam).length > 0;

  return (
    <section className="edge-section">
      <h2 className="edge-section-title edge-section-fantasy">
        <span className="edge-section-accent" aria-hidden="true">★</span>
        Fantasy · projected PrizePicks score
      </h2>

      {isError || (!isLoading && projections.length === 0) ? (
        <div className="edge-empty edge-empty-inline">
          <p>No fantasy projections available right now.</p>
        </div>
      ) : isLoading ? (
        <div className="edge-empty edge-empty-inline">
          <p>Crunching projections across today's slate…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="edge-empty edge-empty-inline">
          <p>No picks match My Teams today — try turning off the filter.</p>
        </div>
      ) : (
        <div className="edge-grid">
          {filtered.map((p) => (
            <FantasyCard
              key={`${p.team_id}-${p.player_id}`}
              projection={p}
              live={liveScoresByPlayer[p.player_id] || null}
              onSelectPlayer={() =>
                navigate(`/team/${p.team_id}/player/${p.player_id}`)
              }
            />
          ))}
        </div>
      )}

      {!isLoading && projections.length > 0 && (
        <p className="edge-fantasy-footer">
          Scoring: 1B 3 · 2B 5 · 3B 8 · HR 10 · R/RBI 2 · BB/HBP 2 · SB 5
          {calibrated && metrics?.r2 != null
            ? `  ·  model R²=${Number(metrics.r2).toFixed(2)} · n=${metrics.n || 0}`
            : "  ·  using baseline weights (pre-calibration)"}
          {lineupsFetched && (
            anyLineupsPosted
              ? `  ·  ${confirmedCount}/${filtered.length} lineup-confirmed`
              : "  ·  lineups not yet posted"
          )}
        </p>
      )}
    </section>
  );
}

function FantasyCard({ projection, live, onSelectPlayer }) {
  const [open, setOpen] = useState(false);
  const {
    player_id,
    name,
    position,
    bat_side,
    team_abbr,
    opp_abbr,
    opp_pitcher,
    park,
    weather,
    pa,
    pa_source,
    efp,
    tier,
    per_event,
    multipliers,
    _lineupStatus,
  } = projection;
  const isConfirmed = _lineupStatus === "confirmed";

  const tierClass = `edge-conf-${tier || "low"}`;
  const tierLabel = tier?.toUpperCase() || "LOW";
  const tierTone = tier || "low";

  const pitcherDisplay = opp_pitcher?.fullName ? lastName(opp_pitcher.fullName) : "TBD";

  const isLive = !!live;
  const liveEfp = isLive ? Number(live.efp).toFixed(1) : null;

  return (
    <article
      className={`edge-card ${tierClass}${isLive ? " edge-card-live" : ""}`}
    >
      <header className="edge-card-head">
        <button
          type="button"
          className="edge-card-photo"
          onClick={onSelectPlayer}
          aria-label={`View ${name}`}
        >
          <PlayerPhoto playerId={player_id} name={name} size={48} />
        </button>
        <div className="edge-card-name-col">
          <div className="edge-card-name">
            <span className="edge-card-fullname">{name}</span>
            {isConfirmed && (
              <span
                className="edge-lineup-check"
                title="Confirmed in today's lineup"
                aria-label="Confirmed starter"
              >
                ✓
              </span>
            )}
            {position && <span className="edge-card-pos">{position}</span>}
            {bat_side && (
              <span
                className="edge-card-pos"
                title={
                  bat_side === "L"
                    ? "Left-handed batter"
                    : bat_side === "R"
                    ? "Right-handed batter"
                    : "Switch hitter"
                }
              >
                · {bat_side}HB
              </span>
            )}
          </div>
          <div className="edge-card-matchup">
            <span className="edge-card-team-abbr">{team_abbr}</span>
            <span className="edge-card-vs">vs {opp_abbr || "—"}</span>
            <span className="edge-card-pitcher">· {pitcherDisplay}</span>
          </div>
        </div>
        <span className={`edge-conf-pill edge-conf-pill-${tierTone}`}>
          {tierLabel}
        </span>
      </header>

      <div className="edge-stat-row edge-fantasy-efp-row">
        <span className="edge-stat-label">EFP</span>
        <span className="edge-stat-value edge-fantasy-efp">
          {Number(efp).toFixed(1)} pts
        </span>
        {isLive && (
          <span
            className="edge-live-score"
            title="Live fantasy score · updating every ~60s"
          >
            <span className="edge-live-dot" aria-hidden="true" />
            LIVE {liveEfp}
          </span>
        )}
      </div>

      <div className="edge-stat-row">
        <span className="edge-stat-label">Ctx</span>
        <span className="edge-stat-value">
          {park?.label || "Park"}
          {park?.hr ? ` (HR ${park.hr})` : ""}
          {weather?.temp ? ` · ${weather.temp}°F` : ""}
          {weather?.wind ? ` · ${weather.wind}` : ""}
          {multipliers?.weather_hr && multipliers.weather_hr !== 1
            ? ` · wx×${multipliers.weather_hr.toFixed(2)}`
            : ""}
        </span>
      </div>

      <div className="edge-stat-row">
        <span className="edge-stat-label">PA</span>
        <span className="edge-stat-value">
          {Number(pa).toFixed(1)}
          {pa_source === "default" && (
            <span className="edge-fantasy-pa-default"> · lineup TBD</span>
          )}
        </span>
      </div>

      <div className="edge-stat-row edge-score-row">
        <span className="edge-score">SCORE {Number(efp).toFixed(2)}</span>
        <button
          type="button"
          className="edge-details-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? "▴ Hide" : "▾ Breakdown"}
        </button>
      </div>

      {open && per_event && (
        <div className="edge-details">
          <div className="edge-details-block">
            <div className="edge-details-label">Per-event projected pts</div>
            <table className="edge-details-table edge-fantasy-breakdown">
              <tbody>
                <tr><td>1B</td><td>{per_event.singles.toFixed(2)}</td></tr>
                <tr><td>2B</td><td>{per_event.doubles.toFixed(2)}</td></tr>
                <tr><td>3B</td><td>{per_event.triples.toFixed(2)}</td></tr>
                <tr><td>HR</td><td>{per_event.home_runs.toFixed(2)}</td></tr>
                <tr><td>BB+HBP</td><td>{per_event.bb_hbp.toFixed(2)}</td></tr>
                <tr><td>R</td><td>{per_event.r.toFixed(2)}</td></tr>
                <tr><td>RBI</td><td>{per_event.rbi.toFixed(2)}</td></tr>
                <tr><td>SB</td><td>{per_event.sb.toFixed(2)}</td></tr>
              </tbody>
            </table>
            {multipliers && (
              <div className="edge-details-note">
                Multipliers — park HR ×{multipliers.park_hr.toFixed(2)} · park runs ×{multipliers.park_runs.toFixed(2)} · weather HR ×{multipliers.weather_hr.toFixed(2)}
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
