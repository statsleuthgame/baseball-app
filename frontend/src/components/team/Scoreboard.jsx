import { useQuery } from "@tanstack/react-query";
import { useTeam } from "../../context/TeamContext";
import { fetchAllGamesToday } from "../../api/client";
import { formatGameTime } from "../../utils/formatters";
import LoadingSpinner from "../common/LoadingSpinner";

export default function Scoreboard() {
  const { teamId } = useTeam();

  const { data: games, isLoading } = useQuery({
    queryKey: ["allGamesToday"],
    queryFn: fetchAllGamesToday,
    staleTime: 1000 * 60 * 2,
    refetchInterval: 1000 * 60 * 2,
  });

  if (isLoading) return <LoadingSpinner text="Loading scores..." />;
  if (!games?.length) {
    return (
      <div className="scoreboard-empty">
        <h2>No Games Today</h2>
        <p>Check back on a game day for live scores across the league.</p>
      </div>
    );
  }

  // Sort: our team's game first, then live games, then scheduled, then final
  const sorted = [...games].sort((a, b) => {
    const aIsOurs = a.home.id === teamId || a.away.id === teamId;
    const bIsOurs = b.home.id === teamId || b.away.id === teamId;
    if (aIsOurs && !bIsOurs) return -1;
    if (!aIsOurs && bIsOurs) return 1;

    const statusOrder = { "In Progress": 0, "Pre-Game": 1, Warmup: 1, Scheduled: 2, Final: 3 };
    return (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
  });

  return (
    <div className="scoreboard-page">
      <h2 className="scoreboard-title">Today's Games</h2>
      <div className="scoreboard-list">
        {sorted.map((game) => {
          const isOurGame = game.home.id === teamId || game.away.id === teamId;
          const isLive = game.status === "In Progress";
          const isFinal = game.status === "Final";
          const isScheduled = !isLive && !isFinal;

          return (
            <div key={game.gamePk} className={`scoreboard-card ${isOurGame ? "our-game" : ""} ${isLive ? "live" : ""}`}>
              {isLive && (
                <div className="scoreboard-live-badge">
                  {game.inningHalf === "Top" ? "Top" : "Bot"} {game.inning}
                </div>
              )}
              {isFinal && <div className="scoreboard-status-badge">Final</div>}
              {isScheduled && <div className="scoreboard-status-badge">{formatGameTime(game.gameDate)}</div>}

              <div className="scoreboard-teams">
                <div className="scoreboard-team-row">
                  <img src={game.away.logoUrl} alt={game.away.abbreviation} className="scoreboard-logo" />
                  <span className="scoreboard-abbr">{game.away.abbreviation}</span>
                  {game.away.wins != null && (
                    <span className="scoreboard-record">{game.away.wins}-{game.away.losses}</span>
                  )}
                  <span className="scoreboard-score">
                    {(isLive || isFinal) ? game.away.score : ""}
                  </span>
                </div>
                <div className="scoreboard-team-row">
                  <img src={game.home.logoUrl} alt={game.home.abbreviation} className="scoreboard-logo" />
                  <span className="scoreboard-abbr">{game.home.abbreviation}</span>
                  {game.home.wins != null && (
                    <span className="scoreboard-record">{game.home.wins}-{game.home.losses}</span>
                  )}
                  <span className="scoreboard-score">
                    {(isLive || isFinal) ? game.home.score : ""}
                  </span>
                </div>
              </div>

              {/* Probable pitchers for scheduled games */}
              {isScheduled && (game.away.probablePitcher || game.home.probablePitcher) && (
                <div className="scoreboard-pitchers">
                  <span>{game.away.probablePitcher?.fullName?.split(" ").pop() || "TBD"}</span>
                  <span className="scoreboard-pitcher-vs">vs</span>
                  <span>{game.home.probablePitcher?.fullName?.split(" ").pop() || "TBD"}</span>
                </div>
              )}

              {/* Watch button for our game */}
              {isOurGame && (isLive || isScheduled) && (
                <button
                  className="scoreboard-watch-btn"
                  onClick={() => {
                    window.location.href = `mlbatbat://game?game_pk=${game.gamePk}`;
                    setTimeout(() => window.open(`https://www.mlb.tv/game/${game.gamePk}`, "_blank"), 1500);
                  }}
                  aria-label="Watch game"
                >
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  {isLive ? "Watch" : "MLB.tv"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
