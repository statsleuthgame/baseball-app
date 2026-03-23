import { lazy } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TeamProvider, useTeam } from "./context/TeamContext";
import AppShell from "./components/layout/AppShell";
import TeamSelector from "./components/team/TeamSelector";
import TeamDashboard from "./components/team/TeamDashboard";

const PlayerDetail = lazy(() => import("./components/player/PlayerDetail"));
const ScheduleView = lazy(() => import("./components/schedule/ScheduleView"));
const MatchupView = lazy(() => import("./components/matchup/MatchupView"));
const RosterGrid = lazy(() => import("./components/team/RosterGrid"));
const WatchGame = lazy(() => import("./components/team/WatchGame"));
const SprayChart = lazy(() => import("./components/spraychart/SprayChart"));

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
        <HashRouter>
          <Routes>
            <Route path="/" element={<TeamRedirect />} />
            <Route path="/team/:teamId" element={<AppShell />}>
              <Route index element={<TeamDashboard />} />
              <Route path="player/:playerId" element={<PlayerDetail />} />
              <Route path="schedule" element={<ScheduleView />} />
              <Route path="matchup" element={<MatchupView />} />
              <Route path="watch" element={<WatchGame />} />
              <Route path="roster" element={<RosterGrid />} />
              <Route path="spray" element={<SprayChart />} />
            </Route>
          </Routes>
        </HashRouter>
      </TeamProvider>
    </QueryClientProvider>
  );
}
