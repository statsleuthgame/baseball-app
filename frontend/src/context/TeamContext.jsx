import { createContext, useContext, useState, useEffect, useRef } from "react";

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
  const [teamId, setTeamIdRaw] = useState(() => {
    const saved = localStorage.getItem("selectedTeam");
    return saved ? Number(saved) : null;
  });

  // Track whether user intentionally cleared the team
  const switchingRef = useRef(false);

  const setTeamId = (id) => {
    if (id === null) {
      switchingRef.current = true;
    }
    setTeamIdRaw(id);
  };

  // Allow AppShell to sync URL teamId, but not if user is switching teams
  const syncTeamFromUrl = (urlTeamId) => {
    if (switchingRef.current) return; // don't override intentional clear
    const parsed = Number(urlTeamId);
    if (parsed && parsed !== teamId) {
      setTeamIdRaw(parsed);
    }
  };

  // Reset the switching flag when teamId becomes non-null (new team selected)
  useEffect(() => {
    if (teamId) {
      switchingRef.current = false;
      localStorage.setItem("selectedTeam", String(teamId));
      const team = TEAM_DATA[teamId];
      if (team) {
        document.documentElement.style.setProperty("--team-primary", team.primary);
        document.documentElement.style.setProperty("--team-secondary", team.secondary);
        document.documentElement.style.setProperty("--team-accent", team.accent);
      }
    } else {
      localStorage.removeItem("selectedTeam");
    }
  }, [teamId]);

  const team = teamId ? TEAM_DATA[teamId] : null;

  return (
    <TeamContext.Provider value={{ team, teamId, setTeamId, syncTeamFromUrl, TEAM_DATA }}>
      {children}
    </TeamContext.Provider>
  );
}

export function useTeam() {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error("useTeam must be used within TeamProvider");
  return ctx;
}
