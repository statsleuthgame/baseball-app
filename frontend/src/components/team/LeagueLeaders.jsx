import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTeam } from "../../context/TeamContext";
import { fetchLeagueLeaders } from "../../api/client";
import { formatAvg } from "../../utils/formatters";

const HITTING_CATS = [
  { key: "homeRuns", label: "Home Runs", fmt: (v) => v },
  { key: "battingAverage", label: "Batting Avg", fmt: (v) => formatAvg(parseFloat(v)) },
  { key: "runsBattedIn", label: "RBI", fmt: (v) => v },
  { key: "stolenBases", label: "Stolen Bases", fmt: (v) => v },
  { key: "hits", label: "Hits", fmt: (v) => v },
];

const PITCHING_CATS = [
  { key: "earnedRunAverage", label: "ERA", fmt: (v) => parseFloat(v).toFixed(2) },
  { key: "strikeouts", label: "Strikeouts", fmt: (v) => v },
  { key: "wins", label: "Wins", fmt: (v) => v },
  { key: "saves", label: "Saves", fmt: (v) => v },
  { key: "whip", label: "WHIP", fmt: (v) => parseFloat(v).toFixed(2) },
];

export default function LeagueLeaders() {
  const { teamId } = useTeam();
  const [tab, setTab] = useState("hitting");

  const { data } = useQuery({
    queryKey: ["leagueLeaders"],
    queryFn: fetchLeagueLeaders,
    staleTime: 1000 * 60 * 60,
  });

  if (!data || (!Object.keys(data.hitting || {}).length && !Object.keys(data.pitching || {}).length)) return null;

  const categories = tab === "hitting" ? HITTING_CATS : PITCHING_CATS;
  const source = tab === "hitting" ? data.hitting : data.pitching;

  return (
    <div className="leaders-card">
      <h3 className="section-title">League Leaders</h3>
      <div className="leaders-tabs">
        <button className={`leaders-tab ${tab === "hitting" ? "active" : ""}`} onClick={() => setTab("hitting")}>Hitting</button>
        <button className={`leaders-tab ${tab === "pitching" ? "active" : ""}`} onClick={() => setTab("pitching")}>Pitching</button>
      </div>
      <div className="leaders-categories">
        {categories.map(({ key, label, fmt }) => {
          const leaders = source?.[key];
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
