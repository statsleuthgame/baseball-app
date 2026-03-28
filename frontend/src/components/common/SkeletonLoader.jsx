export default function SkeletonLoader({ variant = "card" }) {
  return (
    <div className="skeleton-container" role="status" aria-label="Loading">
      {variant === "card" && <CardSkeleton />}
      {variant === "player" && <PlayerSkeleton />}
      {variant === "matchup" && <MatchupSkeleton />}
      {variant === "scores" && <ScoresSkeleton />}
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="skeleton-card">
      <div className="skeleton-pulse" style={{ height: 16, width: "60%", marginBottom: 12 }} />
      <div className="skeleton-pulse" style={{ height: 12, width: "90%", marginBottom: 8 }} />
      <div className="skeleton-pulse" style={{ height: 12, width: "75%" }} />
    </div>
  );
}

function PlayerSkeleton() {
  return (
    <div className="skeleton-player">
      <div className="skeleton-pulse skeleton-circle" />
      <div className="skeleton-player-lines">
        <div className="skeleton-pulse" style={{ height: 18, width: "50%", marginBottom: 10 }} />
        <div className="skeleton-pulse" style={{ height: 12, width: "35%", marginBottom: 8 }} />
        <div className="skeleton-pulse" style={{ height: 12, width: "45%" }} />
      </div>
    </div>
  );
}

function MatchupSkeleton() {
  return (
    <div className="skeleton-matchup">
      <div className="skeleton-matchup-row">
        <div className="skeleton-pulse skeleton-logo" />
        <div className="skeleton-pulse" style={{ height: 20, width: 32 }} />
        <div className="skeleton-pulse skeleton-logo" />
      </div>
      <div className="skeleton-pulse" style={{ height: 12, width: "40%", margin: "12px auto 0" }} />
    </div>
  );
}

function ScoresSkeleton() {
  return (
    <div className="skeleton-scores">
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton-score-card">
          <div className="skeleton-score-teams">
            <div className="skeleton-pulse" style={{ height: 14, width: "40%" }} />
            <div className="skeleton-pulse" style={{ height: 14, width: "20%" }} />
          </div>
          <div className="skeleton-score-teams">
            <div className="skeleton-pulse" style={{ height: 14, width: "40%" }} />
            <div className="skeleton-pulse" style={{ height: 14, width: "20%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
