import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Base positions in Three.js coordinates (feet).
 */
const BASE_POSITIONS = {
  first: { x: 63.64, z: -63.64 },
  second: { x: 0, z: -127.28 },
  third: { x: -63.64, z: -63.64 },
  home: { x: 0, z: 0 },
};

/**
 * Parse throw targets from play description.
 * Returns array of base keys for each throw in order.
 * E.g. "shortstop to second baseman to first baseman" → ["second", "first"]
 * E.g. "shortstop to first baseman" → ["first"]
 */
export function parseThrowTargets(description) {
  if (!description) return [];
  const desc = description.toLowerCase();

  const targets = [];
  // Split on "to" and check each segment for a position
  const parts = desc.split(/\bto\b/).slice(1); // skip first part (the fielder)
  for (const part of parts) {
    if (part.includes("first base") || part.includes("first baseman")) targets.push("first");
    else if (part.includes("second base") || part.includes("second baseman")) targets.push("second");
    else if (part.includes("third base") || part.includes("third baseman")) targets.push("third");
    else if (part.includes("catcher") || part.includes("home")) targets.push("home");
  }

  return targets;
}

// Backwards-compatible single target
export function parseThrowTarget(description) {
  const targets = parseThrowTargets(description);
  return targets.length > 0 ? targets[0] : null;
}

/**
 * Animated throw from fielder position to a base.
 *
 * Props:
 *  - fromPos: { x, z } fielder position in Three.js coords
 *  - targetBase: "first" | "second" | "third" | "home"
 *  - onComplete: callback when throw arrives
 *  - throwSpeed: time in seconds for the throw (default 0.6)
 */
export default function ThrowToBase({ fromPos, targetBase, onComplete, throwSpeed = 0.6 }) {
  const ballRef = useRef();
  const elapsedRef = useRef(0);
  const completedRef = useRef(false);

  const target = BASE_POSITIONS[targetBase];
  if (!target || !fromPos) return null;

  const maxTrailLen = 30;
  const trailPositions = useRef([]);
  const trailGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(maxTrailLen * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setDrawRange(0, 0);
    return geo;
  }, []);

  // Throw arc height — slight arc for realism
  const throwDist = Math.sqrt(
    (target.x - fromPos.x) ** 2 + (target.z - fromPos.z) ** 2
  );
  const arcHeight = Math.min(throwDist * 0.08, 15); // subtle arc

  useFrame((_, delta) => {
    if (!ballRef.current || completedRef.current) return;

    elapsedRef.current += delta;
    const progress = Math.min(elapsedRef.current / throwSpeed, 1);

    // Linear interpolation with slight arc
    const x = fromPos.x + (target.x - fromPos.x) * progress;
    const z = fromPos.z + (target.z - fromPos.z) * progress;
    // Parabolic arc: peaks at midpoint
    const y = 3 + arcHeight * 4 * progress * (1 - progress);

    ballRef.current.position.set(x, y, z);

    // Trail
    trailPositions.current.push([x, y, z]);
    if (trailPositions.current.length > maxTrailLen) trailPositions.current.shift();

    const posAttr = trailGeo.getAttribute("position");
    const len = trailPositions.current.length;
    for (let i = 0; i < len; i++) {
      posAttr.setXYZ(i, ...trailPositions.current[i]);
    }
    posAttr.needsUpdate = true;
    trailGeo.setDrawRange(0, len);

    if (progress >= 1 && !completedRef.current) {
      completedRef.current = true;
      onComplete?.();
    }
  });

  return (
    <group>
      <line geometry={trailGeo}>
        <lineBasicMaterial color="#ffff88" transparent opacity={0.6} />
      </line>

      <mesh ref={ballRef} position={[fromPos.x, 3, fromPos.z]}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffff88" emissiveIntensity={0.4} />
      </mesh>
    </group>
  );
}
