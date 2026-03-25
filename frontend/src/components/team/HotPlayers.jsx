import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchTodayGame, fetchHotPlayers } from "../../api/client";
import PlayerPhoto from "../common/PlayerPhoto";
import { formatAvg } from "../../utils/formatters";

export default function HotPlayers() {
  const { teamId } = useTeam();
  const navigate = useNavigate();

  // First get today's game to find the opposing team
  const { data: game } = useQuery({
    queryKey: ["todayGame", teamId],
    queryFn: () => fetchTodayGame(teamId),
    enabled: !!teamId,
    staleTime: 1000 * 60 * 5,
  });

  const opponentId = game && !game.noGame
    ? (game.home.id === teamId ? game.away.id : game.home.id)
    : null;

  const opponentName = game && !game.noGame
    ? (game.home.id === teamId ? game.away.abbreviation : game.home.abbreviation)
    : null;

  const { data: hotPlayers, isLoading } = useQuery({
    queryKey: ["hotPlayers", opponentId],
    queryFn: () => fetchHotPlayers(opponentId),
    enabled: !!opponentId,
    staleTime: 1000 * 60 * 60,
  });

  if (!opponentId) return null;
  if (isLoading) return <div className="hot-players-card skeleton" />;
  if (!hotPlayers?.length) return null;

  return (
    <div className="hot-players-card">
      <h3 className="hot-players-title">
        <span className="hot-icon">&#x1F525;</span> Hot {opponentName} Players
        <span className="hot-subtitle">Last 14 days</span>
      </h3>
      <div className="hot-players-list">
        {hotPlayers.slice(0, 5).map((player) => (
          <div key={player.playerId} className="hot-player-row sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${player.playerId}`)}>
            <PlayerPhoto playerId={player.playerId} name={player.playerName} size={40} />
            <div className="hot-player-info">
              <span className="hot-player-name">{player.playerName}</span>
              <span className="hot-player-line">
                {formatAvg(player.avg)} AVG · {player.homeRuns} HR · {formatAvg(player.ops)} OPS
              </span>
            </div>
            <div className="hot-player-ops">
              <span className="hot-ops-value">{formatAvg(player.ops)}</span>
              <span className="hot-ops-label">OPS</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
