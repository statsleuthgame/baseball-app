import { useEffect, useRef, Suspense } from "react";
import { Outlet, useParams, useLocation } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import TopBar from "./TopBar";
import BottomNav from "./BottomNav";
import LoadingSpinner from "../common/LoadingSpinner";

// Store scroll positions per path
const scrollPositions = {};

export default function AppShell() {
  const { teamId: urlTeamId } = useParams();
  const { syncTeamFromUrl } = useTeam();
  const location = useLocation();
  const contentRef = useRef(null);
  const prevPath = useRef(location.pathname);

  useEffect(() => {
    if (urlTeamId) {
      syncTeamFromUrl(urlTeamId);
    }
  }, [urlTeamId, syncTeamFromUrl]);

  // Save scroll position when leaving, restore when arriving
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    // Save previous page's scroll position
    if (prevPath.current !== location.pathname) {
      scrollPositions[prevPath.current] = el.scrollTop;
    }
    prevPath.current = location.pathname;

    // Restore this page's scroll position (or scroll to top)
    const saved = scrollPositions[location.pathname];
    el.scrollTop = saved || 0;
  }, [location.pathname]);

  return (
    <>
      <TopBar />
      <main className="app-content" ref={contentRef}>
        <Suspense fallback={<LoadingSpinner />}>
          <Outlet />
        </Suspense>
      </main>
      <BottomNav />
    </>
  );
}
