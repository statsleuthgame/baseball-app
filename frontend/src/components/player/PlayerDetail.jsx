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
import AdvancedPitcherStats from "./AdvancedPitcherStats";
import PitchArsenal from "./PitchArsenal";
import DominanceProfile from "./DominanceProfile";
import PlayerGameLog from "./PlayerGameLog";

export default function PlayerDetail() {
  const { playerId } = useParams();
  const { teamId } = useTeam();
  const navigate = useNavigate();

  const { data: playerData, isLoading, error } = useQuery({
    queryKey: ["playerInfo", playerId],
    queryFn: () => fetchPlayerStats(playerId),
    enabled: !!playerId,
  });

  const player = playerData?.detail;
  const isPitcher = player?.primaryPosition === "P";

  // Use current season stats if available, otherwise fall back to previous season
  const statsObj = playerData?.stats || {};
  const hasCurrentStats = statsObj.stats && Object.keys(statsObj.stats).length > 0;
  const stats = hasCurrentStats ? statsObj.stats : (statsObj.prevStats || {});
  const displaySeason = hasCurrentStats ? statsObj.season : statsObj.prevSeason;

  if (isLoading) return <LoadingSpinner text="Loading player..." />;
  if (error || !player?.id) return <ErrorMessage message="Player not found." />;

  return (
    <div className="player-detail">
      <div className="player-header">
        <PlayerPhoto playerId={player.id} name={player.fullName} size={96} />
        <div className="player-header-info">
          <h2 className="player-name">{player.fullName || "Unknown"}</h2>
          <p className="player-meta">
            #{player.primaryNumber || "—"} · {player.primaryPosition || "—"} ·{" "}
            {player.batSide === "R" ? "R" : player.batSide === "L" ? "L" : "S"}/
            {player.pitchHand === "R" ? "R" : "L"}
          </p>
          <p className="player-bio">
            {player.height || "—"} · {player.weight ? `${player.weight} lbs` : "—"} · {player.age ? `Age ${player.age}` : ""}
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
        <PitcherStats stats={stats} season={displaySeason} />
      ) : (
        <BatterStats stats={stats} season={displaySeason} />
      )}

      <PlayerGameLog playerId={playerId} isPitcher={isPitcher} />

      {isPitcher ? (
        <>
          <AdvancedPitcherStats playerId={playerId} />
          <PitchArsenal playerId={playerId} />
          <DominanceProfile playerId={playerId} />
        </>
      ) : (
        <AdvancedBatterStats playerId={playerId} />
      )}
    </div>
  );
}
