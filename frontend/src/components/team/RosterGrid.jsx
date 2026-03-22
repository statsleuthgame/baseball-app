import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchRoster } from "../../api/client";
import PlayerPhoto from "../common/PlayerPhoto";
import LoadingSpinner from "../common/LoadingSpinner";
import ErrorMessage from "../common/ErrorMessage";

export default function RosterGrid() {
  const { teamId } = useTeam();
  const navigate = useNavigate();

  const { data: roster, isLoading, error, refetch } = useQuery({
    queryKey: ["roster", teamId],
    queryFn: () => fetchRoster(teamId),
    enabled: !!teamId,
    staleTime: 1000 * 60 * 60,
  });

  if (isLoading) return <LoadingSpinner text="Loading roster..." />;
  if (error) return <ErrorMessage message="Failed to load roster." onRetry={refetch} />;
  if (!roster?.length) return <p className="no-data">No roster data available.</p>;

  const pitchers = roster.filter((p) => p.position.type === "Pitcher");
  const positionPlayers = roster.filter((p) => p.position.type !== "Pitcher");

  return (
    <div className="roster-section">
      <h3 className="roster-group-title">Position Players</h3>
      <div className="roster-grid">
        {positionPlayers.map((player) => (
          <button
            key={player.id}
            className="roster-player"
            onClick={() => navigate(`/team/${teamId}/player/${player.id}`)}
          >
            <PlayerPhoto playerId={player.id} name={player.fullName} size={56} />
            <div className="roster-player-info">
              <span className="roster-player-name">{player.fullName}</span>
              <span className="roster-player-pos">
                {player.position.abbreviation} · #{player.jerseyNumber}
              </span>
            </div>
          </button>
        ))}
      </div>

      <h3 className="roster-group-title">Pitchers</h3>
      <div className="roster-grid">
        {pitchers.map((player) => (
          <button
            key={player.id}
            className="roster-player"
            onClick={() => navigate(`/team/${teamId}/player/${player.id}`)}
          >
            <PlayerPhoto playerId={player.id} name={player.fullName} size={56} />
            <div className="roster-player-info">
              <span className="roster-player-name">{player.fullName}</span>
              <span className="roster-player-pos">
                {player.position.abbreviation} · #{player.jerseyNumber}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
