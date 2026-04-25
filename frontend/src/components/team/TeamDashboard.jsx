import TodayGame from "./TodayGame";
import UpcomingSeries from "./UpcomingSeries";
import StandingsCard from "./StandingsCard";
import TeamHotCold from "./TeamHotCold";
import LeagueLeaders from "./LeagueLeaders";
import TransactionFeed from "./TransactionFeed";
import { useTeam } from "../../context/TeamContext";

export default function TeamDashboard() {
  const { team } = useTeam();
  return (
    <div className="dashboard">
      <h1 className="sr-only">{team?.name || "Team"} Dashboard</h1>
      {/* TodayGame spans full width above the 2-col split.
          Left column on desktop wide: Upcoming, Hot/Cold, Transactions.
          Right column: Standings + League Leaders.
          On mobile everything stacks (parent is flex column). */}
      <div className="dashboard-full">
        <TodayGame />
      </div>
      <div className="dashboard-col-left">
        <UpcomingSeries />
        <TeamHotCold />
        <TransactionFeed />
      </div>
      <div className="dashboard-col-right">
        <StandingsCard />
        <LeagueLeaders />
      </div>
    </div>
  );
}
