import { useTeam } from "../../context/TeamContext";
import { useNavigate } from "react-router-dom";

export default function TopBar() {
  const { team, setTeamId } = useTeam();
  const navigate = useNavigate();

  const handleSwitch = () => {
    setTeamId(null);
    navigate("/");
  };

  return (
    <header className="top-bar">
      {team ? (
        <>
          <img
            src={`https://www.mlbstatic.com/team-logos/${team.id}.svg`}
            alt={team.name}
            className="top-bar-logo"
          />
          <h1 className="top-bar-title">{team.name}</h1>
          <button className="top-bar-switch" onClick={handleSwitch} title="Switch team">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M7 16l-4-4 4-4M17 8l4 4-4 4M3 12h18" />
            </svg>
          </button>
        </>
      ) : (
        <h1 className="top-bar-title">Baseball Stats</h1>
      )}
    </header>
  );
}
