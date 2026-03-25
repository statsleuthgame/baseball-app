import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from "react";
import ALL_TEAMS from "../data/teams";

const TeamContext = createContext(null);

export function TeamProvider({ children }) {
  const [teamId, setTeamIdRaw] = useState(() => {
    const saved = localStorage.getItem("selectedTeam");
    return saved ? Number(saved) : null;
  });

  const switchingRef = useRef(false);

  const setTeamId = useCallback((id) => {
    if (id === null) switchingRef.current = true;
    setTeamIdRaw(id);
  }, []);

  const syncTeamFromUrl = useCallback((urlTeamId) => {
    if (switchingRef.current) return;
    const parsed = Number(urlTeamId);
    if (parsed && parsed !== teamId) {
      setTeamIdRaw(parsed);
    }
  }, [teamId]);

  useEffect(() => {
    if (teamId) {
      switchingRef.current = false;
      localStorage.setItem("selectedTeam", String(teamId));
      const team = ALL_TEAMS[teamId];
      if (team) {
        document.documentElement.style.setProperty("--team-primary", team.primary);
        document.documentElement.style.setProperty("--team-secondary", team.secondary);
        document.documentElement.style.setProperty("--team-accent", team.accent);
        if (team.headerBg) {
          document.documentElement.style.setProperty("--team-header-bg", team.headerBg);
          document.documentElement.style.setProperty("--team-header-overlay", team.headerOverlay);
        } else {
          document.documentElement.style.removeProperty("--team-header-bg");
          document.documentElement.style.removeProperty("--team-header-overlay");
        }
      }
    } else {
      localStorage.removeItem("selectedTeam");
    }
  }, [teamId]);

  const team = teamId ? ALL_TEAMS[teamId] : null;

  const value = useMemo(
    () => ({ team, teamId, setTeamId, syncTeamFromUrl, TEAM_DATA: ALL_TEAMS }),
    [team, teamId, setTeamId, syncTeamFromUrl]
  );

  return (
    <TeamContext.Provider value={value}>
      {children}
    </TeamContext.Provider>
  );
}

export function useTeam() {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error("useTeam must be used within TeamProvider");
  return ctx;
}
