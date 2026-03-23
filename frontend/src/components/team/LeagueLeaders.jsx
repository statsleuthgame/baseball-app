import { useQuery } from "@tanstack/react-query";
import { useTeam } from "../../context/TeamContext";
import { fetchLeagueLeaders } from "../../api/client";
import { formatAvg } from "../../utils/formatters";

const CATEGORIES = [
  { key: "homeRuns", label: "Home Runs", fmt: (v) => v },
  { key: "battingAverage", label: "Batting Avg", fmt: (v) => formatAvg(parseFloat(v)) },
  { key: "earnedRunAverage", label: "ERA", fmt: (v) => parseFloat(v).toFixed(2) },
  { key: "strikeouts", label: "Strikeouts", fmt: (v) => v },
  { key: "stolenBases", label: "Stolen Bases", fmt: (v) => v },
];

export default function LeagueLeaders() {
  const { teamId } = useTeam();

  const { data } = useQuery({
    queryKey: ["leagueLeaders"],
    queryFn: fetchLeagueLeaders,
    staleTime: 1000 * 60 * 60,
  });

  if (!data || Object.keys(data).length === 0) return null;

  return (
    <div className="leaders-card">
      <h3 className="section-title">League Leaders</h3>
      <div className="leaders-categories">
        {CATEGORIES.map(({ key, label, fmt }) => {
          const leaders = data[key];
          if (!leaders?.length) return null;
          return (
            <div key={key} className="leaders-category">
              <h4 className="leaders-cat-title">{label}</h4>
              {leaders.map((l) => {
                const isOurTeam = l.teamId == teamId;
                return (
                  <div key={l.rank} className={`leaders-row ${isOurTeam ? "our-team" : ""}`}>
                    <span className="leaders-rank">{l.rank}</span>
                    <span className="leaders-name">{l.player.name}</span>
                    <span className="leaders-team">{l.team}</span>
                    <span className="leaders-value">{fmt(l.value)}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
