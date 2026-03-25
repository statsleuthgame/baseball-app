import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchUpcomingSeries } from "../../api/client";
import { formatGameDate, formatGameTime, lastName } from "../../utils/formatters";
import PlayerPhoto from "../common/PlayerPhoto";

export default function UpcomingSeries() {
  const { teamId } = useTeam();
  const navigate = useNavigate();

  const { data: games } = useQuery({
    queryKey: ["upcomingSeries", teamId],
    queryFn: () => fetchUpcomingSeries(teamId),
    enabled: !!teamId,
    staleTime: 1000 * 60 * 30,
  });

  if (!games?.length) return null;

  return (
    <div className="series-card">
      <h3 className="section-title">Upcoming Games</h3>
      <div className="series-list">
        {games.map((g) => {
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
                  <div className="series-pitcher sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${us.probablePitcher.id}`)}>
                    <PlayerPhoto playerId={us.probablePitcher.id} name={us.probablePitcher.fullName} size={24} />
                    <span>{lastName(us.probablePitcher.fullName)}</span>
                  </div>
                )}
                {us.probablePitcher && opp.probablePitcher && <span className="series-pitcher-vs">vs</span>}
                {opp.probablePitcher && (
                  <div className="series-pitcher sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${opp.probablePitcher.id}`)}>
                    <PlayerPhoto playerId={opp.probablePitcher.id} name={opp.probablePitcher.fullName} size={24} />
                    <span>{lastName(opp.probablePitcher.fullName)}</span>
                  </div>
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
