import stadiumPaths from "../../data/stadiumPaths.json";

// MLBAM coordinate system constants (from GeomMLBStadiums / community consensus)
const HP = { x: 125.42, y: 198.27 };

// Map home team ID to stadium paths team ID
// (stadiumPaths is keyed by team ID as string)
function getStadiumData(teamId) {
  return stadiumPaths[String(teamId)] || null;
}

// Convert MLBAM coords to SVG coords
// SVG viewBox: 0 0 250 250 — we use raw MLBAM coords directly
// Just flip Y so the field opens upward
function toSVG(x, y) {
  return { x, y };
}

function pathFromPoints(pts) {
  if (!pts?.length) return "";
  return `M ${pts[0][0]},${pts[0][1]} ` + pts.slice(1).map((p) => `L ${p[0]},${p[1]}`).join(" ");
}

export default function BallInPlayVisual({ hitData, venueTeamId }) {
  if (!hitData) return null;

  const stadium = getStadiumData(venueTeamId);

  // Hit dot is already in MLBAM coords
  const dotX = hitData.x;
  const dotY = hitData.y;

  // Color: green for hits, red for outs
  const event = hitData.event || "";
  const isHit = ["Single", "Double", "Triple", "Home Run"].includes(event);
  const accentColor = isHit ? "#22c55e" : "#ef4444";

  const trajLabel = { fly_ball: "Fly Ball", line_drive: "Line Drive", ground_ball: "Ground Ball", popup: "Popup" }[hitData.trajectory] || "Batted Ball";
  const evLabel = hitData.exitVelo >= 100 ? "Barreled" : hitData.exitVelo >= 95 ? "Hard Hit" : hitData.exitVelo >= 85 ? "Medium" : "Soft";

  // Build SVG paths from stadium data
  const fencePath = stadium ? pathFromPoints(stadium.outfield_outer) : "";
  const warningPath = stadium ? pathFromPoints(stadium.outfield_inner) : "";
  const infieldInner = stadium ? pathFromPoints(stadium.infield_inner) : "";
  const infieldOuter = stadium ? pathFromPoints(stadium.infield_outer) : "";
  const foulLines = stadium ? pathFromPoints(stadium.foul_lines) : "";

  // Compute viewBox to fit the field — pad around the data
  const allPts = [
    ...(stadium?.outfield_outer || []),
    ...(stadium?.foul_lines || []),
    [HP.x, HP.y],
    [dotX, dotY],
  ];
  const xs = allPts.map((p) => p[0]);
  const ys = allPts.map((p) => p[1]);
  const minX = Math.min(...xs) - 10;
  const maxX = Math.max(...xs) + 10;
  const minY = Math.min(...ys) - 15;
  const maxY = Math.max(...ys) + 10;
  const vw = maxX - minX;
  const vh = maxY - minY;

  const uid = `bip${Math.random().toString(36).slice(2, 6)}`;

  return (
    <div className="bip-card">
      <div className="bip-field-wrap">
        <svg viewBox={`${minX} ${minY} ${vw} ${vh}`} className="bip-field-lg" preserveAspectRatio="xMidYMid meet">
          <defs>
            <radialGradient id={`${uid}glow`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={accentColor} stopOpacity="0.5" />
              <stop offset="100%" stopColor={accentColor} stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Outfield grass — fill the fence area */}
          {fencePath && (
            <path d={`${fencePath} L ${HP.x},${HP.y} Z`} fill="rgba(22,80,22,0.25)" />
          )}

          {/* Warning track area between outer and inner outfield */}
          {warningPath && (
            <path d={warningPath} fill="none" stroke="rgba(139,90,43,0.12)" strokeWidth="3" />
          )}

          {/* Infield dirt */}
          {infieldOuter && (
            <path d={`${infieldOuter} Z`} fill="rgba(139,90,43,0.18)" />
          )}

          {/* Infield grass cutout */}
          {infieldInner && (
            <path d={`${infieldInner} Z`} fill="rgba(22,80,22,0.2)" />
          )}

          {/* Fence line */}
          {fencePath && (
            <path d={fencePath} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          )}

          {/* Foul lines */}
          {foulLines && (
            <path d={foulLines} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" />
          )}

          {/* Base paths — 90ft square, exact positions from HP */}
          {/* 1B at ~(150.8, 172.6), 2B at (125.42, 147.04), 3B at (100.04, 172.6) in MLBAM coords */}
          <line x1={HP.x} y1={HP.y} x2={HP.x + 25.6} y2={HP.y - 25.6} stroke="rgba(255,255,255,0.1)" strokeWidth="0.6" />
          <line x1={HP.x + 25.6} y1={HP.y - 25.6} x2={HP.x} y2={HP.y - 51.2} stroke="rgba(255,255,255,0.1)" strokeWidth="0.6" />
          <line x1={HP.x} y1={HP.y - 51.2} x2={HP.x - 25.6} y2={HP.y - 25.6} stroke="rgba(255,255,255,0.1)" strokeWidth="0.6" />
          <line x1={HP.x - 25.6} y1={HP.y - 25.6} x2={HP.x} y2={HP.y} stroke="rgba(255,255,255,0.1)" strokeWidth="0.6" />

          {/* Bases (90ft / 2.495671 = 36.06 units, diagonal = 51.0) */}
          <rect x={HP.x + 25.6 - 2.5} y={HP.y - 25.6 - 2.5} width="5" height="5" rx="0.5" transform={`rotate(45 ${HP.x + 25.6} ${HP.y - 25.6})`} fill="rgba(255,255,255,0.4)" />
          <rect x={HP.x - 2.5} y={HP.y - 51.2 - 2.5} width="5" height="5" rx="0.5" transform={`rotate(45 ${HP.x} ${HP.y - 51.2})`} fill="rgba(255,255,255,0.4)" />
          <rect x={HP.x - 25.6 - 2.5} y={HP.y - 25.6 - 2.5} width="5" height="5" rx="0.5" transform={`rotate(45 ${HP.x - 25.6} ${HP.y - 25.6})`} fill="rgba(255,255,255,0.4)" />

          {/* Home plate */}
          <polygon points={`${HP.x - 2},${HP.y} ${HP.x},${HP.y - 2.5} ${HP.x + 2},${HP.y} ${HP.x + 1.5},${HP.y + 1.5} ${HP.x - 1.5},${HP.y + 1.5}`} fill="rgba(255,255,255,0.5)" />

          {/* Pitcher's mound (60.5ft = 24.24 units from HP) */}
          <circle cx={HP.x} cy={HP.y - 24.24} r="2.5" fill="rgba(139,90,43,0.2)" stroke="rgba(255,255,255,0.1)" strokeWidth="0.3" />
          <rect x={HP.x - 1.5} y={HP.y - 24.24 - 0.5} width="3" height="1" rx="0.3" fill="rgba(255,255,255,0.3)" />

          {/* Ball trail */}
          <line x1={HP.x} y1={HP.y} x2={dotX} y2={dotY} stroke={accentColor} strokeWidth="1" strokeDasharray="3,3" opacity="0.5" />

          {/* Landing glow */}
          <circle cx={dotX} cy={dotY} r="12" fill={`url(#${uid}glow)`} />

          {/* Landing dot */}
          <circle cx={dotX} cy={dotY} r="3.5" fill={accentColor} />
          <circle cx={dotX} cy={dotY} r="3.5" fill="none" stroke="#fff" strokeWidth="1.2" opacity="0.5" />
        </svg>
      </div>
      <div className="bip-metrics">
        <div className="bip-metric-main">
          {hitData.exitVelo && (
            <div className="bip-metric-big">
              <span className="bip-metric-val" style={{ color: accentColor }}>{hitData.exitVelo}</span>
              <span className="bip-metric-unit">mph exit velo</span>
            </div>
          )}
          {hitData.distance && (
            <div className="bip-metric-big">
              <span className="bip-metric-val" style={{ color: accentColor }}>{hitData.distance}</span>
              <span className="bip-metric-unit">ft distance</span>
            </div>
          )}
        </div>
        <div className="bip-metric-row">
          <span className="bip-tag" style={{ borderColor: accentColor, color: accentColor }}>{trajLabel}</span>
          {hitData.launchAngle != null && <span className="bip-metric-sm">{hitData.launchAngle}° launch</span>}
          <span className="bip-metric-sm">{evLabel}</span>
        </div>
      </div>
    </div>
  );
}
