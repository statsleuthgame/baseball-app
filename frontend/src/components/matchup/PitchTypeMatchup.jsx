import { useQuery } from "@tanstack/react-query";
import { fetchPitchTypeMatchup } from "../../api/client";
import { formatAvg } from "../../utils/formatters";
import LoadingSpinner from "../common/LoadingSpinner";

export default function PitchTypeMatchup({ batterId, pitcherId, batterName }) {
  const { data, isLoading } = useQuery({
    queryKey: ["pitchTypeMatchup", batterId, pitcherId],
    queryFn: () => fetchPitchTypeMatchup(batterId, pitcherId),
    enabled: !!batterId && !!pitcherId,
    staleTime: 1000 * 60 * 60,
  });

  if (!batterId || !pitcherId) return null;
  if (isLoading) return <LoadingSpinner text="Loading pitch matchups..." />;
  if (!data?.length) return null;

  return (
    <div className="matchup-section">
      <h3>{batterName || "Batter"} vs Pitch Arsenal</h3>
      <div className="pitch-matchup-table-wrap">
        <table className="pitch-matchup-table">
          <thead>
            <tr>
              <th>Pitch</th>
              <th>Seen</th>
              <th>PA</th>
              <th>H</th>
              <th>HR</th>
              <th>AVG</th>
              <th>Whiff%</th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.pitchType}>
                <td className="pitch-name-cell">{p.pitchName}</td>
                <td>{p.seen}</td>
                <td>{p.pa}</td>
                <td>{p.hits ?? "—"}</td>
                <td>{p.hr ?? "—"}</td>
                <td>{p.avg != null ? formatAvg(p.avg) : "—"}</td>
                <td>{p.whiffRate != null ? `${p.whiffRate}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
