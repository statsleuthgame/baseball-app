import { useEffect, useRef, Suspense } from "react";
import { Outlet, useParams, useLocation } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import TopBar from "./TopBar";
import BottomNav from "./BottomNav";
import LoadingSpinner from "../common/LoadingSpinner";

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

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    if (prevPath.current !== location.pathname) {
      scrollPositions[prevPath.current] = el.scrollTop;
    }
    prevPath.current = location.pathname;

    const saved = scrollPositions[location.pathname];
    requestAnimationFrame(() => {
      el.scrollTop = saved || 0;
    });
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <TopBar />
      <main className="app-content" ref={contentRef}>
        <Suspense fallback={<LoadingSpinner />}>
          <Outlet />
        </Suspense>
      </main>
      <BottomNav />
    </div>
  );
}
