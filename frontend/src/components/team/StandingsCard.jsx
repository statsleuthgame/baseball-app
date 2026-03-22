import { useQuery } from "@tanstack/react-query";
import { useTeam } from "../../context/TeamContext";
import { fetchStandings, fetchPlayoffOdds } from "../../api/client";

export default function StandingsCard() {
  const { team } = useTeam();

  const { data: divisions, isLoading } = useQuery({
    queryKey: ["standings"],
    queryFn: () => fetchStandings(),
    staleTime: 1000 * 60 * 30,
  });

  const { data: playoffData } = useQuery({
    queryKey: ["playoffOdds"],
    queryFn: () => fetchPlayoffOdds(),
    staleTime: 1000 * 60 * 60,
  });

  if (isLoading) return <div className="standings-card skeleton" />;
  if (!divisions) return null;

  const myDivision = divisions.find((d) => d.divisionId === team?.divisionId);
  if (!myDivision) return null;

  const myOdds = playoffData?.teams?.find((t) => t.teamId === team?.id);

  return (
    <div className="standings-card">
      <h3 className="standings-title">{myDivision.divisionName}</h3>
      <table className="standings-table">
        <thead>
          <tr>
            <th>Team</th>
            <th>W</th>
            <th>L</th>
            <th>PCT</th>
            <th>GB</th>
            <th>STR</th>
          </tr>
        </thead>
        <tbody>
          {myDivision.teams.map((t) => (
            <tr key={t.id} className={t.id === team?.id ? "my-team" : ""}>
              <td className="standings-team-cell">
                <img
                  src={t.logoUrl}
                  alt={t.abbreviation}
                  className="standings-logo"
                />
                <span>{t.abbreviation}</span>
              </td>
              <td>{t.wins}</td>
              <td>{t.losses}</td>
              <td>{t.winPct}</td>
              <td>{t.gamesBack}</td>
              <td>{t.streakCode}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {myOdds && (
        <div className="playoff-odds">
          <h4 className="playoff-odds-title">Playoff Projections</h4>
          <div className="odds-grid">
            <div className="odds-item">
              <span className="odds-value">{myOdds.winDivision}</span>
              <span className="odds-label">Win Division</span>
            </div>
            <div className="odds-item">
              <span className="odds-value">{myOdds.makePlayoffs}</span>
              <span className="odds-label">Make Playoffs</span>
            </div>
            <div className="odds-item">
              <span className="odds-value">{myOdds.winWorldSeries}</span>
              <span className="odds-label">Win WS</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
