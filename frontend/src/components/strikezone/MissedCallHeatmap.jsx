import { useMemo } from "react";
import { xScale, yScale } from "./StrikeZoneSVG";

const GRID_COLS = 20;
const GRID_ROWS = 25;
const X_MIN = -2;
const X_MAX = 2;
const Z_MIN = 0;
const Z_MAX = 5;

function buildGrid(pitches) {
  const cellW = (X_MAX - X_MIN) / GRID_COLS;
  const cellH = (Z_MAX - Z_MIN) / GRID_ROWS;
  const grid = Array.from({ length: GRID_ROWS }, () => new Float32Array(GRID_COLS));
  let max = 0;

  for (const p of pitches) {
    const col = Math.floor((p.px - X_MIN) / cellW);
    const row = Math.floor((p.pz - Z_MIN) / cellH);
    if (col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS) {
      grid[row][col] += 1;
      if (grid[row][col] > max) max = grid[row][col];
    }
  }

  return { grid, max, cellW, cellH };
}

export default function MissedCallHeatmap({ squeezed = [], gifted = [], callFilter = "all" }) {
  const squeezedGrid = useMemo(() => buildGrid(squeezed), [squeezed]);
  const giftedGrid = useMemo(() => buildGrid(gifted), [gifted]);

  const cellW = (X_MAX - X_MIN) / GRID_COLS;
  const cellH = (Z_MAX - Z_MIN) / GRID_ROWS;

  const renderGrid = (data, color) => {
    if (data.max === 0) return null;
    const cells = [];
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const count = data.grid[row][col];
        if (count === 0) continue;
        const intensity = count / data.max;
        const x = xScale(X_MIN + col * cellW);
        const y = yScale(Z_MIN + (row + 1) * cellH);
        const w = xScale(X_MIN + (col + 1) * cellW) - x;
        const h = yScale(Z_MIN + row * cellH) - y;
        cells.push(
          <rect
            key={`${row}-${col}`}
            x={x} y={y} width={w} height={h}
            fill={color}
            opacity={0.15 + intensity * 0.6}
            rx="1"
          />
        );
      }
    }
    return cells;
  };

  return (
    <g className="missed-call-heatmap">
      {callFilter !== "gifted" && renderGrid(squeezedGrid, "#ef4444")}
      {callFilter !== "squeezed" && renderGrid(giftedGrid, "#3b82f6")}
    </g>
  );
}
