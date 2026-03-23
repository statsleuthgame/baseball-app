import { useQuery } from "@tanstack/react-query";
import { fetchWinProbability } from "../../api/client";

export default function WinProbability({ gamePk, teamId, isHome }) {
  const { data: wpData } = useQuery({
    queryKey: ["winProb", gamePk],
    queryFn: () => fetchWinProbability(gamePk),
    enabled: !!gamePk,
    staleTime: 1000 * 60,
    refetchInterval: 30000,
  });

  if (!wpData?.length) return null;

  // Get our team's probability at each point
  const points = wpData.map((wp, i) => {
    const prob = isHome ? wp.homeProb : wp.awayProb;
    return { x: i, y: prob, leverage: wp.leverage };
  });

  const width = 300;
  const height = 120;
  const padX = 0;
  const padY = 10;
  const chartW = width - padX * 2;
  const chartH = height - padY * 2;

  const maxX = points.length - 1 || 1;
  const toSvg = (p) => ({
    x: padX + (p.x / maxX) * chartW,
    y: padY + (1 - p.y) * chartH,
  });

  const pathD = points.map((p, i) => {
    const { x, y } = toSvg(p);
    return `${i === 0 ? "M" : "L"} ${x} ${y}`;
  }).join(" ");

  // Fill area
  const first = toSvg(points[0]);
  const last = toSvg(points[points.length - 1]);
  const fillD = `${pathD} L ${last.x} ${padY + chartH} L ${first.x} ${padY + chartH} Z`;

  const currentProb = points[points.length - 1]?.y || 0.5;
  const probPct = Math.round(currentProb * 100);

  // Find biggest swing
  let biggestSwing = null;
  let biggestSwingVal = 0;
  for (const wp of wpData) {
    if (Math.abs(wp.probAdded || 0) > biggestSwingVal) {
      biggestSwingVal = Math.abs(wp.probAdded);
      biggestSwing = wp;
    }
  }

  return (
    <div className="matchup-section">
      <h3>Win Probability</h3>
      <div className="wp-header">
        <span className="wp-pct" style={{ color: probPct >= 50 ? "var(--win)" : "var(--loss)" }}>
          {probPct}%
        </span>
        <span className="wp-label">Current win probability</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="wp-chart" role="img" aria-label={`Win probability chart, currently ${probPct}%`}>
        {/* 50% line */}
        <line x1={padX} y1={padY + chartH / 2} x2={padX + chartW} y2={padY + chartH / 2}
          stroke="#1e2a3e" strokeWidth="0.5" strokeDasharray="3,3" />
        {/* Fill */}
        <path d={fillD} fill="var(--team-secondary)" opacity="0.15" />
        {/* Line */}
        <path d={pathD} fill="none" stroke="var(--team-secondary)" strokeWidth="1.5" />
        {/* Current dot */}
        <circle cx={last.x} cy={last.y} r="3" fill="var(--team-secondary)" />
        {/* Labels */}
        <text x={padX + 2} y={padY + 5} fill="#9299ad" fontSize="7">100%</text>
        <text x={padX + 2} y={padY + chartH / 2 + 3} fill="#9299ad" fontSize="7">50%</text>
        <text x={padX + 2} y={padY + chartH - 1} fill="#9299ad" fontSize="7">0%</text>
      </svg>
    </div>
  );
}
