import { useQuery } from "@tanstack/react-query";
import { fetchPriorMatchups } from "../../api/client";
import { formatGameDate } from "../../utils/formatters";

export default function PriorMatchups({ team1Id, team2Id, team1Abbr, team2Abbr }) {
  const { data, isLoading } = useQuery({
    queryKey: ["priorMatchups", team1Id, team2Id],
    queryFn: () => fetchPriorMatchups(team1Id, team2Id),
    enabled: !!team1Id && !!team2Id,
    staleTime: 1000 * 60 * 30,
  });

  if (!team1Id || !team2Id) return null;
  if (isLoading) return null;
  if (!data?.games?.length) return null;

  return (
    <div className="matchup-section">
      <h3>Season Series: {team1Abbr} vs {team2Abbr}</h3>
      <div className="prior-record">
        <span className="prior-wins">{data.record.wins}</span>
        <span className="prior-sep">-</span>
        <span className="prior-losses">{data.record.losses}</span>
      </div>
      <div className="prior-games">
        {data.games.map((g) => (
          <div key={g.gamePk} className={`prior-game-row ${g.won ? "win" : "loss"}`}>
            <span className="prior-date">{formatGameDate(g.date)}</span>
            <span className="prior-teams">{g.awayAbbr} @ {g.homeAbbr}</span>
            <span className={`prior-score ${g.won ? "win-text" : "loss-text"}`}>
              {g.awayScore}-{g.homeScore}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
