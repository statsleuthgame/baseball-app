import { useState, useRef } from "react";
import { xScale, yScale } from "./StrikeZoneSVG";

const COLORS = {
  squeezed: "#ef4444", // red — ball called on pitch in zone
  gifted: "#3b82f6",   // blue — strike called on pitch outside zone
};

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

  const selectedDot = dots.find((d) => d.idx === selected);

  return (
    <>
      <g className="missed-call-dots">
        {dots.map((dot) => {
          const cx = xScale(dot.px);
          const cy = yScale(dot.pz);
          const isSel = selected === dot.idx;
          const color = COLORS[dot.type];

          return (
            <g key={dot.idx}>
              <circle
                cx={cx} cy={cy} r="6"
                fill="transparent"
                style={{ cursor: "pointer" }}
                onClick={() => handleClick(dot.idx)}
                onTouchStart={(e) => { e.preventDefault(); handleSelect(dot.idx, true); }}
              />
              <circle
                cx={cx} cy={cy}
                r={isSel ? 3.5 : 2}
                fill={color}
                opacity={isSel ? 1 : 0.55}
                stroke={isSel ? "#fff" : "none"}
                strokeWidth={isSel ? 0.8 : 0}
                style={{ transition: "r 0.15s, opacity 0.15s" }}
              />
            </g>
          );
        })}

        {selectedDot && (
          <circle
            cx={xScale(selectedDot.px)}
            cy={yScale(selectedDot.pz)}
            r="7" fill="none"
            stroke="#fff" strokeWidth="0.5" opacity="0.5"
          />
        )}
      </g>

      {selectedDot && (
        <g>
          <rect x="8" y="218" width="184" height="18" rx="4" fill="#1a2236" stroke={COLORS[selectedDot.type]} strokeWidth="0.5" opacity="0.95" />
          <text x="14" y="228" fill={COLORS[selectedDot.type]} fontSize="5.5" fontWeight="700">
            {selectedDot.type === "squeezed" ? "SQUEEZED" : "GIFTED"}
          </text>
          <text x="14" y="233" fill="#9299ad" fontSize="4.5">
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
