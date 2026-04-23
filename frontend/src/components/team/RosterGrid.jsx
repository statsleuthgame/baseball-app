import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchRoster } from "../../api/client";
import LoadingSpinner from "../common/LoadingSpinner";
import ErrorMessage from "../common/ErrorMessage";
import PlayerPhoto from "../common/PlayerPhoto";
import { useIsMobile } from "../../utils/useIsMobile";

export default function RosterGrid() {
  const { teamId } = useTeam();
  const navigate = useNavigate();
  // Desktop-wide only: show player headshots in front of the name to fill the
  // extra horizontal space the 2-col layout provides.
  const isWide = useIsMobile("(min-width: 1024px)");

  const { data: roster, isLoading, error, refetch } = useQuery({
    queryKey: ["roster", teamId],
    queryFn: () => fetchRoster(teamId),
    enabled: !!teamId,
    staleTime: 1000 * 60 * 15,
  });

  if (isLoading) return <LoadingSpinner text="Loading roster..." />;
  if (error) return <ErrorMessage message="Failed to load roster." onRetry={refetch} />;
  if (!roster?.length) return <p className="no-data">No roster data available.</p>;

  const pitchers = roster.filter((p) => p.position.type === "Pitcher");
  const positionPlayers = roster.filter((p) => p.position.type !== "Pitcher");

  return (
    <div className="roster-section">
      {/* Left column on desktop wide: Position Players.
          Right column: Pitchers. Mobile: stacks naturally. */}
      <div className="roster-col-left">
        <h3 className="roster-group-title">Position Players</h3>
        <div className="roster-list">
          {positionPlayers.map((player) => (
            <button
              key={player.id}
              className="roster-row"
              onClick={() => navigate(`/team/${teamId}/player/${player.id}`)}
              aria-label={`View ${player.fullName}, ${player.position.abbreviation}`}
            >
              {isWide && (
                <PlayerPhoto
                  playerId={player.id}
                  name={player.fullName}
                  size={56}
                  className="roster-row-photo"
                />
              )}
              <span className="roster-row-name">{player.fullName}</span>
              <span className="roster-row-meta">{player.position.abbreviation} · #{player.jerseyNumber}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="roster-col-right">
        <h3 className="roster-group-title">Pitchers</h3>
        <div className="roster-list">
          {pitchers.map((player) => (
            <button
              key={player.id}
              className="roster-row"
              onClick={() => navigate(`/team/${teamId}/player/${player.id}`)}
              aria-label={`View ${player.fullName}, ${player.position.abbreviation}`}
            >
              {isWide && (
                <PlayerPhoto
                  playerId={player.id}
                  name={player.fullName}
                  size={56}
                  className="roster-row-photo"
                />
              )}
              <span className="roster-row-name">{player.fullName}</span>
              <span className="roster-row-meta">{player.position.abbreviation} · #{player.jerseyNumber}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
