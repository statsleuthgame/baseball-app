import { useState, useRef } from "react";
import { xScale, yScale } from "./StrikeZoneSVG";

const COLORS = {
  squeezed: "#ef4444", // red — ball called on pitch in zone
  gifted: "#3b82f6",   // blue — strike called on pitch outside zone
};

const TYPE_NAMES = {
  squeezed: "Squeezed (ball called on a pitch in the zone)",
  gifted: "Gifted (strike called on a pitch out of the zone)",
};

export function describeMissedCall(dot) {
  const parts = [TYPE_NAMES[dot.type] || dot.type];
  if (dot.pitchType) parts.push(dot.pitchType);
  if (dot.velo) parts.push(`${dot.velo} mph`);
  if (dot.balls != null && dot.strikes != null) parts.push(`${dot.balls}-${dot.strikes} count`);
  if (dot.date) parts.push(dot.date);
  return parts.join(", ");
}

// Clamp dot positions so the full ball stays inside the SVG viewBox (200x240)
const DOT_R = 3.5; // max dot radius (selected state)
const MIN_X = DOT_R + 2;
const MAX_X = 200 - DOT_R - 2;
const MIN_Y = DOT_R + 2;
const MAX_Y = 240 - DOT_R - 2;
const clampX = (v) => Math.max(MIN_X, Math.min(MAX_X, v));
const clampY = (v) => Math.max(MIN_Y, Math.min(MAX_Y, v));

export default function MissedCallDots({ squeezed = [], gifted = [], callFilter = "all" }) {
  const [selected, setSelected] = useState(null);
  const lastTouchRef = useRef(0);

  const dots = [];
  if (callFilter !== "gifted") {
    squeezed.forEach((p, i) => dots.push({ ...p, type: "squeezed", idx: `s-${i}` }));
  }
  if (callFilter !== "squeezed") {
    gifted.forEach((p, i) => dots.push({ ...p, type: "gifted", idx: `g-${i}` }));
  }

  const handleSelect = (idx, fromTouch = false) => {
    if (fromTouch) lastTouchRef.current = Date.now();
    setSelected(selected === idx ? null : idx);
  };

  const handleClick = (idx) => {
    if (Date.now() - lastTouchRef.current < 500) return;
    handleSelect(idx);
  };

  const handleKeyDown = (idx) => (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleSelect(idx);
    }
  };

  const selectedDot = dots.find((d) => d.idx === selected);

  return (
    <>
      <g className="missed-call-dots" role="group" aria-label={`${dots.length} missed calls plotted`}>
        {dots.map((dot) => {
          const cx = clampX(xScale(dot.px));
          const cy = clampY(yScale(dot.pz));
          const isSel = selected === dot.idx;
          const color = COLORS[dot.type];
          const label = describeMissedCall(dot);
          const isGifted = dot.type === "gifted";

          return (
            <g
              key={dot.idx}
              className="mc-dot-group"
              role="button"
              tabIndex={0}
              aria-label={label}
              aria-pressed={isSel}
              focusable="true"
              onKeyDown={handleKeyDown(dot.idx)}
              style={{ cursor: "pointer" }}
            >
              <circle
                cx={cx} cy={cy} r="6"
                fill="transparent"
                onClick={() => handleClick(dot.idx)}
                onTouchStart={(e) => { e.preventDefault(); handleSelect(dot.idx, true); }}
              />
              {isGifted ? (
                // Blue filled circle for "gifted"
                <circle
                  cx={cx} cy={cy}
                  r={isSel ? 3.5 : 2}
                  fill={color}
                  opacity={isSel ? 1 : 0.55}
                  stroke={isSel ? "#fff" : "none"}
                  strokeWidth={isSel ? 0.8 : 0}
                  style={{ transition: "r 0.15s, opacity 0.15s" }}
                />
              ) : (
                // Red outlined triangle for "squeezed" — shape-differentiated from gifted
                <polygon
                  points={(() => {
                    const r = isSel ? 4 : 2.8;
                    return [
                      `${cx},${cy - r}`,
                      `${cx - r},${cy + r * 0.8}`,
                      `${cx + r},${cy + r * 0.8}`,
                    ].join(" ");
                  })()}
                  fill={color}
                  opacity={isSel ? 1 : 0.7}
                  stroke={isSel ? "#fff" : "none"}
                  strokeWidth={isSel ? 0.8 : 0}
                  style={{ transition: "opacity 0.15s" }}
                />
              )}
            </g>
          );
        })}

        {selectedDot && (
          <circle
            cx={clampX(xScale(selectedDot.px))}
            cy={clampY(yScale(selectedDot.pz))}
            r="7" fill="none"
            stroke="#fff" strokeWidth="0.5" opacity="0.5"
            aria-hidden="true"
          />
        )}
      </g>

      {selectedDot && (
        <g aria-hidden="true">
          <rect x="8" y="218" width="184" height="18" rx="4" fill="#1a2236" stroke={COLORS[selectedDot.type]} strokeWidth="0.5" opacity="0.95" />
          <text x="14" y="228" fill={COLORS[selectedDot.type]} fontSize="5.5" fontWeight="700">
            {selectedDot.type === "squeezed" ? "SQUEEZED" : "GIFTED"}
          </text>
          <text x="14" y="233" fill="#c6ccde" fontSize="4.5">
            {selectedDot.pitchType || ""}
            {selectedDot.velo ? ` ${selectedDot.velo} mph` : ""}
            {selectedDot.balls != null ? ` · ${selectedDot.balls}-${selectedDot.strikes}` : ""}
            {selectedDot.date ? ` · ${selectedDot.date}` : ""}
          </text>
        </g>
      )}
    </>
  );
}
