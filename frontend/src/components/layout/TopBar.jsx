import { useState, useRef, useEffect, useCallback } from "react";
import { useTeam } from "../../context/TeamContext";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import axios from "axios";

export default function TopBar() {
  const { team, setTeamId } = useTeam();
  const navigate = useNavigate();
  const location = useLocation();
  const { playerId, gamePk } = useParams();
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

  const openEdge = () => {
    if (team?.id) navigate(`/team/${team.id}/edge`);
  };

  const openSearch = () => {
    setSearchOpen(true);
    setQuery("");
    setResults([]);
    setSearched(false);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    setResults([]);
    setSearched(false);
  };

  useEffect(() => {
    if (searchOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [searchOpen]);

  // Close search on route change
  useEffect(() => {
    closeSearch();
  }, [location.pathname]);

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

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) closeSearch();
  };

  const handleKeyDown = (e) => {
    if (e.key === "Escape") closeSearch();
  };

  return (
    <>
      <header className="top-bar">
        {isNestedPage && (
          <button className="top-bar-back" onClick={handleBack} aria-label="Back to team dashboard">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}
        {team ? (
          <>
            <img
              src={`https://www.mlbstatic.com/team-logos/team-cap-on-dark/${team.id}.svg`}
              alt={`${team.name} logo`}
              className="top-bar-logo"
            />
            <h1 className="top-bar-title">{team.name}</h1>
            <button className="top-bar-search" onClick={openSearch} aria-label="Search players">
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
            <button className="top-bar-edge" onClick={openEdge} aria-label="Daily edge picks">
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="2" x2="12" y2="22" />
                <path d="M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
              </svg>
            </button>
            <button className="top-bar-switch" onClick={handleSwitchTeam} aria-label="Switch team">
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="17 1 21 5 17 9" />
                <path d="M3 11V9a4 4 0 014-4h14" />
                <polyline points="7 23 3 19 7 15" />
                <path d="M21 13v2a4 4 0 01-4 4H3" />
              </svg>
            </button>
          </>
        ) : (
          <h1 className="top-bar-title">Baseball Stats</h1>
        )}
      </header>

      {searchOpen && (
        <div className="player-search-overlay" onClick={handleOverlayClick} onKeyDown={handleKeyDown} role="dialog" aria-label="Search players">
          <div className="player-search-panel">
            <div className="player-search-header">
              <svg className="player-search-icon" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={inputRef}
                className="player-search-input"
                type="text"
                placeholder="Search any MLB player..."
                value={query}
                onChange={handleQueryChange}
                onKeyDown={handleKeyDown}
                aria-label="Search players by name"
              />
              <button className="player-search-close" onClick={closeSearch} aria-label="Close search">
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="player-search-results">
              {loading && (
                <div className="player-search-status">Searching...</div>
              )}
              {!loading && searched && results.length === 0 && (
                <div className="player-search-status">No players found</div>
              )}
              {!loading && results.map((player) => (
                <button
                  key={player.id}
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
          </div>
        </div>
      )}
    </>
  );
}
