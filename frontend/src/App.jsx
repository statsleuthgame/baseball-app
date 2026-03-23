import { lazy, Suspense } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TeamProvider, useTeam } from "./context/TeamContext";
import AppShell from "./components/layout/AppShell";
import TeamSelector from "./components/team/TeamSelector";
import TeamDashboard from "./components/team/TeamDashboard";
import LoadingSpinner from "./components/common/LoadingSpinner";

const PlayerDetail = lazy(() => import("./components/player/PlayerDetail"));
const ScheduleView = lazy(() => import("./components/schedule/ScheduleView"));
const MatchupView = lazy(() => import("./components/matchup/MatchupView"));
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

function LazyOutlet({ children }) {
  return <Suspense fallback={<LoadingSpinner />}>{children}</Suspense>;
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
              <Route path="player/:playerId" element={<LazyOutlet><PlayerDetail /></LazyOutlet>} />
              <Route path="schedule" element={<LazyOutlet><ScheduleView /></LazyOutlet>} />
              <Route path="matchup" element={<LazyOutlet><MatchupView /></LazyOutlet>} />
              <Route path="spray" element={<LazyOutlet><SprayChart /></LazyOutlet>} />
            </Route>
          </Routes>
        </HashRouter>
      </TeamProvider>
    </QueryClientProvider>
  );
}
