import { NavLink, useParams, useLocation } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";

const tabs = [
  { path: "", label: "Home" },
  { path: "matchup", label: "Matchup" },
  { path: "scores", label: "Scores" },
  { path: "schedule", label: "Schedule" },
  { path: "roster", label: "Roster" },
];

export default function TopTabs() {
  const { teamId: contextTeamId } = useTeam();
  const { teamId: urlTeamId } = useParams();
  const location = useLocation();
  const teamId = contextTeamId || urlTeamId;

  return (
    <nav className="top-tabs" aria-label="Main navigation">
      <div className="top-tabs-scroll">
        {tabs.map((tab) => {
          let isActive;
          if (tab.path === "") {
            isActive = location.pathname === `/team/${teamId}` || location.pathname === `/team/${teamId}/`;
          } else if (tab.path === "roster") {
            isActive = location.pathname === `/team/${teamId}/roster`;
          } else {
            isActive = location.pathname.includes(`/team/${teamId}/${tab.path}`);
          }

          return (
            <NavLink
              key={tab.path}
              to={`/team/${teamId}/${tab.path}`}
              end={tab.path === ""}
              className={`top-tab ${isActive ? "top-tab-active" : ""}`}
              aria-current={isActive ? "page" : undefined}
            >
              {tab.label}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
