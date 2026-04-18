import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueries } from "@tanstack/react-query";
import { useTeam } from "../../context/TeamContext";
import {
  fetchAllGamesToday,
  fetchHotColdPlayers,
  fetchBvP,
  fetchPlayerSeasonVsTeam,
  fetchPlayerCareerVsTeam,
} from "../../api/client";
import { formatAvg, getTeamAbbr, lastName } from "../../utils/formatters";
import PlayerPhoto from "../common/PlayerPhoto";
import SkeletonLoader from "../common/SkeletonLoader";
import FantasyProjections from "./FantasyProjections";
import {
  computeEdgeScore,
  computeFadeScore,
  scoreBucket,
  rankPicks,
} from "../../utils/edgeScoring";

/**
 * Secret "Edge" tab — two ranked daily lists: PICKS (hot batters with
 * favorable BvP / vs-team history) and FADES (cold batters with ugly BvP
 * K-rates / ugly vs-team history). Accessed only via the green $ icon in
 * TopBar; intentionally not listed in TopTabs.
 *
 * Data flow:
 *   fetchAllGamesToday()                             → today's slate
 *   fetchHotColdPlayers(teamId)                      → top-3 hot batters per team (L7 OPS)
 *   fetchBvP(batterId, pitcherId)                    → batter-vs-pitcher career line
 *   fetchPlayerSeasonVsTeam(batterId, oppTeamId)     → current-season vs-team totals
 *   fetchPlayerCareerVsTeam(batterId, oppTeamId)     → all-time vs-team totals
 *                                                      (career feeds the score;
 *                                                       both render in expand panel)
 *
 * Scoring lives in utils/edgeScoring.js.
 */
export default function BettingEdge() {
  const navigate = useNavigate();
  const { team } = useTeam();

  const [myTeamsOnly, setMyTeamsOnly] = useState(false);

  // 1. Today's games ---------------------------------------------------------
  const gamesQuery = useQuery({
    queryKey: ["edge", "allGamesToday"],
    queryFn: () => fetchAllGamesToday(),
    staleTime: 10 * 60 * 1000,
  });

  // Only upcoming / live games with probable pitchers on BOTH sides are bettable.
  const bettableGames = useMemo(() => {
    return (gamesQuery.data || []).filter(
      (g) =>
        g.status !== "Final" &&
        g.away?.probablePitcher?.id &&
        g.home?.probablePitcher?.id
    );
  }, [gamesQuery.data]);

  // teamId → { game, opposingPitcher, opposingTeam }
  const teamContextMap = useMemo(() => {
    const m = new Map();
    for (const g of bettableGames) {
      if (g.away?.id) {
        m.set(g.away.id, { game: g, opp: g.home.probablePitcher, oppTeam: g.home });
      }
      if (g.home?.id) {
        m.set(g.home.id, { game: g, opp: g.away.probablePitcher, oppTeam: g.away });
      }
    }
    return m;
  }, [bettableGames]);

  // 2. Hot batters per team --------------------------------------------------
  const teamsToFetch = useMemo(
    () => Array.from(teamContextMap.keys()),
    [teamContextMap]
  );

  const hotColdQueries = useQueries({
    queries: teamsToFetch.map((tid) => ({
      queryKey: ["edge", "hotCold", tid],
      queryFn: () => fetchHotColdPlayers(tid),
      staleTime: 10 * 60 * 1000,
    })),
  });

  // 3. Batter × Pitcher pairs. Both HOT batters (→ picks) and COLD batters
  //    (→ fades) are pushed into the same list with a `mode` tag so we only
  //    run one set of BvP / vs-team fan-outs.
  const pairs = useMemo(() => {
    const out = [];
    teamsToFetch.forEach((tid, i) => {
      const data = hotColdQueries[i]?.data;
      if (!data) return;
      const ctx = teamContextMap.get(tid);
      if (!ctx || !ctx.opp?.id) return;
      for (const batter of data.hot || []) {
        out.push({
          key: `pick-${tid}-${batter.id}`,
          mode: "pick",
          teamId: tid,
          teamAbbr: getTeamAbbr(tid),
          batter,
          game: ctx.game,
          opposingPitcher: ctx.opp,
          opposingTeam: ctx.oppTeam,
        });
      }
      for (const batter of data.cold || []) {
        out.push({
          key: `fade-${tid}-${batter.id}`,
          mode: "fade",
          teamId: tid,
          teamAbbr: getTeamAbbr(tid),
          batter,
          game: ctx.game,
          opposingPitcher: ctx.opp,
          opposingTeam: ctx.oppTeam,
        });
      }
    });
    return out;
    // We can't include hotColdQueries directly — use a stable signal instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamsToFetch, teamContextMap, hotColdQueries.map((q) => q.data).join("|")]);

  // 4. BvP per pair ---------------------------------------------------------
  const bvpQueries = useQueries({
    queries: pairs.map((p) => ({
      queryKey: ["edge", "bvp", p.batter.id, p.opposingPitcher.id],
      queryFn: () => fetchBvP(p.batter.id, p.opposingPitcher.id),
      staleTime: 24 * 60 * 60 * 1000,
    })),
  });

  // 4b. Current-season vs-team totals per pair.
  const seasonVsTeamQueries = useQueries({
    queries: pairs.map((p) => ({
      queryKey: ["edge", "seasonVsTeam", p.batter.id, p.opposingTeam?.id],
      queryFn: () => fetchPlayerSeasonVsTeam(p.batter.id, p.opposingTeam?.id),
      staleTime: 6 * 60 * 60 * 1000,
      enabled: !!p.opposingTeam?.id,
    })),
  });

  // 4c. Career (all-time) vs-team totals per pair — larger sample, feeds score.
  const careerVsTeamQueries = useQueries({
    queries: pairs.map((p) => ({
      queryKey: ["edge", "careerVsTeam", p.batter.id, p.opposingTeam?.id],
      queryFn: () => fetchPlayerCareerVsTeam(p.batter.id, p.opposingTeam?.id),
      staleTime: 24 * 60 * 60 * 1000,
      enabled: !!p.opposingTeam?.id,
    })),
  });

  // 5. Score + rank. Splits into two lists: picks (hot bats, edge score) and
  //    fades (cold bats, fade score). Each list is ranked independently by its
  //    own score so HIGH-tier cards always sit above MEDIUM/LOW within a list.
  const { picks, fades } = useMemo(() => {
    const emptyVs = {
      games: 0,
      ab: 0,
      hits: 0,
      hr: 0,
      avg: null,
      ops: null,
      pa: 0,
    };
    const scoredPicks = [];
    const scoredFades = [];
    pairs.forEach((p, i) => {
      const bvp = bvpQueries[i]?.data || { pa: 0 };
      const seasonVsTeam = seasonVsTeamQueries[i]?.data || emptyVs;
      const careerVsTeam = careerVsTeamQueries[i]?.data || emptyVs;
      // Career feeds both scoring functions (larger sample). Each function
      // sample-gates its own team-context input (ab < 10 → falls back).
      const score =
        p.mode === "fade"
          ? computeFadeScore({
              l7OPS: p.batter.ops,
              bvpOPS: bvp.ops,
              bvpPA: bvp.pa,
              bvpK: bvp.strikeouts,
              teamContextOPS: careerVsTeam.ops,
              teamContextAB: careerVsTeam.ab,
            })
          : computeEdgeScore({
              l7OPS: p.batter.ops,
              bvpOPS: bvp.ops,
              bvpPA: bvp.pa,
              teamContextOPS: careerVsTeam.ops,
              teamContextAB: careerVsTeam.ab,
            });
      const confidence = scoreBucket(score);
      const scored = { ...p, bvp, seasonVsTeam, careerVsTeam, score, confidence };
      (p.mode === "fade" ? scoredFades : scoredPicks).push(scored);
    });
    return {
      picks: rankPicks(scoredPicks, { maxTotal: 15, maxPerTeam: 3 }),
      fades: rankPicks(scoredFades, { maxTotal: 10, maxPerTeam: 3 }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pairs,
    bvpQueries.map((q) => q.data?.pa ?? "_").join("|"),
    seasonVsTeamQueries.map((q) => q.data?.ab ?? "_").join("|"),
    careerVsTeamQueries.map((q) => q.data?.ab ?? "_").join("|"),
  ]);

  const applyMyTeamsFilter = (list) => {
    if (!myTeamsOnly || !team?.id) return list;
    return list.filter(
      (p) => p.game.away.id === team.id || p.game.home.id === team.id
    );
  };

  const filteredPicks = useMemo(
    () => applyMyTeamsFilter(picks),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [picks, myTeamsOnly, team]
  );
  const filteredFades = useMemo(
    () => applyMyTeamsFilter(fades),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fades, myTeamsOnly, team]
  );

  const isLoading =
    gamesQuery.isLoading ||
    (teamsToFetch.length > 0 && hotColdQueries.every((q) => q.isLoading));

  const handleBack = () => {
    if (team?.id) navigate(`/team/${team.id}`);
    else navigate(-1);
  };

  const todayLabel = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return (
    <div className="edge-page">
      <header className="edge-header">
        <div className="edge-header-row">
          <h1 className="edge-title">
            TODAY'S EDGE{" "}
            <span className="edge-dollar" aria-hidden="true">
              $
            </span>
          </h1>
          <button
            type="button"
            className="edge-back"
            onClick={handleBack}
            aria-label="Back to team dashboard"
          >
            ← Back
          </button>
        </div>
        <p className="edge-subtitle">
          Picks for {todayLabel} · {bettableGames.length}{" "}
          {bettableGames.length === 1 ? "game" : "games"} on slate
        </p>
      </header>

      <div className="edge-controls">
        <label className="edge-filter">
          <input
            type="checkbox"
            checked={myTeamsOnly}
            onChange={(e) => setMyTeamsOnly(e.target.checked)}
          />
          <span>My Teams only</span>
        </label>
      </div>

      {gamesQuery.isError ? (
        <div className="edge-empty">
          <p>Failed to load today's slate. Try again in a bit.</p>
        </div>
      ) : isLoading ? (
        <SkeletonLoader variant="scores" />
      ) : bettableGames.length === 0 ? (
        <div className="edge-empty">
          <div className="edge-empty-icon" aria-hidden="true">
            $
          </div>
          <p>No bettable games today. Check back once pitchers are announced.</p>
        </div>
      ) : filteredPicks.length === 0 && filteredFades.length === 0 ? (
        <div className="edge-empty">
          <p>
            {myTeamsOnly
              ? "No picks match My Teams today — try turning off the filter."
              : "Still warming up — picks will appear as data loads."}
          </p>
        </div>
      ) : (
        <>
          <section className="edge-section">
            <h2 className="edge-section-title edge-section-picks">
              <span className="edge-section-accent" aria-hidden="true">▲</span>
              Picks · bet on
            </h2>
            {filteredPicks.length === 0 ? (
              <div className="edge-empty edge-empty-inline">
                <p>No strong picks right now.</p>
              </div>
            ) : (
              <div className="edge-grid">
                {filteredPicks.map((p) => (
                  <PickCard
                    key={p.key}
                    pick={p}
                    onSelectPlayer={() =>
                      navigate(`/team/${p.teamId}/player/${p.batter.id}`)
                    }
                  />
                ))}
              </div>
            )}
          </section>

          <section className="edge-section">
            <h2 className="edge-section-title edge-section-fades">
              <span className="edge-section-accent" aria-hidden="true">▼</span>
              Fades · bet against
            </h2>
            {filteredFades.length === 0 ? (
              <div className="edge-empty edge-empty-inline">
                <p>No strong fades right now.</p>
              </div>
            ) : (
              <div className="edge-grid">
                {filteredFades.map((p) => (
                  <PickCard
                    key={p.key}
                    pick={p}
                    onSelectPlayer={() =>
                      navigate(`/team/${p.teamId}/player/${p.batter.id}`)
                    }
                  />
                ))}
              </div>
            )}
          </section>

          <FantasyProjections myTeamsOnly={myTeamsOnly} />
        </>
      )}

      <p className="edge-disclaimer">
        For entertainment only. Not financial advice.
      </p>
    </div>
  );
}

function PickCard({ pick, onSelectPlayer }) {
  const [open, setOpen] = useState(false);
  const {
    mode,
    batter,
    bvp,
    seasonVsTeam,
    careerVsTeam,
    opposingPitcher,
    opposingTeam,
    teamAbbr,
    confidence,
    score,
  } = pick;
  const isFade = mode === "fade";
  const bvpHasHistory = (bvp.pa || 0) > 0;
  const seasonVsHasHistory = (seasonVsTeam?.ab || 0) > 0;
  const careerVsHasHistory = (careerVsTeam?.ab || 0) > 0;

  const pitcherDisplay =
    lastName(opposingPitcher?.fullName || opposingPitcher?.name || "") ||
    "TBD";

  return (
    <article
      className={`edge-card edge-conf-${confidence.tone}${
        isFade ? " edge-card-fade" : ""
      }`}
    >
      <header className="edge-card-head">
        <button
          type="button"
          className="edge-card-photo"
          onClick={onSelectPlayer}
          aria-label={`View ${batter.fullName}`}
        >
          <PlayerPhoto
            playerId={batter.id}
            name={batter.fullName}
            size={48}
          />
        </button>
        <div className="edge-card-name-col">
          <div className="edge-card-name">
            <span className="edge-card-fullname">{batter.fullName}</span>
            <span className="edge-card-pos">{batter.position}</span>
          </div>
          <div className="edge-card-matchup">
            <span className="edge-card-team-abbr">{teamAbbr}</span>
            <span className="edge-card-vs">
              vs {opposingTeam?.abbreviation || "—"}
            </span>
            <span className="edge-card-pitcher">· {pitcherDisplay}</span>
          </div>
        </div>
        <span className={`edge-conf-pill edge-conf-pill-${confidence.tone}`}>
          {confidence.label}
        </span>
      </header>

      <div className="edge-stat-row">
        <span className="edge-stat-label">L7</span>
        <span className="edge-stat-value">
          {formatAvg(batter.avg)} AVG · {formatAvg(batter.ops)} OPS ·{" "}
          {batter.hr} HR
        </span>
      </div>
      <div className="edge-stat-row">
        <span className="edge-stat-label">vs P</span>
        <span className="edge-stat-value">
          {bvpHasHistory ? (
            isFade ? (
              <>
                {bvp.hits}-for-{bvp.ab} ({formatAvg(bvp.avg)}) ·{" "}
                {bvp.strikeouts || 0} K · {bvp.pa} PA
              </>
            ) : (
              <>
                {bvp.hits}-for-{bvp.ab} ({formatAvg(bvp.avg)}) ·{" "}
                {bvp.homeRuns || 0} HR · {bvp.pa} PA
              </>
            )
          ) : (
            <span className="edge-no-history">No history</span>
          )}
        </span>
      </div>

      <div className="edge-stat-row edge-score-row">
        <span className="edge-score">SCORE {score.toFixed(2)}</span>
        <button
          type="button"
          className="edge-details-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? "▴ Hide" : "▾ Details"}
        </button>
      </div>

      {open && (
        <div className="edge-details">
          <div className="edge-details-block">
            <div className="edge-details-label">
              Season vs {opposingTeam?.abbreviation || "OPP"}
            </div>
            {seasonVsHasHistory ? (
              <div className="edge-details-line">
                {seasonVsTeam.hits}-for-{seasonVsTeam.ab} (
                {formatAvg(seasonVsTeam.avg)}) · {seasonVsTeam.hr} HR
                {seasonVsTeam.ops != null && (
                  <> · {formatAvg(seasonVsTeam.ops)} OPS</>
                )}
                {seasonVsTeam.games > 0 && (
                  <span className="edge-details-sample">
                    {" "}
                    · {seasonVsTeam.games}{" "}
                    {seasonVsTeam.games === 1 ? "game" : "games"}
                  </span>
                )}
              </div>
            ) : (
              <div className="edge-details-line edge-no-history">
                No matchups yet this season.
              </div>
            )}
          </div>

          <div className="edge-details-block">
            <div className="edge-details-label">
              Career vs {opposingTeam?.abbreviation || "OPP"}
            </div>
            {careerVsHasHistory ? (
              <>
                <div className="edge-details-line">
                  {careerVsTeam.hits}-for-{careerVsTeam.ab} (
                  {formatAvg(careerVsTeam.avg)}) · {careerVsTeam.hr} HR
                  {careerVsTeam.ops != null && (
                    <> · {formatAvg(careerVsTeam.ops)} OPS</>
                  )}
                  {careerVsTeam.games > 0 && (
                    <span className="edge-details-sample">
                      {" "}
                      · {careerVsTeam.games}{" "}
                      {careerVsTeam.games === 1 ? "game" : "games"}
                    </span>
                  )}
                </div>
                {careerVsTeam.ab < 10 && (
                  <div className="edge-details-note">
                    Small sample — team context not factored into score.
                  </div>
                )}
              </>
            ) : (
              <div className="edge-details-line edge-no-history">
                No prior history vs{" "}
                {opposingTeam?.abbreviation || "this team"}.
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
