/**
 * SVG Ballpark outlines for T-Mobile Park (SEA) and Truist Park (ATL).
 *
 * Coordinate system:
 *  - Home plate is at (125, 200) in the viewBox
 *  - The SVG viewBox is "0 0 250 250"
 *  - Statcast coords are transformed server-side: x = hc_x - 125.42, y = 198.27 - hc_y
 *  - To plot in SVG: svgX = x + 125,  svgY = 200 - y
 *
 * Outfield wall dimensions (in feet from home plate):
 *  T-Mobile Park:  LF 331, LCF 378, CF 405, RCF 381, RF 326
 *  Truist Park:    LF 335, LCF 385, CF 400, RCF 375, RF 325
 *
 * We scale ~1.8 ft per SVG unit to fit the viewBox.
 */

const SCALE = 0.44; // SVG units per foot (tuned to fill viewBox nicely)
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

function buildWallPath(distances) {
  // distances is an array of [angleDeg, distanceFt] pairs from LF foul line to RF foul line
  const points = distances.map(([angle, dist]) => ftToSvg(dist, angle));
  const path = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");
  return path;
}

// T-Mobile Park wall points: angle from center (neg=left, pos=right), distance in feet
const TMOBILE_WALL = [
  [-45, 331],  // LF foul pole
  [-38, 345],
  [-30, 362],
  [-22, 378],  // LCF
  [-15, 390],
  [-8, 400],
  [0, 405],    // CF
  [8, 398],
  [15, 390],
  [22, 381],   // RCF
  [30, 358],
  [38, 340],
  [45, 326],   // RF foul pole
];

const TRUIST_WALL = [
  [-45, 335],  // LF foul pole
  [-38, 350],
  [-30, 370],
  [-22, 385],  // LCF
  [-15, 393],
  [-8, 398],
  [0, 400],    // CF
  [8, 395],
  [15, 388],
  [22, 375],   // RCF
  [30, 352],
  [38, 338],
  [45, 325],   // RF foul pole
];

const PARKS = {
  680: { name: "T-Mobile Park", wall: TMOBILE_WALL },
  4705: { name: "Truist Park", wall: TRUIST_WALL },
};

export default function BallparkSVG({ venueId = 680, children }) {
  const park = PARKS[venueId] || PARKS[680];
  const wallPath = buildWallPath(park.wall);

  // Foul lines from home plate to foul poles
  const lfPole = ftToSvg(park.wall[0][1], park.wall[0][0]);
  const rfPole = ftToSvg(park.wall[park.wall.length - 1][1], park.wall[park.wall.length - 1][0]);

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
        {park.name}
      </text>

      {/* Hit dots rendered as children */}
      {children}
    </svg>
  );
}

// Export constants for coordinate transformation in other components
export const SPRAY_HP_X = HP_X;
export const SPRAY_HP_Y = HP_Y;
