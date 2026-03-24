import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchBvP } from "../../api/client";
import { formatAvg } from "../../utils/formatters";
import PlayerPhoto from "../common/PlayerPhoto";
import LoadingSpinner from "../common/LoadingSpinner";

export default function BatterVsPitcher({ batters, pitcherId, pitcherName }) {
  if (!batters?.length || !pitcherId) return null;

  return (
    <div className="matchup-section">
      <h3>Lineup vs {pitcherName || "Starter"}</h3>
      <div className="bvp-list">
        {batters.map((batter) => (
          <BvPRow key={batter.id} batter={batter} pitcherId={pitcherId} />
        ))}
      </div>
    </div>
  );
}

function BvPRow({ batter, pitcherId }) {
  const { teamId } = useTeam();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["bvp", batter.id, pitcherId],
    queryFn: () => fetchBvP(batter.id, pitcherId),
    staleTime: 1000 * 60 * 60,
  });

  return (
    <div className="bvp-row" onClick={() => navigate(`/team/${teamId}/player/${batter.id}`)} style={{ cursor: "pointer" }}>
      <div className="bvp-player">
        <PlayerPhoto playerId={batter.id} name={batter.fullName} size={36} />
        <div className="bvp-player-info">
          <span className="bvp-name">{batter.fullName}</span>
          <span className="bvp-pos">{batter.position?.abbreviation}</span>
        </div>
      </div>
      <div className="bvp-stats">
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
    </div>
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
