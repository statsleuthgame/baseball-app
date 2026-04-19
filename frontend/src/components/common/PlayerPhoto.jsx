import { useState } from "react";

export default function PlayerPhoto({ playerId, name, size = 64, className = "" }) {
  const [error, setError] = useState(false);
  const url = `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${playerId}/headshot/67/current`;

  if (error) {
    return (
      <div
        className={`player-photo-fallback ${className}`}
        role="img"
        aria-label={name || "Player photo"}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          backgroundColor: "var(--team-primary, #333)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: size * 0.35,
          fontWeight: 700,
        }}
      >
        <span aria-hidden="true">{name ? name.split(" ").map((n) => n[0]).join("") : "?"}</span>
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={name || "Player"}
      className={`player-photo ${className}`}
      loading="lazy"
      decoding="async"
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover" }}
      onError={() => setError(true)}
    />
  );
}
