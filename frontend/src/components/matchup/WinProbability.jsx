import { useQuery } from "@tanstack/react-query";
import { fetchWinProbability } from "../../api/client";
import { scaleLinear } from "d3-scale";
import { line, area, curveMonotoneX } from "d3-shape";

const WIDTH = 340;
const HEIGHT = 160;
const MARGIN = { top: 14, right: 10, bottom: 28, left: 34 };
const CHART_W = WIDTH - MARGIN.left - MARGIN.right;
const CHART_H = HEIGHT - MARGIN.top - MARGIN.bottom;

export default function WinProbability({ gamePk, teamId, isHome, awayAbbr, homeAbbr, awayLogo, homeLogo }) {
  const { data: wpData } = useQuery({
    queryKey: ["winProb", gamePk],
    queryFn: () => fetchWinProbability(gamePk),
    enabled: !!gamePk,
    staleTime: 1000 * 60,
    refetchInterval: 30000,
  });

  if (!wpData?.length) return null;

  // Map points with inning-based X position
  // Each at-bat gets a fractional inning position: inning + (index within that half-inning / total in that half)
  const maxInning = Math.max(...wpData.map((wp) => wp.inning), 9);
  const points = wpData.map((wp, i) => {
    const halfOffset = wp.halfInning === "bottom" ? 0.5 : 0;
    // Approximate position within the inning
    const sameHalf = wpData.filter((w) => w.inning === wp.inning && w.halfInning === wp.halfInning);
    const idxInHalf = sameHalf.indexOf(wp);
    const fracInHalf = sameHalf.length > 1 ? (idxInHalf / (sameHalf.length - 1)) * 0.45 : 0.2;
    return {
      x: wp.inning - 1 + halfOffset + fracInHalf,
      y: isHome ? wp.homeProb : wp.awayProb,
      probAdded: wp.probAdded,
    };
  });

  const currentProb = points[points.length - 1]?.y || 0.5;
  const probPct = Math.round(currentProb * 100);
  const opponentPct = 100 - probPct;

  // Determine which team's probability we're showing
  const ourAbbr = isHome ? homeAbbr : awayAbbr;
  const theirAbbr = isHome ? awayAbbr : homeAbbr;
  const ourLogo = isHome ? homeLogo : awayLogo;
  const theirLogo = isHome ? awayLogo : homeLogo;

  // Find biggest swing
  let biggestSwingIdx = 0;
  let biggestSwingVal = 0;
  points.forEach((p, i) => {
    const swing = Math.abs(p.probAdded || 0);
    if (swing > biggestSwingVal) {
      biggestSwingVal = swing;
      biggestSwingIdx = i;
    }
  });

  // Scales
  const xScale = scaleLinear().domain([0, maxInning]).range([0, CHART_W]);
  const yScale = scaleLinear().domain([0, 1]).range([CHART_H, 0]);

  const lineGen = line().x((d) => xScale(d.x)).y((d) => yScale(d.y)).curve(curveMonotoneX);
  const areaGen = area().x((d) => xScale(d.x)).y0(yScale(0.5)).y1((d) => yScale(d.y)).curve(curveMonotoneX);

  const pathD = lineGen(points);
  const areaD = areaGen(points);
  const yTicks = [0, 0.25, 0.5, 0.75, 1.0];
  const inningTicks = Array.from({ length: maxInning }, (_, i) => i + 1);

  const swingPt = points[biggestSwingIdx];
  const swingX = xScale(swingPt.x);
  const swingY = yScale(swingPt.y);

  return (
    <div className="matchup-section">
      <h3>Win Probability</h3>
      <div className="wp-header">
        <div className="wp-team-prob">
          {ourLogo && <img src={ourLogo} alt={ourAbbr} className="wp-team-logo" />}
          <span className="wp-pct" style={{ color: probPct >= 50 ? "var(--win)" : "var(--loss)" }}>
            {probPct}%
          </span>
        </div>
        <span className="wp-label">vs</span>
        <div className="wp-team-prob">
          {theirLogo && <img src={theirLogo} alt={theirAbbr} className="wp-team-logo" />}
          <span className="wp-pct" style={{ color: opponentPct >= 50 ? "var(--win)" : "var(--loss)" }}>
            {opponentPct}%
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="wp-chart"
        role="img"
        aria-label={`Win probability chart, ${ourAbbr} ${probPct}% vs ${theirAbbr} ${opponentPct}%`}
      >
        <defs>
          <linearGradient id="wpGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--win)" stopOpacity="0.3" />
            <stop offset="50%" stopColor="var(--win)" stopOpacity="0.05" />
            <stop offset="50%" stopColor="var(--loss)" stopOpacity="0.05" />
            <stop offset="100%" stopColor="var(--loss)" stopOpacity="0.3" />
          </linearGradient>
        </defs>

        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          <rect width={CHART_W} height={CHART_H} fill="url(#wpGradient)" rx="4" />

          {/* Grid lines */}
          {yTicks.map((t) => (
            <line key={t} x1={0} y1={yScale(t)} x2={CHART_W} y2={yScale(t)}
              stroke={t === 0.5 ? "#ffffff20" : "#ffffff08"}
              strokeWidth={t === 0.5 ? 1 : 0.5}
              strokeDasharray={t === 0.5 ? "4,3" : "none"} />
          ))}

          {/* Inning grid lines */}
          {inningTicks.map((inn) => (
            <line key={`inn-${inn}`} x1={xScale(inn - 0.5)} y1={0} x2={xScale(inn - 0.5)} y2={CHART_H}
              stroke="#ffffff06" strokeWidth="0.5" />
          ))}

          {/* Y-axis labels */}
          {yTicks.map((t) => (
            <text key={`y-${t}`} x={-6} y={yScale(t) + 3} fill="#9299ad" fontSize="8" textAnchor="end">
              {Math.round(t * 100)}%
            </text>
          ))}

          {/* X-axis inning labels */}
          {inningTicks.map((inn) => (
            <text key={`x-${inn}`} x={xScale(inn - 0.5)} y={CHART_H + 16} fill="#9299ad" fontSize="8" textAnchor="middle">
              {inn}
            </text>
          ))}

          {/* Area fill */}
          <path d={areaD} fill="var(--team-secondary)" opacity="0.15" />

          {/* Main line */}
          <path d={pathD} fill="none" stroke="var(--team-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

          {/* Biggest swing marker */}
          {biggestSwingVal > 0.05 && (
            <g>
              <circle cx={swingX} cy={swingY} r="4" fill="var(--live)" opacity="0.8" />
              <text x={swingX} y={swingY - 8} fill="var(--live)" fontSize="7" textAnchor="middle" fontWeight="600">
                {swingPt.probAdded > 0 ? "+" : ""}{Math.round((swingPt.probAdded || 0) * 100)}%
              </text>
            </g>
          )}

          {/* Current value dot */}
          <circle
            cx={xScale(points[points.length - 1].x)}
            cy={yScale(currentProb)}
            r="4"
            fill={currentProb >= 0.5 ? "var(--win)" : "var(--loss)"}
            stroke="#fff"
            strokeWidth="1.5"
          />
        </g>
      </svg>
    </div>
  );
}
