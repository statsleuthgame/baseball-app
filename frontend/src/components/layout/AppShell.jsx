import { useEffect, useRef, Suspense } from "react";
import { Outlet, useParams, useLocation } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import TopBar from "./TopBar";
import BottomNav from "./BottomNav";
import LoadingSpinner from "../common/LoadingSpinner";

const scrollPositions = {};

const PAGE_TITLES = {
  "": "Dashboard",
  "matchup": "Matchup",
  "schedule": "Schedule",
  "scores": "Scores",
  "roster": "Roster",
  "spray": "Spray Chart",
};

export default function AppShell() {
  const { teamId: urlTeamId } = useParams();
  const { team, syncTeamFromUrl } = useTeam();
  const location = useLocation();
  const contentRef = useRef(null);
  const prevPath = useRef(location.pathname);

  useEffect(() => {
    if (urlTeamId) {
      syncTeamFromUrl(urlTeamId);
    }
  }, [urlTeamId, syncTeamFromUrl]);

  useEffect(() => {
    const segment = location.pathname.split("/").slice(3).join("/") || "";
    const firstSegment = segment.split("/")[0];
    const pageTitle = PAGE_TITLES[firstSegment] || "Player";
    document.title = `${pageTitle} - ${team?.name || "Baseball Stats"}`;
  }, [location.pathname, team?.name]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    if (prevPath.current !== location.pathname) {
      scrollPositions[prevPath.current] = el.scrollTop;
      el.focus({ preventScroll: true });
    }
    prevPath.current = location.pathname;

    const saved = scrollPositions[location.pathname];
    requestAnimationFrame(() => {
      if (el) el.scrollTop = saved || 0;
    });
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <TopBar />
      <main className="app-content" ref={contentRef} tabIndex={-1}>
        <Suspense fallback={<LoadingSpinner />}>
          <Outlet />
        </Suspense>
      </main>
      <BottomNav />
    </div>
  );
}
