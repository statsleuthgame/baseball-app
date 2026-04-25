import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchBvP } from "../../api/client";
import { formatAvg, lastName } from "../../utils/formatters";
import PlayerPhoto from "../common/PlayerPhoto";
import LoadingSpinner from "../common/LoadingSpinner";

export default function BatterVsPitcher({ batters, pitcherId, pitcherName, compact, lineupIds }) {
  if (!batters?.length || !pitcherId) return null;

  let content;
  if (lineupIds?.length) {
    const idSet = new Set(lineupIds);
    const lineupBatters = lineupIds
      .map((id) => batters.find((b) => b.id === id))
      .filter(Boolean);
    const benchBatters = batters.filter((b) => !idSet.has(b.id));

    content = (
      <div className="bvp-list">
        {lineupBatters.map((batter) => (
          <BvPRow key={batter.id} batter={batter} pitcherId={pitcherId} compact={compact} />
        ))}
        {benchBatters.length > 0 && (
          <>
            <div className="bvp-bench-sep">Bench</div>
            {benchBatters.map((batter) => (
              <BvPRow key={batter.id} batter={batter} pitcherId={pitcherId} compact={compact} />
            ))}
          </>
        )}
      </div>
    );
  } else {
    content = (
      <div className="bvp-list">
        {batters.map((batter) => (
          <BvPRow key={batter.id} batter={batter} pitcherId={pitcherId} compact={compact} />
        ))}
      </div>
    );
  }

  if (compact) return content;

  return (
    <div className="matchup-section">
      <h3>Lineup vs {pitcherName || "Starter"}</h3>
      {content}
    </div>
  );
}

function BvPRow({ batter, pitcherId, compact }) {
  const { teamId } = useTeam();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["bvp", batter.id, pitcherId],
    queryFn: () => fetchBvP(batter.id, pitcherId),
    staleTime: 1000 * 60 * 60,
  });

  const statSummary = data && data.pa > 0
    ? `${data.hits} hits in ${data.ab} at-bats, average ${formatAvg(data.avg)}`
    : "no prior at-bats";

  if (compact) {
    return (
      <button
        type="button"
        className="bvp-compact-row sb-player-link"
        onClick={() => navigate(`/team/${teamId}/player/${batter.id}`)}
        aria-label={`${batter.fullName}, ${statSummary}. View player page.`}
      >
        <span className="bvp-compact-name">{lastName(batter.fullName)}</span>
        <span className="bvp-compact-stat">
          {isLoading ? "..." : !data || data.pa === 0 ? "—" : `${data.hits}-${data.ab}`}
        </span>
        {data?.avg != null && data.pa > 0 && (
          <span className="bvp-compact-avg">{formatAvg(data.avg)}</span>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="bvp-row"
      onClick={() => navigate(`/team/${teamId}/player/${batter.id}`)}
      aria-label={`${batter.fullName}${batter.position?.abbreviation ? `, ${batter.position.abbreviation}` : ""}: ${statSummary}. View player page.`}
    >
      <div className="bvp-player">
        <PlayerPhoto playerId={batter.id} name={batter.fullName} size={36} />
        <div className="bvp-player-info">
          <span className="bvp-name">{batter.fullName}</span>
          <span className="bvp-pos">{batter.position?.abbreviation}</span>
        </div>
      </div>
      <div className="bvp-stats" aria-hidden="true">
        {isLoading ? (
          <span className="bvp-loading">...</span>
        ) : !data || data.pa === 0 ? (
          <span className="bvp-no-data">No history</span>
        ) : (
          <>
            <BvPStat label="AB" value={data.ab} />
            <BvPStat label="H" value={data.hits} />
            <BvPStat label="HR" value={data.homeRuns} />
            <BvPStat label="K" value={data.strikeouts} />
            <BvPStat label="AVG" value={formatAvg(data.avg)} highlight />
          </>
        )}
      </div>
    </button>
  );
}

function BvPStat({ label, value, highlight }) {
  return (
    <div className={`bvp-stat ${highlight ? "bvp-highlight" : ""}`}>
      <span className="bvp-stat-val">{value}</span>
      <span className="bvp-stat-lbl">{label}</span>
    </div>
  );
}
