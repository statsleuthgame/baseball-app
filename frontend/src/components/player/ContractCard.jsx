import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

// Normalized-name comparator matching the Python scraper's _normalize.
function normalizeName(name) {
  if (!name) return "";
  let out = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  for (const junk of [".", ",", "'", "`", "-"]) out = out.split(junk).join("");
  for (const suffix of [" jr", " sr", " ii", " iii", " iv"]) {
    if (out.endsWith(suffix)) out = out.slice(0, -suffix.length);
  }
  return out.split(/\s+/).filter(Boolean).join(" ");
}

// Pretty-print a dollar amount with M/K suffix when large.
function formatMoney(n) {
  if (n == null || n === 0) return "—";
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `$${m.toFixed(m >= 100 ? 0 : 1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

async function fetchContracts() {
  const resp = await fetch(`${import.meta.env.BASE_URL || "/"}data/contracts.json`, { cache: "force-cache" });
  if (!resp.ok) return null;
  return resp.json();
}

export default function ContractCard({ playerName, teamAbbr }) {
  const { data } = useQuery({
    queryKey: ["contracts"],
    queryFn: fetchContracts,
    staleTime: 1000 * 60 * 60 * 24, // a day
    retry: false,
  });

  const entry = useMemo(() => {
    if (!data?.players || !playerName) return null;
    const target = normalizeName(playerName);
    // Prefer exact (name, team) match; fall back to name-only if no team match
    let best = null;
    for (const p of data.players) {
      if (p.normalized_name !== target) continue;
      if (teamAbbr && p.team === teamAbbr) return p; // perfect
      if (!best) best = p;
    }
    return best;
  }, [data, playerName, teamAbbr]);

  if (!entry || !entry.contract) return null;
  const c = entry.contract;
  const hasYearly = Array.isArray(c.yearly) && c.yearly.length > 0;

  // Current + remaining years: anything with year >= current season
  const currentSeason = new Date().getFullYear();
  const remaining = hasYearly ? c.yearly.filter((y) => y.year >= currentSeason) : [];
  const past = hasYearly ? c.yearly.filter((y) => y.year < currentSeason) : [];
  const headline =
    c.years && c.total_value
      ? `${c.years} yr / ${formatMoney(c.total_value)}`
      : c.aav
      ? `${formatMoney(c.aav)} / yr`
      : "—";

  return (
    <div className="contract-card">
      <div className="contract-card-header">
        <h3 className="contract-card-title">Contract</h3>
        <span className="contract-headline">{headline}</span>
      </div>

      <div className="contract-meta-row">
        {c.aav != null && (
          <div className="contract-meta">
            <span className="contract-meta-label">AAV</span>
            <span className="contract-meta-value">{formatMoney(c.aav)}</span>
          </div>
        )}
        {c.start_year && c.end_year && (
          <div className="contract-meta">
            <span className="contract-meta-label">Term</span>
            <span className="contract-meta-value">{c.start_year}–{c.end_year}</span>
          </div>
        )}
        {c.free_agent_year && (
          <div className="contract-meta">
            <span className="contract-meta-label">FA Year</span>
            <span className="contract-meta-value">{c.free_agent_year}</span>
          </div>
        )}
        {c.signing_bonus != null && c.signing_bonus > 0 && (
          <div className="contract-meta">
            <span className="contract-meta-label">Signing Bonus</span>
            <span className="contract-meta-value">{formatMoney(c.signing_bonus)}</span>
          </div>
        )}
      </div>

      {hasYearly && (
        <div className="contract-yearly-wrap">
          <table className="contract-yearly">
            <thead>
              <tr>
                <th>Year</th>
                <th>Age</th>
                <th>Salary</th>
              </tr>
            </thead>
            <tbody>
              {remaining.length > 0 &&
                remaining.map((y) => (
                  <tr key={`r-${y.year}`} className="contract-year-future">
                    <td>{y.year}</td>
                    <td>{y.age ?? "—"}</td>
                    <td>{formatMoney(y.salary)}</td>
                  </tr>
                ))}
              {past.length > 0 &&
                past.map((y) => (
                  <tr key={`p-${y.year}`} className="contract-year-past">
                    <td>{y.year}</td>
                    <td>{y.age ?? "—"}</td>
                    <td>{formatMoney(y.salary)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="contract-card-footer">
        Source: Spotrac · {data?.generated_at ? new Date(data.generated_at).toLocaleDateString() : ""}
      </div>
    </div>
  );
}
