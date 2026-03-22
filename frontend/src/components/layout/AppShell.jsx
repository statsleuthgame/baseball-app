import { useEffect } from "react";
import { Outlet, useParams } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import TopBar from "./TopBar";
import BottomNav from "./BottomNav";

export default function AppShell() {
  const { teamId: urlTeamId } = useParams();
  const { syncTeamFromUrl } = useTeam();

  // Sync URL teamId to context on cold start (won't override intentional team switch)
  useEffect(() => {
    if (urlTeamId) {
      syncTeamFromUrl(urlTeamId);
    }
  }, [urlTeamId, syncTeamFromUrl]);

  return (
    <div className="app-shell">
      <TopBar />
      <main className="app-content">
        <Outlet />
      </main>
      <BottomNav />
      <div className="bottom-safe-area" />
    </div>
  );
}
