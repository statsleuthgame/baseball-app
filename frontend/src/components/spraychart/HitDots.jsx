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

export default function HitDots({ hits, filters }) {
  const [tooltip, setTooltip] = useState(null);

  if (!hits?.length) return null;

  const filtered = filters
    ? hits.filter((h) => filters.includes(h.result))
    : hits;

  return (
    <g className="hit-dots">
      {filtered.map((hit, i) => {
        // Transform from server coords (centered at origin) to SVG viewBox
        const svgX = hit.x + SPRAY_HP_X;
        const svgY = SPRAY_HP_Y - hit.y;

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
        const tx = flipX ? svgX - 52 : svgX + 6;
        const ty = flipY ? svgY + 6 : svgY - 30;

        return (
          <g>
            <rect
              x={tx}
              y={ty}
              width="50"
              height="28"
              rx="3"
              fill="#1a2236"
              stroke="#2e3a4e"
              strokeWidth="0.5"
            />
            <text x={tx + 4} y={ty + 10} fill="#fff" fontSize="5" fontWeight="600">
              {RESULT_LABELS[hit.result] || hit.event}
            </text>
            <text x={tx + 4} y={ty + 17} fill="#8891a5" fontSize="4">
              {hit.exitVelo ? `${hit.exitVelo} mph` : ""}{hit.launchAngle ? ` · ${hit.launchAngle}°` : ""}
            </text>
            <text x={tx + 4} y={ty + 23} fill="#8891a5" fontSize="3.5">
              {hit.date ? hit.date.split(" ")[0] : ""}{hit.hitDistance ? ` · ${hit.hitDistance} ft` : ""}
            </text>
          </g>
        );
      })()}
    </g>
  );
}

export { RESULT_COLORS, RESULT_LABELS };
