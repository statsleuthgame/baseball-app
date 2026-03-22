import { RESULT_COLORS, RESULT_LABELS } from "./HitDots";

const RESULT_TYPES = ["single", "double", "triple", "home_run", "out"];

export default function SprayLegend({ filters, onToggle }) {
  return (
    <div className="spray-legend">
      {RESULT_TYPES.map((type) => {
        const active = !filters || filters.includes(type);
        return (
          <button
            key={type}
            className={`spray-legend-item ${active ? "active" : "inactive"}`}
            onClick={() => onToggle(type)}
          >
            <span
              className="spray-legend-dot"
              style={{ backgroundColor: RESULT_COLORS[type] }}
            />
            <span>{RESULT_LABELS[type]}</span>
          </button>
        );
      })}
    </div>
  );
}
