import { useEffect } from "react";
import { Outlet, useParams } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import TopBar from "./TopBar";
import BottomNav from "./BottomNav";

export default function AppShell() {
  const { teamId: urlTeamId } = useParams();
  const { teamId, setTeamId } = useTeam();

  // Sync URL teamId to context (handles PWA cold start, direct navigation, etc.)
  useEffect(() => {
    const parsed = Number(urlTeamId);
    if (parsed && parsed !== teamId) {
      setTeamId(parsed);
    }
  }, [urlTeamId, teamId, setTeamId]);

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
