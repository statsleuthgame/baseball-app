import { useTeam } from "../../context/TeamContext";
import { useNavigate, useLocation, useParams } from "react-router-dom";

export default function TopBar() {
  const { team, teamId, setTeamId, TEAM_DATA } = useTeam();
  const navigate = useNavigate();
  const location = useLocation();
  const { playerId } = useParams();

  const isNestedPage = !!playerId;

  const handleBack = () => {
    navigate(`/team/${teamId}`);
  };

  const handleSwitch = () => {
    const newTeamId = teamId === 136 ? 144 : 136;
    setTeamId(newTeamId);
    const path = location.pathname;
    const currentTab = path.split("/").slice(3).join("/");
    navigate(`/team/${newTeamId}/${currentTab}`);
  };

  const otherTeam = teamId === 136 ? TEAM_DATA[144] : TEAM_DATA[136];

  return (
    <header className="top-bar">
      {isNestedPage && (
        <button className="top-bar-back" onClick={handleBack} aria-label="Back to team dashboard">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}
      {team ? (
        <>
          <img
            src={`https://www.mlbstatic.com/team-logos/${team.id}.svg`}
            alt={`${team.name} logo`}
            className="top-bar-logo"
          />
          <h1 className="top-bar-title">{team.name}</h1>
          <button className="top-bar-switch" onClick={handleSwitch} aria-label={`Switch to ${otherTeam?.name}`}>
            {otherTeam && (
              <img
                src={`https://www.mlbstatic.com/team-logos/${otherTeam.id}.svg`}
                alt=""
                aria-hidden="true"
                style={{ width: 24, height: 24 }}
              />
            )}
          </button>
        </>
      ) : (
        <h1 className="top-bar-title">Baseball Stats</h1>
      )}
    </header>
  );
}
