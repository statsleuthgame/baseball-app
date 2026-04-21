import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchTodaysBestParlays,
  fetchRefreshStatus,
  triggerRefresh,
} from "../../api/client";

/**
 * "Best Parlays" — the primary card on the Edge page.
 *
 * Six curated parlays (2× 2-man, 2× 3-man, 2× 4-man) derived from the
 * morning-lock run. Each leg carries a `source` tag so the user can see
 * at a glance whether the pick comes from our internal Fantasy-Score
 * edge, the Edge-repo Model 1 (Hits / TB / HR), or a reboot-strategy
 * overlay.
 *
 * Data flow:
 *   scripts/generate_fantasy_projections.py
 *     → backend/app/services/parlays.build_best_parlays()
 *     → frontend/public/data/fantasy/todays_best_parlays.json
 *     → this component
 *
 * Unlike the legacy ParlayIdeas collapse, this is always open: the user
 * asked for a small, focused daily picklist they can act on — showing
 * 5-6 parlays by default matches that intent.
 */

const SOURCE_META = {
  fantasy_edge: { label: "Fantasy edge",   cls: "src-fantasy"  },
  model_hits:   { label: "Hits model",     cls: "src-hits"     },
  model_tb:     { label: "TB model",       cls: "src-tb"       },
  model_hr:     { label: "HR model",       cls: "src-hr"       },
  // Model + reboot-strategy overlay — highest-signal combo
  "model_hits+reboot": { label: "Hits + reboot", cls: "src-reboot" },
  "model_tb+reboot":   { label: "TB + reboot",   cls: "src-reboot" },
  "model_hr+reboot":   { label: "HR + reboot",   cls: "src-reboot" },
};

const MARKET_SHORT = {
  fantasy_score: "Fantasy",
  hits:          "Hits",
  total_bases:   "Total Bases",
  home_runs:     "Home Runs",
};

export default function BestParlays() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["fantasy", "bestParlays"],
    queryFn: fetchTodaysBestParlays,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    refetchIntervalInBackground: false,
  });

  const parlays = data?.parlays || [];
  const counts  = data?.leg_counts || {};
  const hasParlays = parlays.length > 0;
  const generatedAt = data?.generated_at || null;

  // ---- Refresh button state (only meaningful when the local backend is
  //      reachable; static-site deploys show the button but it'll fall
  //      back to an error toast on click).
  const [refreshState, setRefreshState] = useState("idle"); // idle|running|success|error
  const [refreshStep,  setRefreshStep]  = useState(null);
  const [refreshErr,   setRefreshErr]   = useState(null);
  const pollRef = useRef(null);

  // Poll the status file every 3s while a refresh is in flight so the
  // button can narrate progress ("Running Edge model...", etc.).
  useEffect(() => {
    if (refreshState !== "running") {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = setInterval(async () => {
      const s = await fetchRefreshStatus();
      if (s?.step) setRefreshStep(s.step);
    }, 3000);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [refreshState]);

  const onRefresh = async () => {
    setRefreshState("running");
    setRefreshStep("starting");
    setRefreshErr(null);
    try {
      await triggerRefresh({ includeModel: true });
      setRefreshState("success");
      queryClient.invalidateQueries({ queryKey: ["fantasy"] });
      queryClient.invalidateQueries({ queryKey: ["edge"] });
      setTimeout(() => setRefreshState("idle"), 2500);
    } catch (e) {
      setRefreshState("error");
      const msg = summarizeRefreshError(e);
      setRefreshErr(msg);
      // Always log the full error to the console so the user can open
      // DevTools and see the real traceback / stderr tail.
      // eslint-disable-next-line no-console
      console.error("[BestParlays refresh failed]", {
        message: msg,
        response: e?.response?.data,
        status: e?.response?.status,
        axios:   e?.toJSON?.() || e,
      });
      setTimeout(() => setRefreshState("idle"), 12000);
    }
  };

  const refreshButton = (
    <RefreshButton
      state={refreshState}
      step={refreshStep}
      error={refreshErr}
      onClick={onRefresh}
    />
  );

  if (isLoading) {
    return (
      <section className="best-parlays">
        <div className="best-parlays-header">
          <h2 className="best-parlays-title">Today's Best Parlays</h2>
          {refreshButton}
        </div>
        <p className="parlay-empty">Loading curated parlays…</p>
      </section>
    );
  }

  if (!hasParlays) {
    return (
      <section className="best-parlays">
        <div className="best-parlays-header">
          <h2 className="best-parlays-title">Today's Best Parlays</h2>
          {refreshButton}
        </div>
        <p className="parlay-empty">
          Curated parlays generate with the morning lock. Click <b>Refresh</b>{" "}
          to pull the latest PrizePicks lines + rebuild everything now.
        </p>
      </section>
    );
  }

  return (
    <section className="best-parlays">
      <div className="best-parlays-header">
        <h2 className="best-parlays-title">Today's Best Parlays</h2>
        <div className="best-parlays-header-right">
          <span className="best-parlays-meta">
            {counts.fantasy_edge ?? 0} fantasy · {counts.model ?? 0} model legs
            {generatedAt && <> · as of {new Date(generatedAt).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"})}</>}
          </span>
          {refreshButton}
        </div>
      </div>
      <p className="best-parlays-sub">
        {parlays.length} curated combos — each leg tagged by source.
        No same-game, no same-player, max 1 HR leg per parlay.
      </p>
      <div className="best-parlays-grid">
        {parlays.map((parlay, i) => (
          <BestParlayCard key={i} parlay={parlay} index={i} />
        ))}
      </div>
      <p className="best-parlays-footnote">
        EV% = combined probability × payout − 1, assuming independent
        outcomes. PrizePicks lines shift intraday — always verify before
        playing.
      </p>
    </section>
  );
}

// -----------------------------------------------------------------------
// Card
// -----------------------------------------------------------------------
function BestParlayCard({ parlay }) {
  const { size, payout, combined_prob, ev_pct, legs } = parlay;
  const probPct = Math.round((combined_prob || 0) * 1000) / 10;
  const evLabel = ev_pct >= 0 ? `+${ev_pct.toFixed(1)}%` : `${ev_pct.toFixed(1)}%`;

  // Best-in-group ribbon: flag the top-EV parlay per size so the user
  // knows which 2-/3-/4-man we lean toward when there are two of each.
  const ribbon = `Best ${size}-man`;

  return (
    <div className="best-parlay-card">
      <div className="best-parlay-head">
        <div className="best-parlay-size-badge">
          {size}-man · {payout}×
        </div>
        <div className="best-parlay-metrics">
          <span className="best-parlay-metric">
            <span className="best-parlay-metric-label">Prob</span>
            <span className="best-parlay-metric-value">{probPct}%</span>
          </span>
          <span className={`best-parlay-metric ev ${ev_pct > 0 ? "pos" : "neg"}`}>
            <span className="best-parlay-metric-label">EV</span>
            <span className="best-parlay-metric-value">{evLabel}</span>
          </span>
        </div>
      </div>
      <ul className="best-parlay-legs">
        {legs.map((leg, j) => (
          <BestParlayLeg key={`${leg.player_id}-${leg.market}-${j}`} leg={leg} />
        ))}
      </ul>
    </div>
  );
}

function BestParlayLeg({ leg }) {
  const src = SOURCE_META[leg.source] || { label: leg.source, cls: "src-generic" };
  const marketLabel = MARKET_SHORT[leg.market] || leg.market;
  const hitPct = Math.round((leg.hit_prob || 0) * 100);
  const side = (leg.side || "over").toUpperCase();

  // Pick the most informative secondary stat we have for this leg.
  let extra = null;
  if (leg.source === "fantasy_edge" && leg.efp != null) {
    extra = `proj ${leg.efp}`;
  } else if (leg.reboot_rate != null && String(leg.source).includes("reboot")) {
    extra = `reboot ${Math.round(leg.reboot_rate * 100)}%`;
  } else if (leg.edge != null) {
    const e = (leg.edge * 100).toFixed(1);
    extra = `edge ${leg.edge >= 0 ? "+" : ""}${e}%`;
  }

  return (
    <li className="best-parlay-leg">
      <div className="best-parlay-leg-main">
        <div className="best-parlay-leg-top">
          <span className={`best-parlay-src ${src.cls}`}>{src.label}</span>
          <span className="best-parlay-leg-side">{side}</span>
          <span className="best-parlay-leg-name">{leg.name}</span>
        </div>
        <div className="best-parlay-leg-meta">
          {leg.team_abbr} vs {leg.opp_abbr}
          {leg.opp_pitcher ? ` · ${leg.opp_pitcher}` : ""}
        </div>
      </div>
      <div className="best-parlay-leg-line">
        <span className="best-parlay-leg-market">{marketLabel}</span>
        <span className="best-parlay-leg-number">{leg.line}</span>
        <span className="best-parlay-leg-prob">
          {hitPct}%{extra ? ` · ${extra}` : ""}
        </span>
      </div>
    </li>
  );
}

// -----------------------------------------------------------------------
// Refresh button — kicks the backend refresh pipeline.
// -----------------------------------------------------------------------
const STEP_LABELS = {
  starting:            "Starting",
  edge_model:          "Running Model 1 (PP + reboot)",
  fantasy_projections: "Refreshing fantasy projections + parlays",
};

/**
 * Produce the most useful single-line error message we can from an axios
 * failure. Tries, in order:
 *   - ECONNREFUSED / no backend running     → "Backend not reachable at …"
 *   - timeout                                → "Timed out after …"
 *   - 502 with `detail.steps`                → "{step} failed: {stderr tail}"
 *   - other HTTP error                       → status + detail
 *   - anything else                          → axios message
 */
function summarizeRefreshError(e) {
  // No response = network layer blew up (most common: backend not running)
  if (!e?.response) {
    const code = e?.code || "";
    if (code === "ECONNABORTED") {
      return "Refresh timed out (>4 min). Check the backend log — the script may still be running.";
    }
    if (code === "ERR_NETWORK" || /network/i.test(e?.message || "")) {
      return "Backend unreachable at /api/fantasy/refresh. Is the local FastAPI server running on port 10000?";
    }
    return e?.message || "Refresh failed with no response (is the backend running?)";
  }
  const status = e.response.status;
  const detail = e.response.data?.detail;
  // 409 = already running; 502 = pipeline failed; anything else is server-side.
  if (status === 409) {
    return `A refresh is already in progress (started ${detail?.since || "earlier"}).`;
  }
  if (status === 502 && detail && typeof detail === "object") {
    const failed = (detail.steps || []).find((s) => s.status === "failed");
    const tail = (failed?.stderr_tail || failed?.stdout_tail || "").trim();
    const lastLine = tail ? tail.split("\n").filter(Boolean).pop() : "";
    const head = `${detail.failed_step || "pipeline"} failed (rc=${failed?.rc ?? "?"}).`;
    return lastLine ? `${head} ${lastLine}` : head;
  }
  if (typeof detail === "string") return `${status}: ${detail}`;
  if (detail?.message) return `${status}: ${detail.message}`;
  return `${status}: ${e.message || "unknown error"}`;
}

function RefreshButton({ state, step, error, onClick }) {
  const running = state === "running";
  const label = running
    ? (STEP_LABELS[step] || "Refreshing") + "…"
    : state === "success" ? "Refreshed"
    : state === "error"   ? "Failed"
    : "Refresh lines + parlays";

  const cls = [
    "best-parlays-refresh",
    running ? "running" : "",
    state === "success" ? "success" : "",
    state === "error"   ? "error"   : "",
  ].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      disabled={running}
      aria-busy={running}
      title={running
        ? "Refresh in progress — ~60-120s"
        : "Pull the latest PrizePicks lines + rebuild all parlays"}
    >
      <span className="best-parlays-refresh-icon" aria-hidden="true">
        {running ? "⟳" : state === "success" ? "✓" : state === "error" ? "⚠" : "↻"}
      </span>
      <span className="best-parlays-refresh-label">{label}</span>
      {state === "error" && error && (
        <span className="best-parlays-refresh-tooltip">{error}</span>
      )}
    </button>
  );
}
