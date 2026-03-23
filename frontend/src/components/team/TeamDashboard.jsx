import TodayGame from "./TodayGame";
import UpcomingSeries from "./UpcomingSeries";
import StandingsCard from "./StandingsCard";
import TeamHotCold from "./TeamHotCold";
import LeagueLeaders from "./LeagueLeaders";
import TransactionFeed from "./TransactionFeed";
import RosterGrid from "./RosterGrid";

export default function TeamDashboard() {
  return (
    <div className="dashboard">
      <TodayGame />
      <UpcomingSeries />
      <StandingsCard />
      <TeamHotCold />
      <LeagueLeaders />
      <TransactionFeed />
      <RosterGrid />
    </div>
  );
}
