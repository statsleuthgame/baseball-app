import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchUpcomingSeries } from "../../api/client";
import { formatGameDate, formatGameTime, lastName } from "../../utils/formatters";

export default function UpcomingSeries() {
  const { teamId } = useTeam();
  const navigate = useNavigate();

  const { data: games } = useQuery({
    queryKey: ["upcomingSeries", teamId],
    queryFn: () => fetchUpcomingSeries(teamId),
    enabled: !!teamId,
    staleTime: 1000 * 60 * 30,
  });

  // Skip the first game since it's already shown in the main game card
  const upcoming = games?.slice(1) || [];
  if (!upcoming.length) return null;

  return (
    <div className="series-card">
      <h3 className="section-title">Upcoming Games</h3>
      <div className="series-list">
        {upcoming.map((g) => {
          const isHome = g.home.id == teamId;
          const opp = isHome ? g.away : g.home;
          const us = isHome ? g.home : g.away;
          return (
            <div key={g.gamePk} className="series-row">
              <div className="series-date">
                <span className="series-dow">{new Date(g.gameDate).toLocaleDateString("en-US", { weekday: "short" })}</span>
                <span className="series-md">{new Date(g.gameDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                <span className="series-time">{formatGameTime(g.gameDate)}</span>
              </div>
              <div className="series-opp">
                <img src={opp.logoUrl} alt={opp.abbreviation} className="series-logo" />
                <span>{isHome ? "vs" : "@"} {opp.abbreviation}</span>
              </div>
              <div className="series-pitchers">
                {us.probablePitcher && (
                  <span className="series-pitcher-name sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${us.probablePitcher.id}`)}>
                    {us.probablePitcher.fullName}
                  </span>
                )}
                {us.probablePitcher && opp.probablePitcher && <span className="series-pitcher-vs">vs</span>}
                {opp.probablePitcher && (
                  <span className="series-pitcher-name sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${opp.probablePitcher.id}`)}>
                    {opp.probablePitcher.fullName}
                  </span>
                )}
                {!us.probablePitcher && !opp.probablePitcher && (
                  <span className="series-tbd">TBD vs TBD</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
