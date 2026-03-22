import { useQuery } from "@tanstack/react-query";
import { useTeam } from "../../context/TeamContext";
import { fetchStandings } from "../../api/client";

export default function StandingsCard() {
  const { team } = useTeam();

  const { data: divisions, isLoading } = useQuery({
    queryKey: ["standings"],
    queryFn: () => fetchStandings(),
    staleTime: 1000 * 60 * 30,
  });

  if (isLoading) return <div className="standings-card skeleton" />;
  if (!divisions) return null;

  const myDivision = divisions.find((d) => d.divisionId === team?.divisionId);
  if (!myDivision) return null;

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
    </div>
  );
}
