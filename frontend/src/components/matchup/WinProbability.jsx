import { useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWinProbability } from "../../api/client";
import { scaleLinear } from "d3-scale";
import { line, area, curveMonotoneX } from "d3-shape";
import { max, min } from "d3-array";

const WIDTH = 320;
const HEIGHT = 140;
const MARGIN = { top: 12, right: 8, bottom: 24, left: 32 };
const CHART_W = WIDTH - MARGIN.left - MARGIN.right;
const CHART_H = HEIGHT - MARGIN.top - MARGIN.bottom;

export default function WinProbability({ gamePk, teamId, isHome }) {
  const svgRef = useRef(null);

  const { data: wpData } = useQuery({
    queryKey: ["winProb", gamePk],
    queryFn: () => fetchWinProbability(gamePk),
    enabled: !!gamePk,
    staleTime: 1000 * 60,
    refetchInterval: 30000,
  });

  if (!wpData?.length) return null;

  const points = wpData.map((wp, i) => ({
    x: i,
    y: isHome ? wp.homeProb : wp.awayProb,
    leverage: wp.leverage,
    probAdded: wp.probAdded,
  }));

  const currentProb = points[points.length - 1]?.y || 0.5;
  const probPct = Math.round(currentProb * 100);

  // Find biggest swing moment
  let biggestSwingIdx = 0;
  let biggestSwingVal = 0;
  points.forEach((p, i) => {
    const swing = Math.abs(p.probAdded || 0);
    if (swing > biggestSwingVal) {
      biggestSwingVal = swing;
      biggestSwingIdx = i;
    }
  });

  // D3 scales
  const xScale = scaleLinear().domain([0, points.length - 1]).range([0, CHART_W]);
  const yScale = scaleLinear().domain([0, 1]).range([CHART_H, 0]);

  // D3 line generator with smooth curve
  const lineGen = line()
    .x((d) => xScale(d.x))
    .y((d) => yScale(d.y))
    .curve(curveMonotoneX);

  // D3 area generator for fill
  const areaGen = area()
    .x((d) => xScale(d.x))
    .y0(yScale(0.5))
    .y1((d) => yScale(d.y))
    .curve(curveMonotoneX);

  const pathD = lineGen(points);
  const areaD = areaGen(points);

  // Y-axis ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1.0];

  // Biggest swing point
  const swingPt = points[biggestSwingIdx];
  const swingX = xScale(biggestSwingIdx);
  const swingY = yScale(swingPt.y);

  return (
    <div className="matchup-section">
      <h3>Win Probability</h3>
      <div className="wp-header">
        <span className="wp-pct" style={{ color: probPct >= 50 ? "var(--win)" : "var(--loss)" }}>
          {probPct}%
        </span>
        <span className="wp-label">Current win probability</span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="wp-chart"
        role="img"
        aria-label={`Win probability chart, currently ${probPct}%`}
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
          {/* Background gradient */}
          <rect width={CHART_W} height={CHART_H} fill="url(#wpGradient)" rx="4" />

          {/* Grid lines */}
          {yTicks.map((t) => (
            <line
              key={t}
              x1={0} y1={yScale(t)}
              x2={CHART_W} y2={yScale(t)}
              stroke={t === 0.5 ? "#ffffff20" : "#ffffff08"}
              strokeWidth={t === 0.5 ? 1 : 0.5}
              strokeDasharray={t === 0.5 ? "4,3" : "none"}
            />
          ))}

          {/* Y-axis labels */}
          {yTicks.map((t) => (
            <text
              key={`label-${t}`}
              x={-6} y={yScale(t) + 3}
              fill="#9299ad"
              fontSize="8"
              textAnchor="end"
            >
              {Math.round(t * 100)}%
            </text>
          ))}

          {/* Area fill */}
          <path d={areaD} fill="var(--team-secondary)" opacity="0.15" />

          {/* Main line */}
          <path
            d={pathD}
            fill="none"
            stroke="var(--team-secondary)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Biggest swing marker */}
          {biggestSwingVal > 0.05 && (
            <g>
              <circle cx={swingX} cy={swingY} r="4" fill="var(--live)" opacity="0.8" />
              <text
                x={swingX} y={swingY - 8}
                fill="var(--live)"
                fontSize="7"
                textAnchor="middle"
                fontWeight="600"
              >
                {swingPt.probAdded > 0 ? "+" : ""}{Math.round((swingPt.probAdded || 0) * 100)}%
              </text>
            </g>
          )}

          {/* Current value dot */}
          <circle
            cx={xScale(points.length - 1)}
            cy={yScale(currentProb)}
            r="4"
            fill={currentProb >= 0.5 ? "var(--win)" : "var(--loss)"}
            stroke="#fff"
            strokeWidth="1.5"
          />

          {/* X-axis label */}
          <text
            x={CHART_W / 2} y={CHART_H + 18}
            fill="#9299ad"
            fontSize="8"
            textAnchor="middle"
          >
            Game Progress
          </text>
        </g>
      </svg>
    </div>
  );
}
