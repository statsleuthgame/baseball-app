import { useState, useMemo, useRef } from "react";
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

const RESULT_NAMES = {
  single: "Single",
  double: "Double",
  triple: "Triple",
  home_run: "Home run",
  out: "Out",
};

function describeHit(hit) {
  const type = RESULT_NAMES[hit.result] || hit.event || "Hit";
  const parts = [type];
  if (hit.exitVelo) parts.push(`${hit.exitVelo} mph`);
  if (hit.launchAngle != null) parts.push(`${hit.launchAngle}° launch angle`);
  if (hit.hitDistance) parts.push(`${hit.hitDistance} feet`);
  if (hit.date) parts.push(hit.date.split(" ")[0]);
  return parts.join(", ");
}

/** 5-pointed star SVG polygon */
const StarShape = ({ cx, cy, size = 4, fill, stroke, strokeWidth, opacity, style, ...props }) => {
  const pts = [];
  for (let i = 0; i < 5; i++) {
    const outerA = (i * 72 - 90) * (Math.PI / 180);
    const innerA = ((i * 72 + 36) - 90) * (Math.PI / 180);
    pts.push(`${cx + Math.cos(outerA) * size},${cy + Math.sin(outerA) * size}`);
    pts.push(`${cx + Math.cos(innerA) * size * 0.4},${cy + Math.sin(innerA) * size * 0.4}`);
  }
  return <polygon points={pts.join(" ")} fill={fill} stroke={stroke} strokeWidth={strokeWidth} opacity={opacity} style={style} {...props} />;
};

export default function HitDots({ hits, filters, longestHR, onHitSelect }) {
  const [selected, setSelected] = useState(null);

  const filtered = useMemo(() => {
    if (!hits?.length) return [];
    return filters ? hits.filter((h) => filters.includes(h.result)) : hits;
  }, [hits, filters]);

  // Convert stored spray coords back to MLBAM pixel coords
  // Stored: x = hc_x - 125.42, y = 198.27 - hc_y
  // MLBAM: hc_x = x + 125.42, hc_y = 198.27 - y
  const xScale = useMemo(() => (x) => x + SPRAY_HP_X, []);
  const yScale = useMemo(() => (y) => SPRAY_HP_Y - y, []);
  const lastTouchRef = useRef(0);

  if (!filtered.length) return null;

  const isLongestHR = (hit) =>
    longestHR && hit.result === "home_run" &&
    hit.x === longestHR.x && hit.y === longestHR.y &&
    hit.date === longestHR.date;

  const handleSelect = (i, fromTouch = false) => {
    if (fromTouch) lastTouchRef.current = Date.now();
    const newSelected = selected === i ? null : i;
    setSelected(newSelected);
    if (onHitSelect) {
      onHitSelect(newSelected !== null ? filtered[newSelected] : null);
    }
  };

  const handleClick = (i) => {
    // Ignore click if it came right after a touch (prevents double-toggle)
    if (Date.now() - lastTouchRef.current < 500) return;
    handleSelect(i);
  };

  const handleKeyDown = (i) => (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleSelect(i);
    }
  };

  const selectedHit = selected !== null ? filtered[selected] : null;

  return (
    <>
      <g className="hit-dots" role="group" aria-label={`${filtered.length} hits plotted`}>
        {/* Render outs first (behind), then hits on top */}
        {filtered.map((hit, i) => {
          const svgX = xScale(hit.x);
          const svgY = yScale(hit.y);
          const isLongest = isLongestHR(hit);
          const isSelected = selected === i;
          const isOut = hit.result === "out";
          const label = describeHit(hit) + (isLongest ? ", longest home run" : "");

          if (isLongest) {
            return (
              <StarShape
                key={`hit-${i}`}
                cx={svgX} cy={svgY} size={6}
                fill="#F44336"
                stroke="#FFD700" strokeWidth={isSelected ? 1.5 : 0.5}
                opacity="1"
                style={{ cursor: "pointer", transition: "opacity 0.15s", outline: "none" }}
                role="button"
                tabIndex={0}
                aria-label={label}
                aria-pressed={isSelected}
                focusable="true"
                onClick={() => handleClick(i)}
                onKeyDown={handleKeyDown(i)}
                onTouchStart={(e) => { e.preventDefault(); handleSelect(i, true); }}
              />
            );
          }

          return (
            <g
              key={`hit-${i}`}
              role="button"
              tabIndex={0}
              aria-label={label}
              aria-pressed={isSelected}
              focusable="true"
              className="hit-dot-group"
              onKeyDown={handleKeyDown(i)}
              style={{ cursor: "pointer" }}
            >
              {/* Invisible larger tap target */}
              <circle
                cx={svgX} cy={svgY} r="6"
                fill="transparent"
                onClick={() => handleClick(i)}
                onTouchStart={(e) => { e.preventDefault(); handleSelect(i, true); }}
              />
              {/* Visible dot */}
              <circle
                cx={svgX} cy={svgY}
                r={isSelected ? 4 : isOut ? 1.8 : 2.8}
                fill={RESULT_COLORS[hit.result] || "#616161"}
                opacity={isSelected ? 1 : isOut ? 0.4 : 0.75}
                stroke={isSelected ? "#fff" : "none"}
                strokeWidth={isSelected ? 1 : 0}
                style={{ transition: "r 0.15s, opacity 0.15s" }}
              />
              {/* Outs get an "X" overlay so they're differentiated by shape, not just color. */}
              {isOut && !isSelected && (
                <g aria-hidden="true">
                  <line
                    x1={svgX - 1.4} y1={svgY - 1.4}
                    x2={svgX + 1.4} y2={svgY + 1.4}
                    stroke="#fff" strokeWidth="0.5" opacity="0.5"
                  />
                  <line
                    x1={svgX - 1.4} y1={svgY + 1.4}
                    x2={svgX + 1.4} y2={svgY - 1.4}
                    stroke="#fff" strokeWidth="0.5" opacity="0.5"
                  />
                </g>
              )}
            </g>
          );
        })}

        {/* Selection ring */}
        {selectedHit && !isLongestHR(selectedHit) && (
          <circle
            cx={xScale(selectedHit.x)}
            cy={yScale(selectedHit.y)}
            r="8"
            fill="none"
            stroke="#fff"
            strokeWidth="0.5"
            opacity="0.5"
            aria-hidden="true"
          />
        )}
      </g>

      {/* Fixed tooltip panel at bottom of SVG */}
      {selectedHit && (() => {
        const isLongest = isLongestHR(selectedHit);
        const label = isLongest ? "LONGEST HR" : RESULT_LABELS[selectedHit.result] || selectedHit.event;
        const color = isLongest ? "#FFD700" : RESULT_COLORS[selectedHit.result] || "#fff";

        return (
          <g aria-hidden="true">
            <rect x="10" y="238" width="230" height="26" rx="5" fill="#1a2236" stroke={color} strokeWidth="0.5" opacity="0.95" />
            <text x="18" y="250" fill={color} fontSize="6" fontWeight="700">{label}</text>
            <text x="18" y="258" fill="#c6ccde" fontSize="5">
              {selectedHit.exitVelo ? `${selectedHit.exitVelo} mph` : ""}
              {selectedHit.launchAngle ? ` · ${selectedHit.launchAngle}°` : ""}
              {selectedHit.hitDistance ? ` · ${selectedHit.hitDistance} ft` : ""}
              {selectedHit.date ? ` · ${selectedHit.date.split(" ")[0]}` : ""}
            </text>
          </g>
        );
      })()}
    </>
  );
}

export { RESULT_COLORS, RESULT_LABELS, describeHit };
