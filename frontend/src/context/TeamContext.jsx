import { createContext, useContext, useState, useEffect } from "react";

const TeamContext = createContext(null);

const TEAM_DATA = {
  136: {
    id: 136,
    name: "Seattle Mariners",
    abbreviation: "SEA",
    primary: "#0C2C56",
    secondary: "#005C5C",
    accent: "#C4CED4",
    venueId: 680,
    divisionId: 200,
  },
  144: {
    id: 144,
    name: "Atlanta Braves",
    abbreviation: "ATL",
    primary: "#13274F",
    secondary: "#CE1141",
    accent: "#EAAA00",
    venueId: 4705,
    divisionId: 204,
  },
};

export function TeamProvider({ children }) {
  const [teamId, setTeamId] = useState(() => {
    const saved = localStorage.getItem("selectedTeam");
    return saved ? Number(saved) : null;
  });

  useEffect(() => {
    if (teamId) {
      localStorage.setItem("selectedTeam", String(teamId));
      const team = TEAM_DATA[teamId];
      if (team) {
        document.documentElement.style.setProperty("--team-primary", team.primary);
        document.documentElement.style.setProperty("--team-secondary", team.secondary);
        document.documentElement.style.setProperty("--team-accent", team.accent);
      }
    }
  }, [teamId]);

  const team = teamId ? TEAM_DATA[teamId] : null;

  return (
    <TeamContext.Provider value={{ team, teamId, setTeamId, TEAM_DATA }}>
      {children}
    </TeamContext.Provider>
  );
}

export function useTeam() {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error("useTeam must be used within TeamProvider");
  return ctx;
}
