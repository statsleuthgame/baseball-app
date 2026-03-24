import { NavLink, useParams, useLocation } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";

const tabs = [
  {
    path: "",
    label: "Home",
    icon: (
      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    path: "matchup",
    label: "Matchup",
    icon: (
      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="8" cy="8" r="4" />
        <circle cx="16" cy="16" r="4" />
        <line x1="11" y1="5" x2="19" y2="13" />
      </svg>
    ),
  },
  {
    path: "schedule",
    label: "Schedule",
    icon: (
      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    path: "scores",
    label: "Scores",
    icon: (
      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="18" rx="2" />
        <line x1="2" y1="9" x2="22" y2="9" />
        <line x1="2" y1="15" x2="22" y2="15" />
        <line x1="12" y1="3" x2="12" y2="21" />
      </svg>
    ),
  },
  {
    path: "roster",
    label: "Roster",
    icon: (
      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
];

export default function BottomNav() {
  const { teamId: contextTeamId } = useTeam();
  const { teamId: urlTeamId } = useParams();
  const location = useLocation();
  const teamId = contextTeamId || urlTeamId;

  const isPlayerPage = location.pathname.includes("/player/");

  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {tabs.map((tab) => {
        let isActive;
        if (tab.path === "") {
          isActive = location.pathname === `/team/${teamId}` || location.pathname === `/team/${teamId}/`;
        } else if (tab.path === "roster") {
          isActive = location.pathname.includes(`/team/${teamId}/roster`) || location.pathname.includes(`/team/${teamId}/spray`) || isPlayerPage;
        } else {
          isActive = location.pathname.includes(`/team/${teamId}/${tab.path}`);
        }

        return (
          <NavLink
            key={tab.path}
            to={`/team/${teamId}/${tab.path}`}
            end={tab.path === ""}
            className={`bottom-nav-item ${isActive ? "active" : ""}`}
            aria-current={isActive ? "page" : undefined}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
