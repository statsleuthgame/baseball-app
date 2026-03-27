import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Base positions in Three.js feet coordinates.
 * Home = origin, 1B = +x, 2B = center, 3B = -x.
 */
const BASES = {
  home: new THREE.Vector3(0, 0.5, 0),
  first: new THREE.Vector3(63.64, 0.5, -63.64),
  second: new THREE.Vector3(0, 0.5, -127.28),
  third: new THREE.Vector3(-63.64, 0.5, -63.64),
};

// Ordered base list for path calculations
const BASE_ORDER = ["home", "first", "second", "third"];

/**
 * Determine how many bases each runner advances based on the hit event.
 *
 * Returns an array of runner movements: { from, to, scores }
 * - from: starting base index (0=home, 1=first, 2=second, 3=third)
 * - to: ending base index
 * - scores: whether the runner crosses home
 */
function computeRunnerMovements(event, runnersOn) {
  const movements = [];

  // How many bases the batter gets
  const batterBases = {
    "Single": 1, "Double": 2, "Triple": 3, "Home Run": 4, "Out": 0,
  }[event] || 0;

  if (batterBases === 0) return movements;

  // Existing runners advance (simplified: each runner advances same as batter, capped at home)
  // Work from furthest runner to closest to avoid conflicts
  const runners = [];
  if (runnersOn?.third) runners.push({ base: 3, label: "third" });
  if (runnersOn?.second) runners.push({ base: 2, label: "second" });
  if (runnersOn?.first) runners.push({ base: 1, label: "first" });

  for (const runner of runners) {
    const newBase = runner.base + batterBases;
    movements.push({
      from: runner.base,
      to: Math.min(newBase, 4), // 4 = scored (crossed home)
      scores: newBase >= 4,
    });
  }

  // Batter runs
  movements.push({
    from: 0, // home
    to: Math.min(batterBases, 4),
    scores: batterBases >= 4,
    isBatter: true,
  });

  return movements;
}

/**
 * Get the path of 3D positions a runner takes from one base to another.
 * Runners follow the base paths (not straight lines).
 */
function getRunnerPath(fromBase, toBase) {
  const path = [];
  let current = fromBase;

  while (current !== toBase && current < 4) {
    const fromKey = BASE_ORDER[current % 4];
    current++;
    const toKey = BASE_ORDER[current % 4];

    const from = BASES[fromKey];
    const to = current >= 4 ? BASES.home : BASES[toKey];

    // Add intermediate points along the path for smooth running
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      path.push(new THREE.Vector3(
        from.x + (to.x - from.x) * t,
        0.5,
        from.z + (to.z - from.z) * t,
      ));
    }
  }

  return path;
}

/**
 * BaseRunners3D — shows runners on base and animates them advancing.
 *
 * Props:
 *  - runnersOn: { first: bool, second: bool, third: bool }
 *  - event: "Single" | "Double" | "Triple" | "Home Run" | "Out"
 *  - ballProgress: 0-1 flight progress
 *  - isAnimating: whether ball is in flight
 */
export default function BaseRunners3D({
  runnersOn = {},
  event = "",
  ballProgress = 0,
  isAnimating = false,
}) {
  const movements = useMemo(
    () => computeRunnerMovements(event, runnersOn),
    [event, runnersOn]
  );

  const paths = useMemo(
    () => movements.map((m) => getRunnerPath(m.from, m.to)),
    [movements]
  );

  return (
    <group>
      {/* Static runners at their starting bases (before animation starts) */}
      {!isAnimating && (
        <>
          {runnersOn?.first && <StaticRunner position={BASES.first} />}
          {runnersOn?.second && <StaticRunner position={BASES.second} />}
          {runnersOn?.third && <StaticRunner position={BASES.third} />}
        </>
      )}

      {/* Animated runners */}
      {isAnimating && movements.map((movement, i) => (
        <AnimatedRunner
          key={i}
          path={paths[i]}
          ballProgress={ballProgress}
          isBatter={movement.isBatter}
          scores={movement.scores}
          startDelay={movement.isBatter ? 0.15 : 0}
          numBases={Math.min(movement.to - movement.from, 4)}
        />
      ))}
    </group>
  );
}

/**
 * Static runner dot at a base.
 */
function StaticRunner({ position }) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[2.5, 12, 12]} />
      <meshBasicMaterial color="#3b82f6" transparent opacity={0.8} />
    </mesh>
  );
}

/**
 * Animated runner that follows a path around the bases.
 */
/**
 * @param {number} numBases — how many bases the runner is covering (1-4)
 */
function AnimatedRunner({ path, ballProgress, isBatter, scores, startDelay = 0, numBases = 1 }) {
  const meshRef = useRef();
  const elapsedRef = useRef(0);
  const startedRef = useRef(false);
  const trailPositions = useRef([]);

  // ~4 seconds per base — realistic MLB base running speed
  const totalRunTime = numBases * 4;

  // Pre-compute trail geometry
  const maxTrailLen = 20;
  const trailGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(maxTrailLen * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setDrawRange(0, 0);
    return geo;
  }, []);

  useFrame((_, delta) => {
    if (!meshRef.current || !path?.length) return;

    // Start running once ball is ~50% through flight
    if (ballProgress > 0.5 + startDelay) {
      startedRef.current = true;
    }

    if (!startedRef.current) return;

    // Accumulate real elapsed time
    elapsedRef.current += delta;
    const runProgress = Math.min(elapsedRef.current / totalRunTime, 1);

    // Ease: accelerate out of the box, steady in the middle, slight decel at the base
    const eased = runProgress < 0.15
      ? (runProgress / 0.15) * (runProgress / 0.15) * 0.15
      : runProgress > 0.9
      ? 0.9 + (1 - Math.pow(1 - (runProgress - 0.9) / 0.1, 2)) * 0.1
      : runProgress;

    const pathIdx = Math.min(Math.floor(eased * (path.length - 1)), path.length - 2);
    const pathFrac = eased * (path.length - 1) - pathIdx;

    const p0 = path[pathIdx];
    const p1 = path[pathIdx + 1] || p0;

    const x = p0.x + (p1.x - p0.x) * pathFrac;
    const z = p0.z + (p1.z - p0.z) * pathFrac;

    meshRef.current.position.set(x, 0.5, z);

    // Running bob effect — quicker stride
    if (runProgress > 0 && runProgress < 1) {
      const bob = Math.abs(Math.sin(elapsedRef.current * 6)) * 1.2;
      meshRef.current.position.y = 0.5 + bob;
    }

    // Scale pulse while running
    const scale = runProgress > 0 && runProgress < 1 ? 1 + Math.sin(elapsedRef.current * 5) * 0.08 : 1;
    meshRef.current.scale.setScalar(scale);

    // Trail
    if (runProgress > 0 && runProgress < 1) {
      trailPositions.current.push([x, 0.2, z]);
      if (trailPositions.current.length > maxTrailLen) trailPositions.current.shift();
    }

    const posAttr = trailGeo.getAttribute("position");
    const len = trailPositions.current.length;
    for (let i = 0; i < len; i++) {
      posAttr.setXYZ(i, ...trailPositions.current[i]);
    }
    posAttr.needsUpdate = true;
    trailGeo.setDrawRange(0, len);
  });

  if (!path?.length) return null;

  const color = isBatter ? "#fbbf24" : "#3b82f6"; // gold for batter, blue for runners
  const startPos = path[0];

  return (
    <group>
      {/* Runner trail */}
      <line geometry={trailGeo}>
        <lineBasicMaterial color={color} transparent opacity={0.3} />
      </line>

      {/* Runner dot */}
      <mesh ref={meshRef} position={[startPos.x, 0.5, startPos.z]}>
        <sphereGeometry args={[2.5, 12, 12]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} />
      </mesh>

      {/* Score flash (if runner scores) */}
      {scores && <ScoreFlash runnerRef={meshRef} />}
    </group>
  );
}

/**
 * Flash effect at home plate when a runner scores.
 * Triggers when the runner mesh gets close to home plate (origin).
 */
function ScoreFlash({ runnerRef }) {
  const ringRef = useRef();
  const flashedRef = useRef(false);

  useFrame(() => {
    if (!ringRef.current) return;

    // Flash when runner is near home plate
    if (runnerRef?.current && !flashedRef.current) {
      const pos = runnerRef.current.position;
      const distToHome = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
      if (distToHome < 10) {
        flashedRef.current = true;
        ringRef.current.visible = true;
      }
    }

    if (ringRef.current.visible) {
      const scale = ringRef.current.scale.x + 0.5;
      if (scale > 15) {
        ringRef.current.visible = false;
        return;
      }
      ringRef.current.scale.set(scale, scale, 1);
      ringRef.current.material.opacity = Math.max(0, 0.8 - scale / 15);
    }
  });

  return (
    <mesh ref={ringRef} position={[0, 0.2, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <ringGeometry args={[2, 3.5, 32]} />
      <meshBasicMaterial color="#fbbf24" transparent opacity={0.8} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

export { BASES, computeRunnerMovements };
