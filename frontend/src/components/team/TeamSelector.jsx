import { useNavigate } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";

export default function TeamSelector() {
  const { setTeamId, TEAM_DATA } = useTeam();
  const navigate = useNavigate();

  const handleSelect = (id) => {
    setTeamId(id);
    navigate(`/team/${id}`);
  };

  return (
    <div className="team-selector">
      <h1 className="team-selector-title">Choose Your Team</h1>
      <div className="team-selector-grid">
        {Object.values(TEAM_DATA).map((team) => (
          <button
            key={team.id}
            className="team-card"
            onClick={() => handleSelect(team.id)}
            style={{
              "--card-primary": team.primary,
              "--card-secondary": team.secondary,
            }}
          >
            <img
              src={`https://www.mlbstatic.com/team-logos/${team.id}.svg`}
              alt={team.name}
              className="team-card-logo"
            />
            <span className="team-card-name">{team.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
