import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TeamProvider, useTeam } from "./context/TeamContext";
import AppShell from "./components/layout/AppShell";
import TeamSelector from "./components/team/TeamSelector";
import TeamDashboard from "./components/team/TeamDashboard";
import PlayerDetail from "./components/player/PlayerDetail";
import ScheduleView from "./components/schedule/ScheduleView";
import MatchupView from "./components/matchup/MatchupView";
import SprayChart from "./components/spraychart/SprayChart";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

function TeamRedirect() {
  const { teamId } = useTeam();
  if (teamId) return <Navigate to={`/team/${teamId}`} replace />;
  return <TeamSelector />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TeamProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<TeamRedirect />} />
            <Route path="/team/:teamId" element={<AppShell />}>
              <Route index element={<TeamDashboard />} />
              <Route path="player/:playerId" element={<PlayerDetail />} />
              <Route path="schedule" element={<ScheduleView />} />
              <Route path="matchup" element={<MatchupView />} />
              <Route path="spray" element={<SprayChart />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </TeamProvider>
    </QueryClientProvider>
  );
}
