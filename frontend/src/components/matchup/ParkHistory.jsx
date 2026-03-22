import { useQuery } from "@tanstack/react-query";
import { fetchParkHistory } from "../../api/client";
import { formatGameDate } from "../../utils/formatters";
import LoadingSpinner from "../common/LoadingSpinner";

export default function ParkHistory({ teamId, venueId, venueName }) {
  const { data, isLoading } = useQuery({
    queryKey: ["parkHistory", teamId, venueId],
    queryFn: () => fetchParkHistory(teamId, venueId),
    enabled: !!teamId && !!venueId,
    staleTime: 1000 * 60 * 60,
  });

  if (!teamId || !venueId) return null;
  if (isLoading) return <LoadingSpinner text="Loading park history..." />;
  if (!data) return null;

  return (
    <div className="matchup-section">
      <h3>Record at {venueName || "Venue"}</h3>
      <div className="park-record">
        <div className="park-record-main">
          <span className="park-record-wins">{data.wins}</span>
          <span className="park-record-sep">-</span>
          <span className="park-record-losses">{data.losses}</span>
        </div>
        {data.winPct != null && (
          <span className="park-record-pct">{(data.winPct * 100).toFixed(1)}% Win Rate</span>
        )}
      </div>
      {data.recentGames?.length > 0 && (
        <div className="park-recent">
          <h4 className="park-recent-title">Recent Games</h4>
          {data.recentGames.map((g, i) => (
            <div key={i} className={`park-game-row ${g.won ? "win" : "loss"}`}>
              <span className="park-game-date">{formatGameDate(g.date)}</span>
              <span className="park-game-opp">vs {g.opponent}</span>
              <span className={`park-game-result ${g.won ? "win-text" : "loss-text"}`}>
                {g.won ? "W" : "L"} {g.score}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
