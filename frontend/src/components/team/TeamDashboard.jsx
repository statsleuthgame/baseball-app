import TodayGame from "./TodayGame";
import StandingsCard from "./StandingsCard";
import HotPlayers from "./HotPlayers";
import RosterGrid from "./RosterGrid";

export default function TeamDashboard() {
  return (
    <div className="dashboard">
      <TodayGame />
      <StandingsCard />
      <HotPlayers />
      <RosterGrid />
    </div>
  );
}
