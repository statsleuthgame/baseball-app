import TodayGame from "./TodayGame";
import UpcomingSeries from "./UpcomingSeries";
import StandingsCard from "./StandingsCard";
import TeamHotCold from "./TeamHotCold";
import LeagueLeaders from "./LeagueLeaders";
import TransactionFeed from "./TransactionFeed";
import { useTeam } from "../../context/TeamContext";
import { useIsMobile } from "../../utils/useIsMobile";

export default function TeamDashboard() {
  const { team } = useTeam();
  const isMobile = useIsMobile();
  return (
    <div className="dashboard">
      <h1 className="sr-only">{team?.name || "Team"} Dashboard</h1>
      {/* TodayGame spans full width above the 2-col split (desktop) or
          tops the stack (mobile/tablet). */}
      <div className="dashboard-full">
        <TodayGame />
      </div>
      {isMobile ? (
        // Mobile order: Today → Upcoming → Standings → Hot/Cold →
        // League Leaders → Transactions. Children live directly on the
        // dashboard flex column so the 16 px gap rhythm carries through.
        <>
          <UpcomingSeries />
          <StandingsCard />
          <TeamHotCold />
          <LeagueLeaders />
          <TransactionFeed />
        </>
      ) : (
        // Desktop wide (≥1024 px) splits these wrappers into two grid
        // cells; below 1024 px (tablet) they stack via flex column. Mobile
        // (≤640 px) uses the branch above instead.
        <>
          <div className="dashboard-col-left">
            <UpcomingSeries />
            <TeamHotCold />
            <TransactionFeed />
          </div>
          <div className="dashboard-col-right">
            <StandingsCard />
            <LeagueLeaders />
          </div>
        </>
      )}
    </div>
  );
}
