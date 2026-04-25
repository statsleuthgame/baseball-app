import { useState, useRef, useEffect, useCallback } from "react";
import { useTeam } from "../../context/TeamContext";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import Dialog from "../common/Dialog";

export default function TopBar() {
  const { team, setTeamId } = useTeam();
  const navigate = useNavigate();
  const location = useLocation();
  const { playerId, gamePk } = useParams();
  const queryClient = useQueryClient();
  const isSprayPage = location.pathname.includes("/spray");

  const isNestedPage = !!playerId || isSprayPage || !!gamePk;

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  const handleBack = () => {
    navigate(-1);
  };

  const handleSwitchTeam = () => {
    setTeamId(null);
    navigate("/");
  };

  const handleRefresh = async () => {
    await queryClient.invalidateQueries();
  };

  const openEdge = () => {
    if (team?.id) navigate(`/team/${team.id}/edge`);
  };

  // Edge *Dashboard* (the public Stats Lab at statsleuthgame.github.io/Edge/)
  // — always opens in a new tab so it doesn't eat our SPA navigation stack.
  const openEdgeDashboard = () => {
    window.open("https://statsleuthgame.github.io/Edge/", "_blank", "noopener,noreferrer");
  };

  const openSearch = () => {
    setSearchOpen(true);
    setQuery("");
    setResults([]);
    setSearched(false);
  };

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery("");
    setResults([]);
    setSearched(false);
  }, []);

  // Close search on route change
  useEffect(() => {
    closeSearch();
  }, [location.pathname, closeSearch]);

  const searchPlayers = useCallback(async (searchQuery) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    try {
      const resp = await axios.get("https://statsapi.mlb.com/api/v1/people/search", {
        params: { names: searchQuery, sportId: 1 },
        timeout: 10000,
      });
      const rawPeople = (resp.data?.people || []).slice(0, 25);

      // /people/search doesn't include currentTeam for most results — everyone
      // comes back as "Free Agent". Hydrate with a second batch call so the
      // user can actually click the results.
      const ids = rawPeople.map((p) => p.id).join(",");
      let hydrated = {};
      if (ids) {
        try {
          const h = await axios.get("https://statsapi.mlb.com/api/v1/people", {
            params: { personIds: ids, hydrate: "currentTeam" },
            timeout: 10000,
          });
          for (const p of h.data?.people || []) {
            hydrated[p.id] = p;
          }
        } catch {
          // If the hydrate call fails, fall through with the original data —
          // most results will still show Free Agent but the search itself works.
        }
      }

      const people = rawPeople
        .map((p) => {
          const full = hydrated[p.id] || p;
          const team = full.currentTeam;
          return {
            id: p.id,
            fullName: p.fullName || "",
            position: full.primaryPosition?.abbreviation || p.primaryPosition?.abbreviation || "",
            teamId: team?.id,
            teamName: team?.name || "",
            active: full.active === true,
            photoUrl: `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${p.id}/headshot/67/current`,
          };
        })
        // Active roster only — drop retired, minor-league-only, and true FAs.
        // Hydrated currentTeam + active=true = on an MLB roster right now.
        .filter((p) => p.active && p.teamId);

      setResults(people);
      setSearched(true);
    } catch {
      setResults([]);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQueryChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchPlayers(val), 300);
  };

  const handleResultClick = (player) => {
    if (player.teamId) {
      navigate(`/team/${player.teamId}/player/${player.id}`);
    }
    closeSearch();
  };

  return (
    <>
      <header className="top-bar" role="banner">
        {isNestedPage && (
          <button type="button" className="top-bar-back" onClick={handleBack} aria-label="Back">
            <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}
        {team ? (
          <>
            <img
              src={`https://www.mlbstatic.com/team-logos/team-cap-on-dark/${team.id}.svg`}
              alt=""
              className="top-bar-logo"
            />
            <span className="top-bar-title">{team.name}</span>
            <button type="button" className="top-bar-refresh" onClick={handleRefresh} aria-label="Refresh data">
              <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
            <button type="button" className="top-bar-search" onClick={openSearch} aria-label="Search players">
              <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
            <button type="button" className="top-bar-edge" onClick={openEdge} aria-label="Daily edge picks">
              <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="2" x2="12" y2="22" />
                <path d="M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
              </svg>
            </button>
            <button
              type="button"
              className="top-bar-stats"
              onClick={openEdgeDashboard}
              aria-label="Open Edge Stats Lab dashboard (opens in new tab)"
              title="Open Edge Stats Lab — 155 years of baseball data"
            >
              {/* Bar-chart icon: three rising columns for the historical/stats vibe. */}
              <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4"  y1="21" x2="4"  y2="13" />
                <line x1="12" y1="21" x2="12" y2="7"  />
                <line x1="20" y1="21" x2="20" y2="3"  />
              </svg>
            </button>
            <button type="button" className="top-bar-switch" onClick={handleSwitchTeam} aria-label="Switch team">
              <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="17 1 21 5 17 9" />
                <path d="M3 11V9a4 4 0 014-4h14" />
                <polyline points="7 23 3 19 7 15" />
                <path d="M21 13v2a4 4 0 01-4 4H3" />
              </svg>
            </button>
          </>
        ) : (
          <span className="top-bar-title">Baseball Stats</span>
        )}
      </header>

      <Dialog
        open={searchOpen}
        onClose={closeSearch}
        ariaLabel="Search players"
        className="player-search-overlay"
        panelClassName="player-search-panel"
        initialFocusRef={inputRef}
      >
        <div className="player-search-header">
          <svg className="player-search-icon" aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <label htmlFor="player-search-input" className="sr-only">
            Search any MLB player by name
          </label>
          <input
            id="player-search-input"
            ref={inputRef}
            className="player-search-input"
            type="search"
            placeholder="Search any MLB player..."
            value={query}
            onChange={handleQueryChange}
            autoComplete="off"
          />
          <button type="button" className="player-search-close" onClick={closeSearch} aria-label="Close search">
            <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="player-search-results">
          {loading && (
            <div className="player-search-status" role="status" aria-live="polite">Searching…</div>
          )}
          {!loading && searched && results.length === 0 && (
            <div className="player-search-status" role="status" aria-live="polite">No players found</div>
          )}
          {!loading && results.map((player) => (
            <button
              key={player.id}
              type="button"
              className="player-search-result"
              onClick={() => handleResultClick(player)}
              disabled={!player.teamId}
            >
              <img
                src={player.photoUrl}
                alt=""
                className="player-search-photo"
                loading="lazy"
              />
              <div className="player-search-info">
                <span className="player-search-name">{player.fullName}</span>
                <span className="player-search-meta">
                  {player.position && `${player.position} · `}{player.teamName}
                </span>
              </div>
            </button>
          ))}
        </div>
      </Dialog>
    </>
  );
}
