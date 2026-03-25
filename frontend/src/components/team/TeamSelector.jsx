import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";

const DIVISIONS = [
  { label: "AL East", id: 201 },
  { label: "AL Central", id: 202 },
  { label: "AL West", id: 200 },
  { label: "NL East", id: 204 },
  { label: "NL Central", id: 205 },
  { label: "NL West", id: 203 },
];

export default function TeamSelector() {
  const { setTeamId, TEAM_DATA } = useTeam();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const allTeams = Object.values(TEAM_DATA);
  const filtered = search
    ? allTeams.filter((t) =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.abbreviation.toLowerCase().includes(search.toLowerCase())
      )
    : allTeams;

  const handleSelect = (id) => {
    setTeamId(id);
    navigate(`/team/${id}`);
  };

  return (
    <div className="team-selector">
      <h1 className="team-selector-title">Choose Your Team</h1>
      <input
        className="team-selector-search"
        type="text"
        placeholder="Search teams..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      {search ? (
        <div className="team-selector-grid">
          {filtered.map((team) => (
            <TeamCard key={team.id} team={team} onSelect={handleSelect} />
          ))}
          {!filtered.length && <p className="team-selector-empty">No teams found</p>}
        </div>
      ) : (
        DIVISIONS.map((div) => {
          const teams = allTeams.filter((t) => t.divisionId === div.id);
          return (
            <div key={div.id} className="team-selector-division">
              <h2 className="team-selector-division-title">{div.label}</h2>
              <div className="team-selector-grid">
                {teams.map((team) => (
                  <TeamCard key={team.id} team={team} onSelect={handleSelect} />
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function TeamCard({ team, onSelect }) {
  return (
    <button
      className="team-card"
      onClick={() => onSelect(team.id)}
      aria-label={`Select ${team.name}`}
      style={{ "--card-primary": team.primary, "--card-secondary": team.secondary }}
    >
      <img
        src={`https://www.mlbstatic.com/team-logos/${team.id}.svg`}
        alt={team.name}
        className="team-card-logo"
      />
      <span className="team-card-name">{team.name}</span>
    </button>
  );
}
