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

// The composite EdgeScore used as the default sort.
export function computeEdgeScore({ l7OPS, bvpOPS, bvpPA, teamContextOPS }) {
  const l7 = normL7OPS(l7OPS);
  const bvpContrib = bvpWeight(bvpPA) * normL7OPS(bvpOPS);
  const teamContext = teamContextOPS != null ? normL7OPS(teamContextOPS) : l7;
  return 0.5 * l7 + 0.3 * bvpContrib + 0.2 * teamContext;
}

// Human-readable confidence bucket driven by both L7 strength AND BvP sample size.
// Returns { level, label, tone } where tone ∈ { "high", "medium", "low", "sample" }.
export function confidenceBucket({ l7OPS, bvpPA }) {
  const ops = parseFloat(l7OPS);
  const w = bvpWeight(bvpPA);
  const pa = Number(bvpPA) || 0;

  if (pa < 5 && (!Number.isFinite(ops) || ops < 0.8)) {
    return { level: "low", label: "SMALL SAMPLE", tone: "sample" };
  }
  if (w >= 0.8 && Number.isFinite(ops) && ops >= 0.9) {
    return { level: "high", label: "HIGH", tone: "high" };
  }
  if (w >= 0.5 || (Number.isFinite(ops) && ops >= 0.85)) {
    return { level: "medium", label: "MEDIUM", tone: "medium" };
  }
  return { level: "low", label: "LOW", tone: "low" };
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
