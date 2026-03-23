import { useQuery } from "@tanstack/react-query";
import { fetchPlayerGameLog } from "../../api/client";
import { formatAvg } from "../../utils/formatters";

export default function PlayerGameLog({ playerId, isPitcher }) {
  const { data: games, isLoading } = useQuery({
    queryKey: ["gameLog", playerId, isPitcher ? "pitching" : "hitting"],
    queryFn: () => fetchPlayerGameLog(playerId, isPitcher ? "pitching" : "hitting"),
    enabled: !!playerId,
    staleTime: 1000 * 60 * 30,
  });

  if (isLoading || !games?.length) return null;

  return (
    <div className="stat-section">
      <h3 className="stat-section-title">Recent Games</h3>
      <div className="gamelog-table-wrap">
        <table className="gamelog-table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Opp</th>
              {isPitcher ? (
                <>
                  <th scope="col"><abbr title="Innings Pitched">IP</abbr></th>
                  <th scope="col"><abbr title="Hits">H</abbr></th>
                  <th scope="col"><abbr title="Earned Runs">ER</abbr></th>
                  <th scope="col"><abbr title="Strikeouts">K</abbr></th>
                  <th scope="col"><abbr title="Walks">BB</abbr></th>
                </>
              ) : (
                <>
                  <th scope="col"><abbr title="At Bats">AB</abbr></th>
                  <th scope="col"><abbr title="Hits">H</abbr></th>
                  <th scope="col"><abbr title="Home Runs">HR</abbr></th>
                  <th scope="col"><abbr title="Runs Batted In">RBI</abbr></th>
                  <th scope="col"><abbr title="Strikeouts">K</abbr></th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {games.map((g, i) => {
              const d = new Date(g.date);
              const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
              const s = g.stat;
              const isGoodGame = isPitcher
                ? (s.earnedRuns || 0) <= 2 && parseFloat(s.inningsPitched || "0") >= 5
                : (s.hits || 0) >= 2 || (s.homeRuns || 0) >= 1;

              return (
                <tr key={i} className={isGoodGame ? "gamelog-good" : ""}>
                  <td>{dateStr}</td>
                  <td>{g.isHome ? "vs" : "@"} {g.opponent}</td>
                  {isPitcher ? (
                    <>
                      <td>{s.inningsPitched}</td>
                      <td>{s.hits}</td>
                      <td>{s.earnedRuns}</td>
                      <td>{s.strikeOuts}</td>
                      <td>{s.baseOnBalls}</td>
                    </>
                  ) : (
                    <>
                      <td>{s.atBats}</td>
                      <td className={s.hits >= 2 ? "gamelog-highlight" : ""}>{s.hits}</td>
                      <td className={s.homeRuns >= 1 ? "gamelog-highlight" : ""}>{s.homeRuns}</td>
                      <td>{s.rbi}</td>
                      <td>{s.strikeOuts}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
