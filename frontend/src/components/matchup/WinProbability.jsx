import { useQuery } from "@tanstack/react-query";
import { fetchWinProbability } from "../../api/client";
import { scaleLinear } from "d3-scale";
import { line, area, curveMonotoneX } from "d3-shape";

const WIDTH = 340;
const HEIGHT = 160;
const MARGIN = { top: 14, right: 10, bottom: 36, left: 34 };
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

  const rawProb = points[points.length - 1]?.y || 0.5;
  // Detect if game is final (probability at exactly 0 or 1, or very close)
  const isGameOver = rawProb <= 0.01 || rawProb >= 0.99;
  const currentProb = isGameOver ? (rawProb >= 0.5 ? 1 : 0) : rawProb;
  const probPct = isGameOver ? (rawProb >= 0.5 ? 100 : 0) : Math.round(rawProb * 100);
  const opponentPct = 100 - probPct;

  // Determine which team's probability we're showing
  const ourAbbr = isHome ? homeAbbr : awayAbbr;
  const theirAbbr = isHome ? awayAbbr : homeAbbr;
  const ourLogo = isHome ? homeLogo : awayLogo;
  const theirLogo = isHome ? awayLogo : homeLogo;

  // Scales
  const xScale = scaleLinear().domain([0, maxInning]).range([0, CHART_W]);
  const yScale = scaleLinear().domain([0, 1]).range([CHART_H, 0]);

  const lineGen = line().x((d) => xScale(d.x)).y((d) => yScale(d.y)).curve(curveMonotoneX);
  const areaGen = area().x((d) => xScale(d.x)).y0(yScale(0.5)).y1((d) => yScale(d.y)).curve(curveMonotoneX);

  const pathD = lineGen(points);
  const areaD = areaGen(points);
  const yTicks = [0, 0.25, 0.5, 0.75, 1.0];
  const inningTicks = Array.from({ length: maxInning }, (_, i) => i + 1);

  const wpLabel = `Win probability: ${ourAbbr} ${probPct} percent, ${theirAbbr} ${opponentPct} percent.`;

  return (
    <div className="matchup-section">
      <h3>Win Probability</h3>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{wpLabel}</div>
      <div className="wp-header">
        <div className="wp-team-prob">
          {ourLogo && <img src={ourLogo} alt="" className="wp-team-logo" />}
          <span className="wp-pct" style={{ color: probPct >= 50 ? "var(--win)" : "var(--loss)" }} aria-label={`${ourAbbr} ${probPct} percent`}>
            {probPct}%
          </span>
        </div>
        <span className="wp-label" aria-hidden="true">vs</span>
        <div className="wp-team-prob">
          {theirLogo && <img src={theirLogo} alt="" className="wp-team-logo" />}
          <span className="wp-pct" style={{ color: opponentPct >= 50 ? "var(--win)" : "var(--loss)" }} aria-label={`${theirAbbr} ${opponentPct} percent`}>
            {opponentPct}%
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="wp-chart"
        role="img"
        aria-label={wpLabel}
      >
        <title>{wpLabel}</title>
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
            <text key={`y-${t}`} x={-6} y={yScale(t) + 3} fill="#c6ccde" fontSize="10" textAnchor="end">
              {Math.round(t * 100)}%
            </text>
          ))}

          {/* X-axis inning labels */}
          {inningTicks.map((inn) => (
            <text key={`x-${inn}`} x={xScale(inn - 0.5)} y={CHART_H + 16} fill="#c6ccde" fontSize="10" textAnchor="middle">
              {inn}
            </text>
          ))}

          {/* X-axis title */}
          <text x={CHART_W / 2} y={CHART_H + 24} fill="#c6ccde" fontSize="10" textAnchor="middle" fontWeight="500">
            Inning
          </text>

          {/* Area fill */}
          <path d={areaD} fill="var(--team-secondary)" opacity="0.15" />

          {/* Main line */}
          <path d={pathD} fill="none" stroke="var(--team-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

          {/* Current value dot — hidden when game is over */}
          {!isGameOver && (
            <circle
              cx={xScale(points[points.length - 1].x)}
              cy={yScale(currentProb)}
              r="4"
              fill={currentProb >= 0.5 ? "var(--win)" : "var(--loss)"}
              stroke="#fff"
              strokeWidth="1.5"
            />
          )}
        </g>
      </svg>
    </div>
  );
}
