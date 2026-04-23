import TodayGame from "./TodayGame";
import UpcomingSeries from "./UpcomingSeries";
import StandingsCard from "./StandingsCard";
import TeamHotCold from "./TeamHotCold";
import LeagueLeaders from "./LeagueLeaders";
import TransactionFeed from "./TransactionFeed";

export default function TeamDashboard() {
  return (
    <div className="dashboard">
      {/* Left column on desktop wide: TodayGame, Upcoming, Hot/Cold, Transactions.
          Right column: Standings + League Leaders.
          On mobile both columns flow as one stacked list (parent is flex column). */}
      <div className="dashboard-col-left">
        <TodayGame />
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
