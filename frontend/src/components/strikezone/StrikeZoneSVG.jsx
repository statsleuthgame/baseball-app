import { scaleLinear } from "d3-scale";

// Strike zone coordinate system:
// plate_x: -2 to 2 feet (0 = center of plate)
// plate_z: 0 to 5 feet (vertical height)
const VIEW_W = 200;
const VIEW_H = 240;
const PADDING = 30;

// D3 scales mapping feet to SVG coords
export const xScale = scaleLinear().domain([-2, 2]).range([PADDING, VIEW_W - PADDING]);
export const yScale = scaleLinear().domain([0, 5]).range([VIEW_H - PADDING, PADDING]);

// Plate half-width in feet (17" plate + ball radius)
export const PLATE_HW = 0.83;

export default function StrikeZoneSVG({ szTop = 3.5, szBot = 1.5, squeezedCount, giftedCount, children }) {
  const zoneLeft = xScale(-PLATE_HW);
  const zoneRight = xScale(PLATE_HW);
  const zoneTop = yScale(szTop);
  const zoneBottom = yScale(szBot);
  const zoneW = zoneRight - zoneLeft;
  const zoneH = zoneBottom - zoneTop;

  // 3x3 grid lines
  const thirdW = zoneW / 3;
  const thirdH = zoneH / 3;

  // Home plate pentagon
  const plateCx = xScale(0);
  const plateY = yScale(0) + 8;
  const pw = 12;

  const parts = [];
  if (squeezedCount != null) parts.push(`${squeezedCount} squeezed`);
  if (giftedCount != null) parts.push(`${giftedCount} gifted`);
  const countsText = parts.length ? `: ${parts.join(", ")}` : "";

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="strike-zone-svg"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Strike zone missed calls${countsText}`}
    >
      <title>Strike zone missed calls{countsText}</title>
      <desc>
        Strike-zone plot showing pitch locations where the umpire made a missed call. Triangles are squeezed (ball called on a pitch in the zone). Circles are gifted (strike called on a pitch out of the zone). Each dot is keyboard focusable.
      </desc>
      <rect width={VIEW_W} height={VIEW_H} fill="#0d1117" rx="8" />

      {/* Strike zone rectangle */}
      <rect
        x={zoneLeft} y={zoneTop}
        width={zoneW} height={zoneH}
        fill="none"
        stroke="rgba(255,255,255,0.25)"
        strokeWidth="1"
      />

      {/* 3x3 grid */}
      {[1, 2].map((i) => (
        <g key={`grid-${i}`}>
          <line
            x1={zoneLeft + thirdW * i} y1={zoneTop}
            x2={zoneLeft + thirdW * i} y2={zoneBottom}
            stroke="rgba(255,255,255,0.08)" strokeWidth="0.5"
          />
          <line
            x1={zoneLeft} y1={zoneTop + thirdH * i}
            x2={zoneRight} y2={zoneTop + thirdH * i}
            stroke="rgba(255,255,255,0.08)" strokeWidth="0.5"
          />
        </g>
      ))}

      {/* Home plate */}
      <polygon
        points={`${plateCx},${plateY + 3} ${plateCx - pw / 2},${plateY + 1} ${plateCx - pw / 2 + 2},${plateY - 2} ${plateCx + pw / 2 - 2},${plateY - 2} ${plateCx + pw / 2},${plateY + 1}`}
        fill="none"
        stroke="rgba(255,255,255,0.2)"
        strokeWidth="0.8"
      />

      {/* Children (dots or heatmap) */}
      {children}
    </svg>
  );
}
