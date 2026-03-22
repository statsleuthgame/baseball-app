import { NavLink, useParams } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";

const tabs = [
  {
    path: "",
    label: "Dashboard",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    path: "matchup",
    label: "Matchup",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    path: "spray",
    label: "Spray",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <circle cx="8" cy="9" r="1.5" fill="currentColor" />
        <circle cx="15" cy="7" r="1.5" fill="currentColor" />
        <circle cx="14" cy="14" r="1.5" fill="currentColor" />
        <circle cx="7" cy="13" r="1.5" fill="currentColor" />
        <circle cx="11" cy="5" r="1.5" fill="currentColor" />
      </svg>
    ),
  },
];

export default function BottomNav() {
  const { teamId: contextTeamId } = useTeam();
  const { teamId: urlTeamId } = useParams();
  const teamId = contextTeamId || urlTeamId;

  return (
    <nav className="bottom-nav">
      {tabs.map((tab) => (
        <NavLink
          key={tab.path}
          to={`/team/${teamId}/${tab.path}`}
          end={tab.path === ""}
          className={({ isActive }) => `bottom-nav-item ${isActive ? "active" : ""}`}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
