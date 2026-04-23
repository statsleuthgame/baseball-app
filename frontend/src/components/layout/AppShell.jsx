import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import { Outlet, useParams, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTeam } from "../../context/TeamContext";
import TopBar from "./TopBar";
import TopTabs from "./TopTabs";
import LoadingSpinner from "../common/LoadingSpinner";
import ErrorBoundary from "../common/ErrorBoundary";

const scrollPositions = {};

const PAGE_TITLES = {
  "": "Home",
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
  const queryClient = useQueryClient();

  const [pullState, setPullState] = useState({ pulling: false, distance: 0, refreshing: false });
  const touchStart = useRef(null);

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

  // Pages that opt out of the narrow centered-column cap on desktop.
  // Match the first route segment after /team/:teamId/ so we don't have to
  // enumerate every gamePk.
  const firstSegment = location.pathname.split("/").slice(3)[0] || "";
  // "" matches the team home (/team/:teamId) where there is no segment after the id.
  const WIDE_ROUTES = new Set(["", "live", "scores", "matchup", "roster", "player"]);
  const isWideRoute = WIDE_ROUTES.has(firstSegment);

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

  const handleTouchStart = useCallback((e) => {
    const el = contentRef.current;
    if (el && el.scrollTop <= 0) {
      touchStart.current = e.touches[0].clientY;
    } else {
      touchStart.current = null;
    }
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (touchStart.current === null || pullState.refreshing) return;
    const diff = e.touches[0].clientY - touchStart.current;
    if (diff > 0) {
      setPullState((s) => ({ ...s, pulling: true, distance: Math.min(diff * 0.35, 80) }));
    }
  }, [pullState.refreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (pullState.distance > 65 && !pullState.refreshing) {
      setPullState({ pulling: false, distance: 40, refreshing: true });
      await queryClient.invalidateQueries();
      setPullState({ pulling: false, distance: 0, refreshing: false });
    } else {
      setPullState({ pulling: false, distance: 0, refreshing: false });
    }
    touchStart.current = null;
  }, [pullState.distance, pullState.refreshing, queryClient]);

  return (
    <div className="app-shell">
      <TopBar />
      <TopTabs />
      {pullState.distance > 0 && (
        <div className="pull-indicator" style={{ height: pullState.distance }}>
          <div className={`pull-spinner ${pullState.refreshing ? "spinning" : ""}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${pullState.distance * 4}deg)` }}>
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </div>
        </div>
      )}
      <main
        className={`app-content${isWideRoute ? " app-content--wide" : ""}`}
        ref={contentRef}
        tabIndex={-1}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <ErrorBoundary key={location.pathname}>
          <Suspense fallback={<LoadingSpinner />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
