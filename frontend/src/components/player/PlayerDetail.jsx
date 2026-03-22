import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTeam } from "../../context/TeamContext";
import { fetchPlayerDetail, fetchPlayerStats } from "../../api/client";
import PlayerPhoto from "../common/PlayerPhoto";
import LoadingSpinner from "../common/LoadingSpinner";
import ErrorMessage from "../common/ErrorMessage";
import BatterStats from "./BatterStats";
import PitcherStats from "./PitcherStats";

export default function PlayerDetail() {
  const { playerId } = useParams();
  const { teamId } = useTeam();

  const { data: player, isLoading: loadingDetail, error } = useQuery({
    queryKey: ["playerDetail", playerId],
    queryFn: () => fetchPlayerDetail(playerId),
    enabled: !!playerId,
  });

  const isPitcher = player?.primaryPosition === "P";

  const { data: statsData, isLoading: loadingStats } = useQuery({
    queryKey: ["playerStats", playerId, isPitcher ? "pitching" : "hitting"],
    queryFn: () => fetchPlayerStats(playerId, undefined, isPitcher ? "pitching" : "hitting"),
    enabled: !!player,
  });

  if (loadingDetail) return <LoadingSpinner text="Loading player..." />;
  if (error || !player?.id) return <ErrorMessage message="Player not found." />;

  const stats = statsData?.stats || {};

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

      {loadingStats ? (
        <LoadingSpinner text="Loading stats..." />
      ) : isPitcher ? (
        <PitcherStats stats={stats} />
      ) : (
        <BatterStats stats={stats} />
      )}
    </div>
  );
}
