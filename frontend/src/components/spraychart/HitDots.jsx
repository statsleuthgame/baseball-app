import { useState } from "react";
import { SPRAY_HP_X, SPRAY_HP_Y } from "./BallparkSVG";

const RESULT_COLORS = {
  single: "#4CAF50",
  double: "#2196F3",
  triple: "#FF9800",
  home_run: "#F44336",
  out: "#616161",
};

const RESULT_LABELS = {
  single: "1B",
  double: "2B",
  triple: "3B",
  home_run: "HR",
  out: "Out",
};

// SVG star path centered at 0,0
function StarShape({ cx, cy, size = 4, fill, stroke, strokeWidth, opacity, style, ...props }) {
  const points = [];
  for (let i = 0; i < 5; i++) {
    const outerAngle = (i * 72 - 90) * (Math.PI / 180);
    const innerAngle = ((i * 72 + 36) - 90) * (Math.PI / 180);
    points.push(`${cx + Math.cos(outerAngle) * size},${cy + Math.sin(outerAngle) * size}`);
    points.push(`${cx + Math.cos(innerAngle) * size * 0.4},${cy + Math.sin(innerAngle) * size * 0.4}`);
  }
  return (
    <polygon
      points={points.join(" ")}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      opacity={opacity}
      style={style}
      {...props}
    />
  );
}

export default function HitDots({ hits, filters, longestHR }) {
  const [tooltip, setTooltip] = useState(null);

  if (!hits?.length) return null;

  const filtered = filters
    ? hits.filter((h) => filters.includes(h.result))
    : hits;

  // Check if a hit is the longest HR
  const isLongestHR = (hit) =>
    longestHR && hit.result === "home_run" &&
    hit.x === longestHR.x && hit.y === longestHR.y &&
    hit.date === longestHR.date;

  return (
    <g className="hit-dots">
      {filtered.map((hit, i) => {
        const svgX = hit.x + SPRAY_HP_X;
        const svgY = SPRAY_HP_Y - hit.y;
        const isLongest = isLongestHR(hit);

        if (isLongest) {
          return (
            <StarShape
              key={i}
              cx={svgX}
              cy={svgY}
              size={5}
              fill="#F44336"
              stroke={tooltip === i ? "#FFD700" : "#FFD700"}
              strokeWidth={tooltip === i ? "1" : "0.5"}
              opacity="1"
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setTooltip(i)}
              onMouseLeave={() => setTooltip(null)}
              onTouchStart={() => setTooltip(tooltip === i ? null : i)}
            />
          );
        }

        return (
          <circle
            key={i}
            cx={svgX}
            cy={svgY}
            r="2.5"
            fill={RESULT_COLORS[hit.result] || "#616161"}
            opacity="0.75"
            stroke={tooltip === i ? "#fff" : "none"}
            strokeWidth={tooltip === i ? "1" : "0"}
            style={{ cursor: "pointer" }}
            onMouseEnter={() => setTooltip(i)}
            onMouseLeave={() => setTooltip(null)}
            onTouchStart={() => setTooltip(tooltip === i ? null : i)}
          />
        );
      })}

      {/* Tooltip */}
      {tooltip !== null && filtered[tooltip] && (() => {
        const hit = filtered[tooltip];
        const svgX = hit.x + SPRAY_HP_X;
        const svgY = SPRAY_HP_Y - hit.y;
        const flipX = svgX > 170;
        const flipY = svgY < 50;
        const tx = flipX ? svgX - 55 : svgX + 6;
        const ty = flipY ? svgY + 6 : svgY - 34;
        const isLongest = isLongestHR(hit);

        return (
          <g>
            <rect
              x={tx}
              y={ty}
              width="53"
              height={isLongest ? 34 : 28}
              rx="3"
              fill="#1a2236"
              stroke={isLongest ? "#FFD700" : "#2e3a4e"}
              strokeWidth="0.5"
            />
            <text x={tx + 4} y={ty + 10} fill={isLongest ? "#FFD700" : "#fff"} fontSize="5" fontWeight="600">
              {isLongest ? "LONGEST HR" : (RESULT_LABELS[hit.result] || hit.event)}
            </text>
            <text x={tx + 4} y={ty + 17} fill="#8891a5" fontSize="4">
              {hit.exitVelo ? `${hit.exitVelo} mph` : ""}{hit.launchAngle ? ` · ${hit.launchAngle}°` : ""}
            </text>
            <text x={tx + 4} y={ty + 23} fill="#8891a5" fontSize="3.5">
              {hit.hitDistance ? `${hit.hitDistance} ft · ` : ""}{hit.date ? hit.date.split(" ")[0] : ""}
            </text>
            {isLongest && (
              <text x={tx + 4} y={ty + 30} fill="#FFD700" fontSize="3.5" fontWeight="600">
                {hit.hitDistance} ft bomb
              </text>
            )}
          </g>
        );
      })()}
    </g>
  );
}

export { RESULT_COLORS, RESULT_LABELS };
