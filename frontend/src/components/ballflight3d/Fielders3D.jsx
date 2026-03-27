import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Standard fielder positions in feet from home plate.
 * x = toward first base, z = toward center field (negative in Three.js)
 */
const FIELDER_POSITIONS = {
  P:  { x: 0, z: -60.5, label: "P" },
  C:  { x: 0, z: 5, label: "C" },
  "1B": { x: 63, z: -63, label: "1B" },
  "2B": { x: 25, z: -130, label: "2B" },
  SS: { x: -25, z: -130, label: "SS" },
  "3B": { x: -63, z: -63, label: "3B" },
  LF: { x: -110, z: -260, label: "LF" },
  CF: { x: 0, z: -320, label: "CF" },
  RF: { x: 110, z: -260, label: "RF" },
};

/**
 * Map common event descriptions to fielder position keys.
 * Used to determine which fielder catches the ball.
 */
const FIELDER_KEYWORDS = {
  pitcher: "P", "first baseman": "1B", "second baseman": "2B",
  shortstop: "SS", "third baseman": "3B", "left fielder": "LF",
  "center fielder": "CF", "right fielder": "RF", catcher: "C",
};

/**
 * Determine which fielder catches/fields the ball based on description or landing position.
 */
function resolveFielder(description, landingX, landingZ) {
  // Try to parse from description — pick the fielder mentioned FIRST in the text
  // (e.g. "shortstop to first baseman" → shortstop is the one fielding it)
  if (description) {
    const desc = description.toLowerCase();
    let earliest = null;
    let earliestIdx = Infinity;
    for (const [keyword, pos] of Object.entries(FIELDER_KEYWORDS)) {
      const idx = desc.indexOf(keyword);
      if (idx !== -1 && idx < earliestIdx) {
        earliestIdx = idx;
        earliest = pos;
      }
    }
    if (earliest) return earliest;
  }

  // Fallback: find nearest fielder to landing spot
  let nearest = "CF";
  let minDist = Infinity;
  for (const [key, pos] of Object.entries(FIELDER_POSITIONS)) {
    if (key === "P" || key === "C") continue; // skip battery
    const dx = landingX - pos.x;
    const dz = landingZ - pos.z;
    const dist = dx * dx + dz * dz;
    if (dist < minDist) {
      minDist = dist;
      nearest = key;
    }
  }
  return nearest;
}

/**
 * 3D Fielders component.
 *
 * Shows all 9 fielder positions. When the ball lands on an out,
 * the fielding player runs toward the landing spot to make the catch.
 *
 * Props:
 *  - landingPos: { x, z } in Three.js coords (feet) — where the ball lands
 *  - isOut: boolean — whether the play is an out (fielder catches it)
 *  - description: string — play description (e.g. "flies out to center fielder")
 *  - ballProgress: 0-1 how far along the ball flight is
 *  - isAnimating: whether the ball is currently in flight
 */
export default function Fielders3D({
  landingPos,
  isOut = false,
  description = "",
  ballProgress = 0,
  isAnimating = false,
  teamColor = "#ffffff",
}) {
  // Determine which fielder is involved
  const activeFielder = useMemo(() => {
    if (!landingPos) return null;
    return resolveFielder(description, landingPos.x, landingPos.z);
  }, [landingPos, description]);

  return (
    <group>
      {Object.entries(FIELDER_POSITIONS).map(([key, pos]) => (
        <FielderDot
          key={key}
          posKey={key}
          basePosition={pos}
          landingPos={landingPos}
          isActive={key === activeFielder}
          isOut={isOut}
          ballProgress={ballProgress}
          isAnimating={isAnimating}
          teamColor={teamColor}
        />
      ))}
    </group>
  );
}

/**
 * Individual fielder dot that can animate toward the ball.
 */
function FielderDot({
  posKey,
  basePosition,
  landingPos,
  isActive,
  isOut,
  ballProgress,
  isAnimating,
  teamColor,
}) {
  const meshRef = useRef();
  const labelRef = useRef();
  const currentPos = useRef(new THREE.Vector3(basePosition.x, 0.5, basePosition.z));
  const targetPos = useRef(new THREE.Vector3(basePosition.x, 0.5, basePosition.z));

  // Determine target: if this fielder is active and ball is in flight, move toward landing
  useEffect(() => {
    if (isActive && landingPos && isAnimating) {
      targetPos.current.set(landingPos.x, 0.5, landingPos.z);
    } else {
      targetPos.current.set(basePosition.x, 0.5, basePosition.z);
    }
  }, [isActive, landingPos, isAnimating, basePosition]);

  useFrame((_, delta) => {
    if (!meshRef.current) return;

    if (isActive && isAnimating && landingPos) {
      // Fielder starts moving after ball is ~30% through flight
      // and arrives when ball lands (progress = 1)
      const moveProgress = Math.max(0, (ballProgress - 0.3) / 0.7);
      const eased = moveProgress * moveProgress * (3 - 2 * moveProgress); // smoothstep

      const bx = basePosition.x;
      const bz = basePosition.z;
      const tx = landingPos.x;
      const tz = landingPos.z;

      // For hits (not outs), fielder only gets partway there
      const reachFactor = isOut ? 1.0 : 0.6;

      const x = bx + (tx - bx) * eased * reachFactor;
      const z = bz + (tz - bz) * eased * reachFactor;

      meshRef.current.position.set(x, 0.5, z);

      // Pulse the active fielder
      const scale = 1 + Math.sin(ballProgress * Math.PI * 4) * 0.15;
      meshRef.current.scale.setScalar(scale);
    } else {
      // Smoothly return to base position
      meshRef.current.position.lerp(targetPos.current, delta * 3);
      meshRef.current.scale.setScalar(1);
    }
  });

  const color = isActive && isAnimating ? "#ffd700" : teamColor;
  const opacity = isActive && isAnimating ? 0.9 : 0.6;
  const size = isActive ? 3 : 2;

  return (
    <group>
      {/* Fielder dot */}
      <mesh ref={meshRef} position={[basePosition.x, 0.5, basePosition.z]}>
        <sphereGeometry args={[size, 12, 12]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>
    </group>
  );
}

export { FIELDER_POSITIONS, resolveFielder };
