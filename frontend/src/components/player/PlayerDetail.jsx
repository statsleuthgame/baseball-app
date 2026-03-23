import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTeam } from "../../context/TeamContext";
import { fetchPlayerStats } from "../../api/client";
import PlayerPhoto from "../common/PlayerPhoto";
import LoadingSpinner from "../common/LoadingSpinner";
import ErrorMessage from "../common/ErrorMessage";
import BatterStats from "./BatterStats";
import PitcherStats from "./PitcherStats";
import AdvancedBatterStats from "./AdvancedBatterStats";
import PitchArsenal from "./PitchArsenal";
import DominanceProfile from "./DominanceProfile";

export default function PlayerDetail() {
  const { playerId } = useParams();
  const { teamId } = useTeam();
  const navigate = useNavigate();

  // Single fetch for both detail and stats (same JSON file)
  const { data: playerData, isLoading, error } = useQuery({
    queryKey: ["playerInfo", playerId],
    queryFn: () => fetchPlayerStats(playerId),
    enabled: !!playerId,
  });

  const player = playerData?.detail;
  const stats = playerData?.stats?.stats || {};
  const isPitcher = player?.primaryPosition === "P";

  if (isLoading) return <LoadingSpinner text="Loading player..." />;
  if (error || !player?.id) return <ErrorMessage message="Player not found." />;

  return (
    <div className="player-detail">
      <div className="player-header">
        <PlayerPhoto playerId={player.id} name={player.fullName} size={96} />
        <div className="player-header-info">
          <h2 className="player-name">{player.fullName}</h2>
          <p className="player-meta">
            #{player.primaryNumber} · {player.primaryPosition} ·{" "}
            {player.batSide === "R" ? "R" : player.batSide === "L" ? "L" : "S"}/
            {player.pitchHand === "R" ? "R" : "L"}
          </p>
          <p className="player-bio">
            {player.height} · {player.weight} lbs · Age {player.age}
          </p>
        </div>
      </div>

      {!isPitcher && (
        <div className="player-actions">
          <button
            className="player-action-btn"
            onClick={() => navigate(`/team/${teamId}/spray?player=${playerId}`)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <circle cx="8" cy="9" r="1.5" fill="currentColor" />
              <circle cx="15" cy="7" r="1.5" fill="currentColor" />
              <circle cx="14" cy="14" r="1.5" fill="currentColor" />
            </svg>
            View Spray Chart
          </button>
        </div>
      )}

      {isPitcher ? (
        <PitcherStats stats={stats} />
      ) : (
        <BatterStats stats={stats} />
      )}

      {isPitcher ? (
        <>
          <PitchArsenal playerId={playerId} />
          <DominanceProfile playerId={playerId} />
        </>
      ) : (
        <AdvancedBatterStats playerId={playerId} />
      )}
    </div>
  );
}
