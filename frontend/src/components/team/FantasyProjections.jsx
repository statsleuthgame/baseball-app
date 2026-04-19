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

  // Shared annotate+filter pipeline — used by both the EFP-ranked and
  // edge-ranked sections so they respect the same lineup + My Teams rules.
  const passedRows = useMemo(() => {
    const annotated = projections.map((p) => {
      const lineup = lineupsByTeam[p.team_id];
      if (!Array.isArray(lineup) || lineup.length === 0) {
        return { ...p, _lineupStatus: "pending" };
      }
      const inLineup = lineup.includes(p.player_id);
      return { ...p, _lineupStatus: inLineup ? "confirmed" : "excluded" };
    });
    let passed = annotated.filter((p) => p._lineupStatus !== "excluded");
    if (myTeamsOnly && team?.id) {
      passed = passed.filter(
        (p) => p.team_id === team.id || p.opp_team_id === team.id
      );
    }
    return passed;
  }, [projections, lineupsByTeam, myTeamsOnly, team]);

  // Section 1: top by raw projection.
  const byEfp = useMemo(
    () => passedRows.slice(0, TOP_N_DISPLAY),
    [passedRows]
  );

  // Section 2: biggest gap vs the house. Prefer edge_z (confidence-
  // adjusted: # of stdevs our projection exceeds the PP line) over raw
  // edge_fantasy when available. edge_z normalizes for variance — a 2σ
  // overproject on a steady player beats a 3σ overproject on a wild one
  // in terms of actual bet confidence.
  const byEdge = useMemo(() => {
    const withEdge = passedRows.filter(
      (p) =>
        typeof p.edge_z === "number" ||
        typeof p.edge_fantasy === "number"
    );
    withEdge.sort((a, b) => {
      // Prefer edge_z when both rows have it; else fall back to edge_fantasy.
      const az = typeof a.edge_z === "number" ? a.edge_z : null;
      const bz = typeof b.edge_z === "number" ? b.edge_z : null;
      if (az !== null && bz !== null) return bz - az;
      if (az !== null) return -1;
      if (bz !== null) return 1;
      return (b.edge_fantasy ?? 0) - (a.edge_fantasy ?? 0);
    });
    return withEdge.slice(0, TOP_N_DISPLAY);
  }, [passedRows]);

  // Count how many projections had lineup info — used in the footer so
  // the user can tell "no lineups posted yet" from "filter removed everyone".
  const confirmedCount = byEfp.filter((p) => p._lineupStatus === "confirmed").length;
  const anyLineupsPosted = Object.keys(lineupsByTeam).length > 0;

  const renderCardGrid = (rows) => (
    <div className="edge-grid">
      {rows.map((p) => (
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
  );

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
      ) : byEfp.length === 0 ? (
        <div className="edge-empty edge-empty-inline">
          <p>No picks match My Teams today — try turning off the filter.</p>
        </div>
      ) : (
        <>
          {renderCardGrid(byEfp)}

          {byEdge.length > 0 && (
            <div className="edge-subsection">
              <h3 className="edge-subsection-title edge-section-fantasy">
                <span className="edge-section-accent" aria-hidden="true">Δ</span>
                Biggest edge vs PrizePicks
                <span className="edge-subsection-hint">
                  — sorted by gap between our projection and the posted line
                </span>
              </h3>
              {renderCardGrid(byEdge)}
            </div>
          )}
        </>
      )}

      {!isLoading && projections.length > 0 && (
        <p className="edge-fantasy-footer">
          Scoring: 1B 3 · 2B 5 · 3B 8 · HR 10 · R/RBI 2 · BB/HBP 2 · SB 5
          {calibrated && metrics?.r2 != null
            ? `  ·  model R²=${Number(metrics.r2).toFixed(2)} · n=${metrics.n || 0}`
            : "  ·  using baseline weights (pre-calibration)"}
          {lineupsFetched && (
            anyLineupsPosted
              ? `  ·  ${confirmedCount}/${byEfp.length} lineup-confirmed`
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
    prizepicks: ppLines,
    edge_fantasy: edgeFantasy,
    edge_z: edgeZ,
    stdev_efp: stdevEfp,
    mean_efp: meanEfp,
    stats_games: statsGames,
    _lineupStatus,
  } = projection;
  const isConfirmed = _lineupStatus === "confirmed";

  // Confidence tier derived from edge_z when present. ≥ 0.8σ = HIGH
  // confidence (top-6 hit rate ~70% historically), 0.3-0.8σ = MEDIUM,
  // 0-0.3σ = LOW, negative = FADE.
  const confidenceTier =
    typeof edgeZ === "number"
      ? edgeZ >= 0.8
        ? { label: "HIGH CONF", tone: "high" }
        : edgeZ >= 0.3
        ? { label: "MED CONF", tone: "medium" }
        : edgeZ >= 0
        ? { label: "LOW CONF", tone: "low" }
        : { label: "FADE", tone: "low" }
      : null;

  // Tier drives VISUAL priority only (green = high-EFP pick, yellow =
  // medium, gray = low) — the label shows the actual projected points
  // so users don't mistake it for a confidence signal. The real
  // confidence indicator is the HIGH/MED/LOW CONF badge, which only
  // appears when a PrizePicks fantasy-score line is available.
  const tierClass = `edge-conf-${tier || "low"}`;
  const tierLabel = `${Number(efp).toFixed(1)} PTS`;
  const tierTone = tier || "low";

  const pitcherDisplay = opp_pitcher?.fullName ? lastName(opp_pitcher.fullName) : "TBD";

  const isLive = live?.state === "live";
  const isFinal = live?.state === "final";
  const actualEfp = live ? Number(live.efp).toFixed(1) : null;

  return (
    <article
      className={`edge-card ${tierClass}${isLive ? " edge-card-live" : ""}${
        isFinal ? " edge-card-final" : ""
      }`}
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
            LIVE {actualEfp}
          </span>
        )}
        {isFinal && (
          <span
            className="edge-final-score"
            title="Final fantasy score for this game"
          >
            FINAL {actualEfp}
          </span>
        )}
      </div>

      {ppLines?.fantasy != null && (
        <div className="edge-stat-row edge-pp-row">
          <span className="edge-stat-label">PP</span>
          <span className="edge-stat-value edge-pp-value">
            {Number(ppLines.fantasy).toFixed(1)}
            {typeof edgeFantasy === "number" && (
              <span
                className={`edge-pp-edge ${
                  edgeFantasy >= 3
                    ? "edge-pp-edge-strong"
                    : edgeFantasy >= 1
                    ? "edge-pp-edge-lean"
                    : edgeFantasy <= -1
                    ? "edge-pp-edge-fade"
                    : "edge-pp-edge-flat"
                }`}
                title="Our projected EFP minus PrizePicks fantasy-score line"
              >
                {edgeFantasy >= 0 ? `+${edgeFantasy.toFixed(1)}` : edgeFantasy.toFixed(1)}
              </span>
            )}
            {confidenceTier && (
              <span
                className={`edge-conf-badge edge-conf-${confidenceTier.tone}`}
                title={`${edgeZ.toFixed(2)}σ above the PP line · historical stdev ${
                  stdevEfp ? stdevEfp.toFixed(1) : "?"
                } over ${statsGames || 0} games`}
              >
                {confidenceTier.label}
                {typeof edgeZ === "number" && (
                  <span className="edge-conf-z">
                    {edgeZ >= 0 ? ` +${edgeZ.toFixed(2)}σ` : ` ${edgeZ.toFixed(2)}σ`}
                  </span>
                )}
              </span>
            )}
          </span>
        </div>
      )}

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

      {open && (
        <div className="edge-details">
          <div className="edge-details-block">
            <div className="edge-details-label">Matchup context</div>
            <div className="edge-fantasy-ctx-rows">
              <div className="edge-fantasy-ctx-row">
                <span className="edge-fantasy-ctx-key">Park</span>
                <span className="edge-fantasy-ctx-val">
                  {park?.label || "—"}
                  {park?.hr ? ` · HR ${park.hr}` : ""}
                  {park?.runs ? ` · R ${park.runs}` : ""}
                </span>
              </div>
              {(weather?.temp || weather?.wind) && (
                <div className="edge-fantasy-ctx-row">
                  <span className="edge-fantasy-ctx-key">Weather</span>
                  <span className="edge-fantasy-ctx-val">
                    {weather?.temp ? `${weather.temp}°F` : ""}
                    {weather?.wind ? `${weather?.temp ? " · " : ""}${weather.wind}` : ""}
                    {multipliers?.weather_hr && multipliers.weather_hr !== 1
                      ? ` · wx×${multipliers.weather_hr.toFixed(2)}`
                      : ""}
                  </span>
                </div>
              )}
              <div className="edge-fantasy-ctx-row">
                <span className="edge-fantasy-ctx-key">PA</span>
                <span className="edge-fantasy-ctx-val">
                  {Number(pa).toFixed(1)}
                  {pa_source === "default" && (
                    <span className="edge-fantasy-pa-default"> · lineup TBD</span>
                  )}
                </span>
              </div>
            </div>
          </div>

          {per_event && (
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
          )}
        </div>
      )}
    </article>
  );
}
