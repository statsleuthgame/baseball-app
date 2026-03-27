import { useRef, useMemo, useState } from "react";
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
 * Parse throw target base from play description.
 * Returns base key ("first", "second", etc.) or null.
 */
export function parseThrowTarget(description) {
  if (!description) return null;
  const desc = description.toLowerCase();

  // Look for "to first baseman", "to second baseman", etc.
  if (desc.includes("to first base") || desc.includes("to first baseman")) return "first";
  if (desc.includes("to second base") || desc.includes("to second baseman")) return "second";
  if (desc.includes("to third base") || desc.includes("to third baseman")) return "third";
  if (desc.includes("to catcher") || desc.includes("to home")) return "home";

  return null;
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
  const trailRef = useRef();
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
