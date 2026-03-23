import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchTeamHotCold } from "../../api/client";
import { formatAvg } from "../../utils/formatters";
import PlayerPhoto from "../common/PlayerPhoto";

export default function TeamHotCold() {
  const { teamId } = useTeam();
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ["hotCold", teamId],
    queryFn: () => fetchTeamHotCold(teamId),
    enabled: !!teamId,
    staleTime: 1000 * 60 * 30,
  });

  if (!data?.hot?.length && !data?.cold?.length) return null;

  return (
    <div className="hotcold-card">
      {data.hot.length > 0 && (
        <>
          <h3 className="section-title hotcold-hot-title">Heating Up (Last 7 Games)</h3>
          <div className="hotcold-list">
            {data.hot.map((p) => (
              <button key={p.id} className="hotcold-row" onClick={() => navigate(`/team/${teamId}/player/${p.id}`)}>
                <PlayerPhoto playerId={p.id} name={p.name} size={36} />
                <div className="hotcold-info">
                  <span className="hotcold-name">{p.name}</span>
                  <span className="hotcold-pos">{p.position}</span>
                </div>
                <div className="hotcold-stats">
                  <span className="hotcold-avg hot">{formatAvg(p.avg)}</span>
                  <span className="hotcold-line">{p.hits}-{p.ab} · {p.hr} HR · {p.rbi} RBI</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
      {data.cold.length > 0 && (
        <>
          <h3 className="section-title hotcold-cold-title">Going Cold</h3>
          <div className="hotcold-list">
            {data.cold.map((p) => (
              <button key={p.id} className="hotcold-row" onClick={() => navigate(`/team/${teamId}/player/${p.id}`)}>
                <PlayerPhoto playerId={p.id} name={p.name} size={36} />
                <div className="hotcold-info">
                  <span className="hotcold-name">{p.name}</span>
                  <span className="hotcold-pos">{p.position}</span>
                </div>
                <div className="hotcold-stats">
                  <span className="hotcold-avg cold">{formatAvg(p.avg)}</span>
                  <span className="hotcold-line">{p.hits}-{p.ab}</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
