/**
 * Pure scoring helpers for the secret Edge tab.
 * Kept side-effect free so the ranking logic is transparent and testable.
 *
 * The composite EdgeScore is a weighted blend:
 *   score = 0.50 · normL7OPS(L7 OPS)
 *         + 0.30 · bvpWeight(PA) · normL7OPS(BvP OPS)
 *         + 0.20 · teamContext                                  (← defaults to L7 OPS
 *                                                                  until vs-team fetch lands)
 */

// Clamp + normalize an OPS string like ".875" into [0, 1] over [.400, 1.400].
export function normL7OPS(opsStr) {
  const ops = parseFloat(opsStr);
  if (!Number.isFinite(ops)) return 0;
  const min = 0.4;
  const max = 1.4;
  const t = (ops - min) / (max - min);
  return Math.max(0, Math.min(1, t));
}

// Sample-size weighting on batter-vs-pitcher history.
// Zero weight below 5 PA, linear ramp to 1 by 20 PA.
export function bvpWeight(pa) {
  const n = Number(pa) || 0;
  if (n < 5) return 0;
  if (n >= 20) return 1;
  return (n - 5) / 15;
}

// Normalize K / PA rate into [0, 1]. 15% is quiet; 45%+ is huge fade signal.
export function normKRate(strikeouts, pa) {
  const p = Number(pa) || 0;
  if (p <= 0) return 0;
  const rate = (Number(strikeouts) || 0) / p;
  const min = 0.15;
  const max = 0.45;
  return Math.max(0, Math.min(1, (rate - min) / (max - min)));
}

// The composite EdgeScore used as the default sort.
// teamContext is sample-gated: below 10 AB vs the opposing team we fall back
// to L7 OPS so picks aren't penalized for lack of history.
export function computeEdgeScore({
  l7OPS,
  bvpOPS,
  bvpPA,
  teamContextOPS,
  teamContextAB,
}) {
  const l7 = normL7OPS(l7OPS);
  const bvpContrib = bvpWeight(bvpPA) * normL7OPS(bvpOPS);
  const ab = Number(teamContextAB) || 0;
  const hasTeamSample = ab >= 10 && teamContextOPS != null;
  const teamContext = hasTeamSample ? normL7OPS(teamContextOPS) : l7;
  return 0.5 * l7 + 0.3 * bvpContrib + 0.2 * teamContext;
}

// Higher = stronger fade candidate (batter likely to underperform today).
// Mirrors computeEdgeScore's weights but inverts every term:
//   0.50 · cold L7  +  0.30 · bvpWeight(PA) · bvp-struggle blend
//                   +  0.20 · career-vs-team struggle (sample-gated → cold L7)
// The BvP signal is 60% low OPS + 40% high K-rate so strikeout-prone matchups
// register hard even when the raw AVG/OPS isn't terrible.
export function computeFadeScore({
  l7OPS,
  bvpOPS,
  bvpPA,
  bvpK,
  teamContextOPS,
  teamContextAB,
}) {
  const coldL7 = 1 - normL7OPS(l7OPS);
  const fadeBvpOPS = 1 - normL7OPS(bvpOPS);
  const kRate = normKRate(bvpK, bvpPA);
  const bvpSignal = 0.6 * fadeBvpOPS + 0.4 * kRate;
  const bvpContrib = bvpWeight(bvpPA) * bvpSignal;
  const ab = Number(teamContextAB) || 0;
  const hasTeamSample = ab >= 10 && teamContextOPS != null;
  const teamFade = hasTeamSample ? 1 - normL7OPS(teamContextOPS) : coldL7;
  return 0.5 * coldL7 + 0.3 * bvpContrib + 0.2 * teamFade;
}

// Tier the pill purely from the composite EdgeScore so the visible label
// (HIGH / MEDIUM / LOW) and the card's rank always agree. Thin-sample picks
// naturally score lower — bvpWeight collapses below 5 PA, and team context
// falls back to L7 below 10 AB — so a separate "small sample" pill isn't
// needed and would only fight with the rank order.
export function scoreBucket(score) {
  const s = Number(score) || 0;
  if (s >= 0.55) return { level: "high", label: "HIGH", tone: "high" };
  if (s >= 0.4) return { level: "medium", label: "MEDIUM", tone: "medium" };
  return { level: "low", label: "LOW", tone: "low" };
}

// Back-compat alias — callers that still pass the old input shape get a
// bucket based on a rough L7-only approximation. New callers should use
// scoreBucket(score) directly.
export function confidenceBucket({ l7OPS }) {
  return scoreBucket(normL7OPS(l7OPS));
}

// Rank picks and cap the result so a single scorching lineup can't dominate.
// `picks` must already carry a `.score` and a `.teamId`.
export function rankPicks(picks, { maxTotal = 15, maxPerTeam = 3 } = {}) {
  const sorted = [...picks].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const perTeam = new Map();
  const out = [];
  for (const p of sorted) {
    const used = perTeam.get(p.teamId) || 0;
    if (used >= maxPerTeam) continue;
    out.push(p);
    perTeam.set(p.teamId, used + 1);
    if (out.length >= maxTotal) break;
  }
  return out;
}
