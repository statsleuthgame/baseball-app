import { useQuery } from "@tanstack/react-query";
import { fetchGameLogs } from "../../api/client";
import { useTeam } from "../../context/TeamContext";

/**
 * TeamSeasonTimeline — game-by-game W/L arc with running win% trend.
 * Uses pybaseball schedule_and_record data from gamelogs.json.
 */
export default function TeamSeasonTimeline() {
  const { teamId, teamAbbr } = useTeam();

  const { data: games, isLoading } = useQuery({
    queryKey: ["gamelogs", teamId],
    queryFn: () => fetchGameLogs(teamId),
    enabled: !!teamId,
    staleTime: 1000 * 60 * 60 * 4,
  });

  if (isLoading) return <div className="timeline-skeleton skeleton" />;
  if (!games?.length) return null;

  const completed = games.filter((g) => g.result === "W" || g.result === "L");
  if (completed.length < 5) return null;

  const last = completed[completed.length - 1];
  const wins = last?.wins ?? 0;
  const losses = last?.losses ?? 0;
  const winPct = last?.winPct ?? 0;

  // Streak: count consecutive same result from end
  let streakChar = completed[completed.length - 1]?.result || "";
  let streakCount = 0;
  for (let i = completed.length - 1; i >= 0; i--) {
    if (completed[i].result === streakChar) streakCount++;
    else break;
  }
  const streakLabel = `${streakChar}${streakCount}`;

  // Run differential trend (last 10)
  const last10 = completed.slice(-10);
  const last10W = last10.filter((g) => g.result === "W").length;
  const recentForm = `${last10W}-${10 - last10W} L10`;

  // Win% sparkline: sample every N games to fit ~30 dots
  const step = Math.max(1, Math.floor(completed.length / 30));
  const sampled = [];
  for (let i = 0; i < completed.length; i += step) {
    sampled.push(completed[i]);
  }
  // Always include the last game
  if (sampled[sampled.length - 1] !== completed[completed.length - 1]) {
    sampled.push(completed[completed.length - 1]);
  }

  const width = 280;
  const height = 52;
  const pad = { l: 4, r: 4, t: 8, b: 8 };

  const points = sampled.map((g, i) => {
    const x = pad.l + (i / Math.max(sampled.length - 1, 1)) * (width - pad.l - pad.r);
    const y = pad.t + (1 - (g.winPct ?? 0)) * (height - pad.t - pad.b);
    return `${x},${y}`;
  });

  const polyline = points.join(" ");

  // Color the dots: W = green, L = red
  const dotData = sampled.map((g, i) => {
    const [x, y] = points[i].split(",").map(Number);
    return { x, y, result: g.result };
  });

  return (
    <div className="season-timeline">
      <div className="season-timeline__header">
        <h3 className="section-title">Season Timeline</h3>
        <span className="season-record">{wins}–{losses} <span className="season-pct">({(winPct * 1).toFixed(3).replace(/^0/, "")})</span></span>
      </div>

      <div className="season-timeline__meta">
        <span className={`streak-badge ${streakChar === "W" ? "streak-w" : "streak-l"}`}>{streakLabel}</span>
        <span className="recent-form">{recentForm}</span>
      </div>

      {/* Win% sparkline */}
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="season-sparkline"
        aria-label={`Season win percentage trend for ${teamAbbr}`}
        role="img"
      >
        {/* .500 reference line */}
        <line
          x1={pad.l} y1={(height) / 2}
          x2={width - pad.r} y2={(height) / 2}
          stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="3,3"
        />

        {/* Win% line */}
        <polyline
          points={polyline}
          fill="none"
          stroke="rgba(100,180,255,0.8)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Game dots */}
        {dotData.map(({ x, y, result }, i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={2.5}
            fill={result === "W" ? "#4caf50" : "#f44336"}
            opacity={0.85}
          />
        ))}
      </svg>

      {/* Recent 10 game log dots */}
      <div className="season-last10">
        {completed.slice(-10).map((g, i) => (
          <span
            key={i}
            className={`game-dot game-dot--${g.result === "W" ? "w" : "l"}`}
            title={`${g.date} vs ${g.opponent}: ${g.result} ${g.runsScored}-${g.runsAllowed}`}
          >
            {g.result}
          </span>
        ))}
      </div>
    </div>
  );
}
