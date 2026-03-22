export default function SprayChartPlaceholder() {
  return (
    <div className="spray-placeholder">
      <h2>Spray Charts</h2>
      <p className="coming-soon">Interactive spray charts with ballpark overlays coming in Phase 4</p>
      <svg viewBox="0 0 250 250" className="spray-preview" style={{ maxWidth: 300, margin: "2rem auto", display: "block" }}>
        {/* Simple field outline preview */}
        <path
          d="M 125 210 L 30 120 Q 30 30 125 30 Q 220 30 220 120 Z"
          fill="none"
          stroke="var(--team-primary, #333)"
          strokeWidth="2"
        />
        {/* Home plate */}
        <polygon points="125,210 120,205 122,200 128,200 130,205" fill="var(--team-primary, #333)" />
        {/* Sample dots */}
        <circle cx="100" cy="80" r="4" fill="#4CAF50" opacity="0.7" />
        <circle cx="150" cy="60" r="4" fill="#F44336" opacity="0.7" />
        <circle cx="80" cy="100" r="4" fill="#2196F3" opacity="0.7" />
        <circle cx="160" cy="90" r="4" fill="#4CAF50" opacity="0.7" />
        <circle cx="130" cy="70" r="4" fill="#9E9E9E" opacity="0.7" />
      </svg>
    </div>
  );
}
