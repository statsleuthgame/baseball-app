import TodayGame from "./TodayGame";
import UpcomingSeries from "./UpcomingSeries";
import StandingsCard from "./StandingsCard";
import TeamHotCold from "./TeamHotCold";
import LeagueLeaders from "./LeagueLeaders";
import TransactionFeed from "./TransactionFeed";

export default function TeamDashboard() {
  return (
    <div className="dashboard">
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
