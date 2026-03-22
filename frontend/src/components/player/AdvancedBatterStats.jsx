import { useQuery } from "@tanstack/react-query";
import { fetchPlayerAdvanced } from "../../api/client";
import { formatAvg } from "../../utils/formatters";
import LoadingSpinner from "../common/LoadingSpinner";

export default function AdvancedBatterStats({ playerId }) {
  const { data, isLoading } = useQuery({
    queryKey: ["advanced", playerId],
    queryFn: () => fetchPlayerAdvanced(playerId),
    enabled: !!playerId,
    staleTime: 1000 * 60 * 60,
  });

  if (isLoading) return <LoadingSpinner text="Loading advanced stats..." />;
  if (!data || Object.keys(data).length === 0) return null;

  return (
    <div className="stat-section">
      <h3 className="stat-section-title">Statcast Metrics</h3>
      <div className="stat-grid">
        <StatCell label="Avg EV" value={data.avgExitVelo != null ? `${data.avgExitVelo}` : "—"} />
        <StatCell label="Max EV" value={data.maxExitVelo != null ? `${data.maxExitVelo}` : "—"} />
        <StatCell label="Hard Hit%" value={data.hardHitPct != null ? `${data.hardHitPct}%` : "—"} />
        <StatCell label="Barrel%" value={data.barrelPct != null ? `${data.barrelPct}%` : "—"} />
        <StatCell label="Avg LA" value={data.avgLaunchAngle != null ? `${data.avgLaunchAngle}°` : "—"} />
        <StatCell label="Whiff%" value={data.whiffRate != null ? `${data.whiffRate}%` : "—"} />
        <StatCell label="Chase%" value={data.chaseRate != null ? `${data.chaseRate}%` : "—"} />
        <StatCell label="GB%" value={data.gbPct != null ? `${data.gbPct}%` : "—"} />
        <StatCell label="FB%" value={data.fbPct != null ? `${data.fbPct}%` : "—"} />
        <StatCell label="LD%" value={data.ldPct != null ? `${data.ldPct}%` : "—"} />
        <StatCell label="xBA" value={data.xBA != null ? formatAvg(data.xBA) : "—"} highlight />
        <StatCell label="xSLG" value={data.xSLG != null ? formatAvg(data.xSLG) : "—"} highlight />
        <StatCell label="xwOBA" value={data.xwOBA != null ? formatAvg(data.xwOBA) : "—"} highlight />
      </div>
    </div>
  );
}

function StatCell({ label, value, highlight }) {
  return (
    <div className={`stat-cell ${highlight ? "stat-highlight" : ""}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}
