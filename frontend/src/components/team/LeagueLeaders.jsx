import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { fetchLeagueLeaders, fetchTeamLeaders } from "../../api/client";
import { formatAvg } from "../../utils/formatters";

const HITTING_CATS = [
  { key: "homeRuns", label: "Home Runs", fmt: (v) => v },
  { key: "battingAverage", label: "Batting Avg", fmt: (v) => formatAvg(parseFloat(v)) },
  { key: "runsBattedIn", label: "RBI", fmt: (v) => v },
  { key: "onBasePlusSlugging", label: "OPS", fmt: (v) => parseFloat(v).toFixed(3) },
  { key: "stolenBases", label: "Stolen Bases", fmt: (v) => v },
  { key: "hits", label: "Hits", fmt: (v) => v },
  { key: "longestHomeRun", label: "Longest HR (ft)", fmt: (v) => `${v}` },
];

const PITCHING_CATS = [
  { key: "earnedRunAverage", label: "ERA", fmt: (v) => parseFloat(v).toFixed(2) },
  { key: "strikeouts", label: "Strikeouts", fmt: (v) => v },
  { key: "wins", label: "Wins", fmt: (v) => v },
  { key: "saves", label: "Saves", fmt: (v) => v },
  { key: "whip", label: "WHIP", fmt: (v) => parseFloat(v).toFixed(2) },
];

export default function LeagueLeaders() {
  const { teamId, team } = useTeam();
  const navigate = useNavigate();
  const [scope, setScope] = useState("team"); // "team" | "league"
  const [tab, setTab] = useState("hitting");

  const currentYear = new Date().getFullYear();
  const { data } = useQuery({
    queryKey: ["leaders", scope, scope === "team" ? teamId : null, currentYear],
    queryFn: () => scope === "team"
      ? fetchTeamLeaders(teamId, currentYear)
      : fetchLeagueLeaders(),
    enabled: scope === "team" ? !!teamId : true,
    staleTime: 1000 * 60 * 60,
  });

  if (!data || (!Object.keys(data.hitting || {}).length && !Object.keys(data.pitching || {}).length)) return null;

  // Drop the longestHomeRun row in Team mode — the custom backend endpoint
  // that powers it doesn't support team filtering.
  const allHittingCats = scope === "team"
    ? HITTING_CATS.filter((c) => c.key !== "longestHomeRun")
    : HITTING_CATS;
  const categories = tab === "hitting" ? allHittingCats : PITCHING_CATS;
  const source = tab === "hitting" ? data.hitting : data.pitching;

  const teamLabel = team?.abbreviation || "Team";

  return (
    <div className="leaders-card">
      <h3 className="section-title">{scope === "team" ? `${teamLabel} Leaders` : "League Leaders"}</h3>
      <div className="leaders-tabs leaders-mode-toggle" role="group" aria-label="Leader scope">
        <button
          type="button"
          className={`leaders-tab ${scope === "team" ? "active" : ""}`}
          onClick={() => setScope("team")}
          aria-pressed={scope === "team"}
        >
          {teamLabel}
        </button>
        <button
          type="button"
          className={`leaders-tab ${scope === "league" ? "active" : ""}`}
          onClick={() => setScope("league")}
          aria-pressed={scope === "league"}
        >
          League
        </button>
      </div>
      <div className="leaders-tabs" role="group" aria-label="Leader category">
        <button
          type="button"
          className={`leaders-tab ${tab === "hitting" ? "active" : ""}`}
          onClick={() => setTab("hitting")}
          aria-pressed={tab === "hitting"}
        >
          Hitting
        </button>
        <button
          type="button"
          className={`leaders-tab ${tab === "pitching" ? "active" : ""}`}
          onClick={() => setTab("pitching")}
          aria-pressed={tab === "pitching"}
        >
          Pitching
        </button>
      </div>
      <div className="leaders-categories">
        {categories.map(({ key, label, fmt }) => {
          const leaders = source?.[key]?.slice(0, 5);
          if (!leaders?.length) return null;
          return (
            <div key={key} className="leaders-category">
              <h4 className="leaders-cat-title">{label}</h4>
              {leaders.map((l, idx) => {
                // In Team mode every row is our team — the highlight is
                // redundant and visually noisy. Only flag in League mode.
                const isOurTeam = scope === "league" && l.teamId == teamId;
                const value = fmt(l.value);
                return (
                  <button
                    key={idx}
                    type="button"
                    className={`leaders-row sb-player-link ${isOurTeam ? "our-team" : ""}`}
                    onClick={() => l.player?.id && navigate(`/team/${teamId}/player/${l.player.id}`)}
                    disabled={!l.player?.id}
                    aria-label={`Rank ${l.rank}: ${l.player.name}, ${l.team}, ${label} ${value}. View player page.`}
                  >
                    <span className="leaders-rank">{l.rank}</span>
                    <span className="leaders-name">{l.player.name}</span>
                    <span className="leaders-team">{l.team}</span>
                    <span className="leaders-value">{value}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
