/**
 * SVG Ballpark using real MLBAM stadium path data from GeomMLBStadiums.
 *
 * Coordinate system: raw MLBAM pixel grid
 *  - Home plate at (125.42, 198.27)
 *  - Y increases downward (screen convention)
 *  - Scale: ~2.495671 feet per unit
 */
import stadiumPaths from "../../data/stadiumPaths.json";

const HP = { x: 125.42, y: 198.27 };

// Map team abbreviation to team ID for stadium path lookup
const ABBR_TO_ID = {
  AZ: "109", ATL: "144", BAL: "110", BOS: "111", CHC: "112", CWS: "145",
  CIN: "113", CLE: "114", COL: "115", DET: "116", HOU: "117", KC: "118",
  LAA: "108", LAD: "119", MIA: "146", MIL: "158", MIN: "142", NYM: "121",
  NYY: "147", ATH: "133", PHI: "143", PIT: "134", SD: "135", SF: "137",
  SEA: "136", STL: "138", TB: "139", TEX: "140", TOR: "141", WSH: "120",
};

function pathFromPoints(pts) {
  if (!pts?.length) return "";
  return `M ${pts[0][0]},${pts[0][1]} ` + pts.slice(1).map((p) => `L ${p[0]},${p[1]}`).join(" ");
}

export default function BallparkSVG({ parkAbbr, parkName, hits, children }) {
  const teamId = ABBR_TO_ID[parkAbbr] || "136";
  const stadium = stadiumPaths[teamId];

  const fencePath = stadium ? pathFromPoints(stadium.outfield_outer) : "";
  const warningPath = stadium ? pathFromPoints(stadium.outfield_inner) : "";
  const infieldInner = stadium ? pathFromPoints(stadium.infield_inner) : "";
  const infieldOuter = stadium ? pathFromPoints(stadium.infield_outer) : "";
  const foulLines = stadium ? pathFromPoints(stadium.foul_lines) : "";

  // Compute viewBox — include all hit dots so nothing gets clipped
  const hitPts = (hits || []).map((h) => [h.x + HP.x, HP.y - h.y]);
  const allPts = [
    ...(stadium?.outfield_outer || []),
    ...(stadium?.foul_lines || []),
    ...hitPts,
    [HP.x, HP.y],
  ];
  const xs = allPts.map((p) => p[0]);
  const ys = allPts.map((p) => p[1]);
  const minX = Math.min(...xs) - 15;
  const maxX = Math.max(...xs) + 15;
  const minY = Math.min(...ys) - 15;
  const maxY = HP.y + 12;
  const vw = maxX - minX;
  const vh = maxY - minY;

  // Base positions: 90ft = 36.06 units from HP
  const bd = 36.06;
  const first = { x: HP.x + bd * 0.707, y: HP.y - bd * 0.707 };
  const second = { x: HP.x, y: HP.y - bd * 1.414 };
  const third = { x: HP.x - bd * 0.707, y: HP.y - bd * 0.707 };

  const hitsCount = hits?.length ?? 0;
  const countsByResult = (hits || []).reduce((acc, h) => {
    acc[h.result] = (acc[h.result] || 0) + 1;
    return acc;
  }, {});
  const countsText = ["single", "double", "triple", "home_run", "out"]
    .filter((k) => countsByResult[k])
    .map((k) => `${countsByResult[k]} ${k.replace("_", " ")}${countsByResult[k] > 1 ? "s" : ""}`)
    .join(", ");
  const chartLabel = `Spray chart at ${parkName || "ballpark"}: ${hitsCount} ${hitsCount === 1 ? "hit" : "hits"} plotted${countsText ? ". " + countsText : ""}`;

  return (
    <svg
      viewBox={`${minX} ${minY} ${vw} ${vh}`}
      className="ballpark-svg"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={chartLabel}
    >
      <title>{chartLabel}</title>
      <desc>
        Batted ball locations on the {parkName || "ballpark"} field, color-coded by outcome. Each dot is keyboard-focusable and opens a detail readout.
      </desc>
      {/* Background */}
      <rect x={minX} y={minY} width={vw} height={vh} fill="#0d1117" rx="8" />

      {/* Outfield grass */}
      {fencePath && (
        <path d={`${fencePath} L ${HP.x},${HP.y} Z`} fill="#1a3a1a" opacity="0.4" />
      )}

      {/* Warning track */}
      {warningPath && (
        <path d={warningPath} fill="none" stroke="rgba(90,74,58,0.3)" strokeWidth="2" />
      )}

      {/* Infield dirt */}
      {infieldOuter && (
        <path d={`${infieldOuter} Z`} fill="rgba(90,74,58,0.25)" />
      )}

      {/* Infield grass */}
      {infieldInner && (
        <path d={`${infieldInner} Z`} fill="#1a3a1a" opacity="0.35" />
      )}

      {/* Fence line */}
      {fencePath && (
        <path d={fencePath} fill="none" stroke="#4a6741" strokeWidth="1.5" strokeLinejoin="round" />
      )}

      {/* Foul lines */}
      {foulLines && (
        <path d={foulLines} fill="none" stroke="#4a6741" strokeWidth="0.5" strokeDasharray="3,2" />
      )}

      {/* Base paths */}
      <polygon
        points={`${HP.x},${HP.y} ${first.x},${first.y} ${second.x},${second.y} ${third.x},${third.y}`}
        fill="none" stroke="#5a4a3a" strokeWidth="0.6"
      />

      {/* Bases */}
      <rect x={first.x - 2} y={first.y - 2} width="4" height="4" fill="#f0e6d3" transform={`rotate(45 ${first.x} ${first.y})`} />
      <rect x={second.x - 2} y={second.y - 2} width="4" height="4" fill="#f0e6d3" transform={`rotate(45 ${second.x} ${second.y})`} />
      <rect x={third.x - 2} y={third.y - 2} width="4" height="4" fill="#f0e6d3" transform={`rotate(45 ${third.x} ${third.y})`} />

      {/* Home plate */}
      <polygon
        points={`${HP.x},${HP.y + 2} ${HP.x - 2.5},${HP.y} ${HP.x - 1.5},${HP.y - 2} ${HP.x + 1.5},${HP.y - 2} ${HP.x + 2.5},${HP.y}`}
        fill="#f0e6d3"
      />

      {/* Pitcher's mound */}
      <circle cx={HP.x} cy={HP.y - 24.24} r="2" fill="#5a4a3a" stroke="#6a5a4a" strokeWidth="0.4" />

      {/* Park name */}
      <text x={(minX + maxX) / 2} y={minY + 12} textAnchor="middle" fill="#4a6741" fontSize="6" fontWeight="600">
        {parkName || "Ballpark"}
      </text>

      {/* Hit dots rendered as children */}
      {children}
    </svg>
  );
}

// Export HP constants for HitDots coordinate conversion
export const SPRAY_HP_X = HP.x;
export const SPRAY_HP_Y = HP.y;
