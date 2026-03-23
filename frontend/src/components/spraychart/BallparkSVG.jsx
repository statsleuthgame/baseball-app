/**
 * SVG Ballpark outline that renders any park from its outfield dimensions.
 *
 * Coordinate system:
 *  - Home plate is at (125, 200) in the viewBox
 *  - The SVG viewBox is "0 0 250 250"
 *  - Statcast coords are transformed server-side: x = hc_x - 125.42, y = 198.27 - hc_y
 *  - To plot in SVG: svgX = x + 125,  svgY = 200 - y
 */

const SCALE = 0.40; // SVG units per foot (calibrated to Statcast hc_x/hc_y coordinate system)
const HP_X = 125;   // Home plate X in viewBox
const HP_Y = 200;   // Home plate Y in viewBox

function ftToSvg(distFt, angleDeg) {
  const r = distFt * SCALE;
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: HP_X + r * Math.sin(rad),
    y: HP_Y - r * Math.cos(rad),
  };
}

function buildWallFromDimensions(dims) {
  // dims = { LF, LCF, CF, RCF, RF }
  // Interpolate wall points from LF foul line (-45°) to RF foul line (+45°)
  const points = [
    [-45, dims.LF],
    [-35, dims.LF + (dims.LCF - dims.LF) * 0.45],
    [-22, dims.LCF],
    [-12, dims.LCF + (dims.CF - dims.LCF) * 0.55],
    [0, dims.CF],
    [12, dims.CF - (dims.CF - dims.RCF) * 0.55],
    [22, dims.RCF],
    [35, dims.RCF - (dims.RCF - dims.RF) * 0.45],
    [45, dims.RF],
  ];

  return points.map(([angle, dist]) => ftToSvg(dist, angle));
}

export default function BallparkSVG({ dimensions, parkName, children }) {
  const defaultDims = { LF: 330, LCF: 375, CF: 400, RCF: 375, RF: 330 };
  const dims = dimensions || defaultDims;
  const wallPoints = buildWallFromDimensions(dims);

  const wallPath = wallPoints
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(" ");

  // Foul lines
  const lfPole = wallPoints[0];
  const rfPole = wallPoints[wallPoints.length - 1];

  // Base positions
  const first = ftToSvg(90, 45);
  const second = ftToSvg(127.28, 0);
  const third = ftToSvg(90, -45);

  // Infield dirt arc
  const infieldRadius = 95 * SCALE;

  return (
    <svg
      viewBox="0 0 250 250"
      className="ballpark-svg"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Background */}
      <rect width="250" height="250" fill="#0d1117" rx="8" />

      {/* Outfield grass */}
      <path
        d={`${wallPath} L ${HP_X} ${HP_Y} Z`}
        fill="#1a3a1a"
        opacity="0.4"
      />

      {/* Outfield wall */}
      <path
        d={wallPath}
        fill="none"
        stroke="#4a6741"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* Dimension labels on wall */}
      {[
        { angle: -45, dist: dims.LF, label: dims.LF },
        { angle: 0, dist: dims.CF, label: dims.CF },
        { angle: 45, dist: dims.RF, label: dims.RF },
      ].map(({ angle, dist, label }) => {
        const pos = ftToSvg(dist + 12, angle);
        return (
          <text
            key={angle}
            x={pos.x}
            y={pos.y}
            textAnchor="middle"
            fill="#4a6741"
            fontSize="5.5"
            fontWeight="600"
          >
            {label}'
          </text>
        );
      })}

      {/* Foul lines */}
      <line
        x1={HP_X} y1={HP_Y}
        x2={lfPole.x} y2={lfPole.y}
        stroke="#4a6741"
        strokeWidth="0.5"
        strokeDasharray="3,2"
      />
      <line
        x1={HP_X} y1={HP_Y}
        x2={rfPole.x} y2={rfPole.y}
        stroke="#4a6741"
        strokeWidth="0.5"
        strokeDasharray="3,2"
      />

      {/* Infield dirt arc */}
      <path
        d={`M ${third.x} ${third.y} A ${infieldRadius} ${infieldRadius} 0 0 1 ${first.x} ${first.y}`}
        fill="none"
        stroke="#5a4a3a"
        strokeWidth="0.8"
      />

      {/* Base paths */}
      <polygon
        points={`${HP_X},${HP_Y} ${first.x},${first.y} ${second.x},${second.y} ${third.x},${third.y}`}
        fill="none"
        stroke="#5a4a3a"
        strokeWidth="0.6"
      />

      {/* Bases */}
      <rect x={first.x - 2} y={first.y - 2} width="4" height="4" fill="#f0e6d3" transform={`rotate(45 ${first.x} ${first.y})`} />
      <rect x={second.x - 2} y={second.y - 2} width="4" height="4" fill="#f0e6d3" transform={`rotate(45 ${second.x} ${second.y})`} />
      <rect x={third.x - 2} y={third.y - 2} width="4" height="4" fill="#f0e6d3" transform={`rotate(45 ${third.x} ${third.y})`} />

      {/* Home plate */}
      <polygon
        points={`${HP_X},${HP_Y + 2} ${HP_X - 2.5},${HP_Y} ${HP_X - 1.5},${HP_Y - 2} ${HP_X + 1.5},${HP_Y - 2} ${HP_X + 2.5},${HP_Y}`}
        fill="#f0e6d3"
      />

      {/* Pitcher's mound */}
      <circle cx={HP_X} cy={HP_Y - 60.5 * SCALE} r="2" fill="#5a4a3a" stroke="#6a5a4a" strokeWidth="0.4" />

      {/* Park name label */}
      <text x="125" y="16" textAnchor="middle" fill="#4a6741" fontSize="7" fontWeight="600">
        {parkName || "Ballpark"}
      </text>

      {/* Hit dots rendered as children */}
      {children}
    </svg>
  );
}

// Export constants for coordinate transformation in other components
export const SPRAY_HP_X = HP_X;
export const SPRAY_HP_Y = HP_Y;
