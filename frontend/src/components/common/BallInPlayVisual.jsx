import FENCE_DIMENSIONS from "../../data/fenceDimensions";

// MLB coordinate system: HP at (125.4, 198.3), 1 coord unit ≈ 2.48 feet
// SVG viewport: 300x260, HP mapped to (150, 240)
const MLB_HP = { x: 125.4, y: 198.3 };
const SVG_HP = { x: 150, y: 240 };
const S = 1.2; // coord-to-SVG scale factor
const FT_PER_COORD = 2.48;

function feetToSVG(angle, feet) {
  const coordDist = feet / FT_PER_COORD;
  const rad = (angle * Math.PI) / 180;
  return {
    x: SVG_HP.x + Math.sin(rad) * coordDist * S,
    y: SVG_HP.y - Math.cos(rad) * coordDist * S,
  };
}

export default function BallInPlayVisual({ hitData, venueId }) {
  if (!hitData) return null;

  // Map MLB hit coordinates to SVG
  const dotX = SVG_HP.x + (hitData.x - MLB_HP.x) * S;
  const dotY = SVG_HP.y + (hitData.y - MLB_HP.y) * S;

  // Color: green for hits, red for outs/HRs
  const event = hitData.event || "";
  const isHit = ["Single", "Double", "Triple", "Home Run"].includes(event);
  const accentColor = isHit ? "#22c55e" : "#ef4444";

  const trajLabel = { fly_ball: "Fly Ball", line_drive: "Line Drive", ground_ball: "Ground Ball", popup: "Popup" }[hitData.trajectory] || "Batted Ball";
  const evLabel = hitData.exitVelo >= 100 ? "Barreled" : hitData.exitVelo >= 95 ? "Hard Hit" : hitData.exitVelo >= 85 ? "Medium" : "Soft";

  // Real fence dimensions for this venue
  const dims = FENCE_DIMENSIONS[venueId] || { LF: 330, LCF: 385, CF: 400, RCF: 385, RF: 330 };

  // Interpolate fence distance at any angle between the 5 known points
  const knownAngles = [-45, -22.5, 0, 22.5, 45];
  const knownDists = [dims.LF, dims.LCF, dims.CF, dims.RCF, dims.RF];
  const fenceDist = (angle) => {
    if (angle <= -45) return dims.LF;
    if (angle >= 45) return dims.RF;
    for (let i = 0; i < 4; i++) {
      if (angle >= knownAngles[i] && angle <= knownAngles[i + 1]) {
        const t = (angle - knownAngles[i]) / (knownAngles[i + 1] - knownAngles[i]);
        return knownDists[i] + t * (knownDists[i + 1] - knownDists[i]);
      }
    }
    return 385;
  };

  // 19 fence points for smooth curve
  const fencePts = [];
  for (let a = -45; a <= 45; a += 5) fencePts.push(feetToSVG(a, fenceDist(a)));
  const fencePath = `M ${fencePts[0].x.toFixed(1)},${fencePts[0].y.toFixed(1)} ` +
    fencePts.slice(1).map((p) => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const lfl = fencePts[0], rfl = fencePts[fencePts.length - 1];
  const cfPt = feetToSVG(0, dims.CF);

  // Infield: 90ft basepaths, precise positions
  const first = feetToSVG(45, 90);
  const second = feetToSVG(0, 90 * Math.SQRT2);
  const third = feetToSVG(-45, 90);
  const dirtR = (95 / FT_PER_COORD) * S;
  const mound = feetToSVG(0, 60.5);

  const uid = `bip${Math.random().toString(36).slice(2, 6)}`;

  return (
    <div className="bip-card">
      <div className="bip-field-wrap">
        <svg viewBox="0 0 300 260" className="bip-field-lg">
          <defs>
            <radialGradient id={`${uid}glow`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={accentColor} stopOpacity="0.5" />
              <stop offset="100%" stopColor={accentColor} stopOpacity="0" />
            </radialGradient>
            <clipPath id={`${uid}clip`}>
              <path d={`${fencePath} L ${SVG_HP.x},${SVG_HP.y} Z`} />
            </clipPath>
          </defs>

          {/* Outfield grass */}
          <path d={`${fencePath} L ${SVG_HP.x},${SVG_HP.y} Z`} fill="rgba(22,80,22,0.25)" />

          {/* Warning track */}
          <path d={fencePath} fill="none" stroke="rgba(139,90,43,0.15)" strokeWidth="8" />

          {/* Infield dirt */}
          <circle cx={SVG_HP.x} cy={SVG_HP.y} r={dirtR} fill="rgba(139,90,43,0.18)" clipPath={`url(#${uid}clip)`} />

          {/* Infield grass cutout */}
          <circle cx={(first.x + third.x) / 2} cy={(first.y + second.y) / 2} r={dirtR * 0.55} fill="rgba(22,80,22,0.2)" />

          {/* Fence line */}
          <path d={fencePath} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

          {/* Fence labels */}
          <text x={lfl.x + 6} y={lfl.y - 5} fill="rgba(255,255,255,0.3)" fontSize="9" fontWeight="600" textAnchor="start">{dims.LF}</text>
          <text x={feetToSVG(-22.5, dims.LCF).x} y={feetToSVG(-22.5, dims.LCF).y - 5} fill="rgba(255,255,255,0.2)" fontSize="8" textAnchor="middle">{dims.LCF}</text>
          <text x={cfPt.x} y={cfPt.y - 7} fill="rgba(255,255,255,0.35)" fontSize="10" fontWeight="700" textAnchor="middle">{dims.CF}</text>
          <text x={feetToSVG(22.5, dims.RCF).x} y={feetToSVG(22.5, dims.RCF).y - 5} fill="rgba(255,255,255,0.2)" fontSize="8" textAnchor="middle">{dims.RCF}</text>
          <text x={rfl.x - 6} y={rfl.y - 5} fill="rgba(255,255,255,0.3)" fontSize="9" fontWeight="600" textAnchor="end">{dims.RF}</text>

          {/* Foul lines */}
          <line x1={SVG_HP.x} y1={SVG_HP.y} x2={lfl.x} y2={lfl.y} stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
          <line x1={SVG_HP.x} y1={SVG_HP.y} x2={rfl.x} y2={rfl.y} stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />

          {/* Base paths */}
          <line x1={SVG_HP.x} y1={SVG_HP.y} x2={first.x} y2={first.y} stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
          <line x1={first.x} y1={first.y} x2={second.x} y2={second.y} stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
          <line x1={second.x} y1={second.y} x2={third.x} y2={third.y} stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
          <line x1={third.x} y1={third.y} x2={SVG_HP.x} y2={SVG_HP.y} stroke="rgba(255,255,255,0.1)" strokeWidth="1" />

          {/* Bases */}
          <rect x={first.x - 4} y={first.y - 4} width="8" height="8" rx="1" transform={`rotate(45 ${first.x} ${first.y})`} fill="rgba(255,255,255,0.35)" />
          <rect x={second.x - 4} y={second.y - 4} width="8" height="8" rx="1" transform={`rotate(45 ${second.x} ${second.y})`} fill="rgba(255,255,255,0.35)" />
          <rect x={third.x - 4} y={third.y - 4} width="8" height="8" rx="1" transform={`rotate(45 ${third.x} ${third.y})`} fill="rgba(255,255,255,0.35)" />

          {/* Home plate */}
          <polygon points={`${SVG_HP.x - 4},${SVG_HP.y} ${SVG_HP.x},${SVG_HP.y - 5} ${SVG_HP.x + 4},${SVG_HP.y} ${SVG_HP.x + 3},${SVG_HP.y + 3} ${SVG_HP.x - 3},${SVG_HP.y + 3}`} fill="rgba(255,255,255,0.4)" />

          {/* Pitcher's mound */}
          <circle cx={mound.x} cy={mound.y} r="4" fill="rgba(139,90,43,0.25)" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
          <rect x={mound.x - 3} y={mound.y - 1} width="6" height="2" rx="0.5" fill="rgba(255,255,255,0.25)" />

          {/* Ball trail */}
          <line x1={SVG_HP.x} y1={SVG_HP.y} x2={dotX} y2={dotY} stroke={accentColor} strokeWidth="1.5" strokeDasharray="5,4" opacity="0.5" />

          {/* Landing glow */}
          <circle cx={dotX} cy={dotY} r="22" fill={`url(#${uid}glow)`} />

          {/* Landing dot */}
          <circle cx={dotX} cy={dotY} r="6" fill={accentColor} />
          <circle cx={dotX} cy={dotY} r="6" fill="none" stroke="#fff" strokeWidth="2" opacity="0.5" />
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
