import { useQuery } from "@tanstack/react-query";
import { fetchTodaysRebootWatch } from "../../api/client";

/**
 * Reboot Watchlist — every Model 1 pick with reboot_rate ≥ 15%,
 * regardless of whether it makes a parlay combo.
 *
 * Each row shows the player's bat-vs-throws platoon matchup + an
 * alignment hint:
 *   aligned_under — Under bet + same-side pitcher = reboot + headwind
 *   aligned_over  — Over bet  + platoon advantage = reboot + tailwind
 *   split         — Matchup and side point in opposite directions
 *                   (the model is fighting the platoon)
 *   —             — Missing bat/throws info; can't evaluate
 *
 * Data source: frontend/public/data/fantasy/todays_reboot_watch.json,
 * written by scripts/generate_fantasy_projections.py → edge_model_picks.
 */

const HINT_META = {
  aligned_over:  { label: "Reboot + tailwind",      cls: "reboot-aligned over"  },
  aligned_under: { label: "Reboot + pitcher edge",  cls: "reboot-aligned under" },
  split:         { label: "Model fighting platoon", cls: "reboot-split"         },
  null:          { label: "Unknown matchup",        cls: "reboot-unknown"       },
};

const MARKET_LABEL = {
  hits: "Hits",
  total_bases: "Total Bases",
  home_runs: "HRs",
};

function fmtPct(v, d = 0) {
  if (v == null || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(d)}%`;
}

export default function RebootWatchlist() {
  const { data, isLoading } = useQuery({
    queryKey: ["fantasy", "rebootWatch"],
    queryFn: fetchTodaysRebootWatch,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });

  if (isLoading) return null;      // silent — best-parlays card already owns the loading state
  const picks = data?.picks || [];
  if (!picks.length) return null;  // hide entirely when nothing qualifies

  const aligned = picks.filter((p) => p.hint === "aligned_over" || p.hint === "aligned_under");

  return (
    <section className="reboot-watchlist">
      <div className="reboot-header">
        <h3 className="reboot-title">
          Reboot Watchlist
          <span className="reboot-count">{picks.length}</span>
        </h3>
        <span className="reboot-sub">
          Model 1 picks with reboot rate ≥ 15% × today's platoon matchup.
          {aligned.length > 0 && (
            <> <b>{aligned.length}</b> aligned with matchup.</>
          )}
        </span>
      </div>
      <div className="reboot-rows">
        {picks.map((p, i) => (
          <RebootRow key={`${p.mlbam_id}-${p.market}-${i}`} pick={p} />
        ))}
      </div>
      <p className="reboot-footnote">
        "Aligned" = reboot signal and platoon matchup both point the same way
        (Under + same-side, or Over + platoon advantage). "Split" = the model
        is overriding the platoon — these are contrarian.
      </p>
    </section>
  );
}

function RebootRow({ pick }) {
  const hint = HINT_META[pick.hint] || HINT_META.null;
  const side = (pick.side || "over").toUpperCase();
  const bat = pick.bat_side || "?";
  const thr = pick.opp_p_throws || "?";
  const platoon = pick.platoon || "? unknown";
  const platoonCls = platoon.startsWith("✓")
    ? "platoon platoon-good"
    : platoon.startsWith("✗")
    ? "platoon platoon-bad"
    : "platoon platoon-unknown";
  const pWinPct = Math.round((pick.p_win || 0) * 100);
  const rebootPct = Math.round((pick.reboot_rate || 0) * 100);

  return (
    <div className={`reboot-row ${hint.cls}`}>
      <div className="reboot-row-main">
        <div className="reboot-row-top">
          <span className="reboot-row-side">{side}</span>
          <span className="reboot-row-name">{pick.player}</span>
          <span className={platoonCls}>
            {bat}/{thr}
          </span>
        </div>
        <div className="reboot-row-meta">
          {pick.team} vs {pick.opp || "?"} ·{" "}
          <b>{MARKET_LABEL[pick.market] || pick.market}</b> {pick.line}
          {pick.opp_pitcher && <> · {pick.opp_pitcher}</>}
        </div>
      </div>

      <div className="reboot-row-metrics">
        <div className="reboot-metric">
          <span className="reboot-metric-label">p(win)</span>
          <span className="reboot-metric-value">{pWinPct}%</span>
        </div>
        <div className="reboot-metric">
          <span className="reboot-metric-label">reboot</span>
          <span className="reboot-metric-value reboot-strong">{rebootPct}%</span>
        </div>
        <span className={`reboot-hint ${hint.cls}`} title={platoon}>
          {hint.label}
        </span>
      </div>
    </div>
  );
}
