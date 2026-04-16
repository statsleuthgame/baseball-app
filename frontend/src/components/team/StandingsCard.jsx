import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchStandings, fetchPlayoffOdds } from "../../api/client";
import { teamNickname, getTeamAbbr } from "../../utils/formatters";

export default function StandingsCard() {
  const { team, setTeamId } = useTeam();
  const navigate = useNavigate();

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
      <div className="standings-header-row">
        <h2 className="standings-header">Standings</h2>
        <button
          className="standings-full-link"
          onClick={() => navigate(`/team/${team?.id}/standings`)}
          aria-label="View full standings"
        >
          Full Standings
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
      <h3 className="standings-title">{myDivision.divisionName}</h3>
      <table className="standings-table">
        <caption className="sr-only">{myDivision.divisionName} standings</caption>
        <thead>
          <tr>
            <th scope="col">Team</th>
            <th scope="col"><abbr title="Wins">W</abbr></th>
            <th scope="col"><abbr title="Losses">L</abbr></th>
            <th scope="col"><abbr title="Win Percentage">PCT</abbr></th>
            <th scope="col"><abbr title="Games Back">GB</abbr></th>
            <th scope="col"><abbr title="Streak">STR</abbr></th>
          </tr>
        </thead>
        <tbody>
          {myDivision.teams.map((t) => (
            <tr key={t.id} className={`${t.id === team?.id ? "my-team" : ""} standings-clickable`} aria-current={t.id === team?.id ? "true" : undefined} onClick={() => { setTeamId(t.id); navigate(`/team/${t.id}`); }} style={{ cursor: "pointer" }}>
              <td className="standings-team-cell">
                <img
                  src={t.logoUrl}
                  alt={t.abbreviation}
                  className="standings-logo"
                />
                <span className="standings-team-name">{teamNickname(t.abbreviation || getTeamAbbr(t.id))}</span>
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
