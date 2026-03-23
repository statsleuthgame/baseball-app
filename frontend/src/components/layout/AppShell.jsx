import { useEffect, Suspense } from "react";
import { Outlet, useParams } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import TopBar from "./TopBar";
import BottomNav from "./BottomNav";
import LoadingSpinner from "../common/LoadingSpinner";

export default function AppShell() {
  const { teamId: urlTeamId } = useParams();
  const { syncTeamFromUrl } = useTeam();

  useEffect(() => {
    if (urlTeamId) {
      syncTeamFromUrl(urlTeamId);
    }
  }, [urlTeamId, syncTeamFromUrl]);

  return (
    <>
      <TopBar />
      <main className="app-content">
        <Suspense fallback={<LoadingSpinner />}>
          <Outlet />
        </Suspense>
      </main>
      <BottomNav />
    </>
  );
}
