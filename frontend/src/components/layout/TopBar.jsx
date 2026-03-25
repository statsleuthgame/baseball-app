import { useTeam } from "../../context/TeamContext";
import { useNavigate, useLocation, useParams } from "react-router-dom";

export default function TopBar() {
  const { team, setTeamId } = useTeam();
  const navigate = useNavigate();
  const location = useLocation();
  const { playerId } = useParams();

  const isNestedPage = !!playerId;

  const handleBack = () => {
    navigate(-1);
  };

  const handleSwitchTeam = () => {
    setTeamId(null);
    navigate("/");
  };

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
            src={`https://www.mlbstatic.com/team-logos/team-cap-on-dark/${team.id}.svg`}
            alt={`${team.name} logo`}
            className="top-bar-logo"
          />
          <h1 className="top-bar-title">{team.name}</h1>
          <button className="top-bar-switch" onClick={handleSwitchTeam} aria-label="Switch team">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 014-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 01-4 4H3" />
            </svg>
          </button>
        </>
      ) : (
        <h1 className="top-bar-title">Baseball Stats</h1>
      )}
    </header>
  );
}
