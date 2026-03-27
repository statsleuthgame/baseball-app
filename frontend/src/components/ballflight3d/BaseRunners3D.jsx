import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import ALL_TEAMS from "../../data/teams";

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

const BASE_ORDER = ["home", "first", "second", "third"];

function getTeamColor(teamId) {
  return ALL_TEAMS[teamId]?.primary || "#3b82f6";
}

function computeRunnerMovements(event, runnersOn, description = "") {
  const movements = [];
  const desc = description.toLowerCase();
  const isOut = event === "Out";
  const batterBases = {
    "Single": 1, "Double": 2, "Triple": 3, "Home Run": 4,
  }[event] || 0;

  const runners = [];
  if (runnersOn?.third) runners.push({ base: 3 });
  if (runnersOn?.second) runners.push({ base: 2 });
  if (runnersOn?.first) runners.push({ base: 1 });

  if (isOut) {
    const isSacFly = desc.includes("sac fly") || desc.includes("sacrifice fly") ||
      (desc.includes("scores") && (desc.includes("flies out") || desc.includes("fly")));
    const isDoublePlay = desc.includes("double play");

    if (isSacFly) {
      // Sac fly: runner on third scores, batter is out
      if (runnersOn?.third) {
        movements.push({ from: 3, to: 4, scores: true, startDelay: 0.3 });
      }
      // Other runners tag up but stay
      movements.push({ from: 0, to: 1, scores: false, isBatter: true, isOut: true });
    } else if (isDoublePlay) {
      // Double play: batter runs to first (out), lead runner out at next base
      // Typical: runner on 1st forced at 2nd, batter out at 1st
      if (runnersOn?.first) {
        movements.push({ from: 1, to: 2, scores: false, isOut: true });
      } else if (runnersOn?.second) {
        movements.push({ from: 2, to: 3, scores: false, isOut: true });
      }
      movements.push({ from: 0, to: 1, scores: false, isBatter: true, isOut: true });
      // Runner on third may score on a DP
      if (runnersOn?.third && desc.includes("scores")) {
        movements.push({ from: 3, to: 4, scores: true });
      }
    } else {
      // Simple out: batter runs to first
      movements.push({ from: 0, to: 1, scores: false, isBatter: true, isOut: true });
      // If description mentions a runner scoring (e.g. fielder's choice)
      if (desc.includes("scores") && runnersOn?.third) {
        movements.push({ from: 3, to: 4, scores: true });
      }
    }
    return movements;
  }

  // On a hit, advance all runners
  for (const runner of runners) {
    const newBase = runner.base + batterBases;
    movements.push({
      from: runner.base,
      to: Math.min(newBase, 4),
      scores: newBase >= 4,
    });
  }

  movements.push({
    from: 0,
    to: Math.min(batterBases, 4),
    scores: batterBases >= 4,
    isBatter: true,
  });

  return movements;
}

/**
 * Simple straight-line path through each base.
 * Evenly spaced points so runners move at constant speed.
 */
function getRunnerPath(fromBase, toBase) {
  const waypoints = [];
  let current = fromBase;
  while (current <= toBase && current <= 4) {
    const key = BASE_ORDER[current % 4];
    waypoints.push(BASES[key].clone());
    current++;
  }
  if (toBase >= 4 && fromBase !== 0) {
    waypoints.push(BASES.home.clone());
  }

  if (waypoints.length < 2) return waypoints;

  // Build evenly-spaced points along straight segments
  // First compute total path length
  let totalLen = 0;
  const segLens = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const d = waypoints[i].distanceTo(waypoints[i + 1]);
    segLens.push(d);
    totalLen += d;
  }

  // Sample at constant speed (equal distance between points)
  const numPoints = 60;
  const path = [];
  for (let i = 0; i <= numPoints; i++) {
    const targetDist = (i / numPoints) * totalLen;
    let accumulated = 0;
    for (let s = 0; s < segLens.length; s++) {
      if (accumulated + segLens[s] >= targetDist || s === segLens.length - 1) {
        const segFrac = segLens[s] > 0 ? (targetDist - accumulated) / segLens[s] : 0;
        const a = waypoints[s];
        const b = waypoints[s + 1];
        path.push(new THREE.Vector3(
          a.x + (b.x - a.x) * segFrac,
          0.5,
          a.z + (b.z - a.z) * segFrac,
        ));
        break;
      }
      accumulated += segLens[s];
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
 *  - teamColor: hex color string for the team
 */
export default function BaseRunners3D({
  runnersOn = {},
  event = "",
  description = "",
  ballProgress = 0,
  isAnimating = false,
  teamColor = "#3b82f6",
}) {
  const movements = useMemo(
    () => computeRunnerMovements(event, runnersOn, description),
    [event, runnersOn, description]
  );

  const paths = useMemo(
    () => movements.map((m) => getRunnerPath(m.from, m.to)),
    [movements]
  );

  const isOutPlay = event === "Out";

  // Figure out which bases have animated runners so we don't double-show them as static
  const animatedBases = useMemo(() => {
    const bases = new Set();
    for (const m of movements) {
      if (m.from === 1) bases.add("first");
      if (m.from === 2) bases.add("second");
      if (m.from === 3) bases.add("third");
    }
    return bases;
  }, [movements]);

  return (
    <group>
      {/* Show static runners when not animating, or on outs for runners that aren't moving */}
      {(!isAnimating || isOutPlay) && (
        <>
          {runnersOn?.first && !animatedBases.has("first") && <StaticRunner position={BASES.first} color={teamColor} />}
          {runnersOn?.second && !animatedBases.has("second") && <StaticRunner position={BASES.second} color={teamColor} />}
          {runnersOn?.third && !animatedBases.has("third") && <StaticRunner position={BASES.third} color={teamColor} />}
        </>
      )}

      {isAnimating && movements.map((movement, i) => (
        <AnimatedRunner
          key={i}
          path={paths[i]}
          ballProgress={ballProgress}
          scores={movement.scores}
          startDelay={movement.isBatter ? 0.15 : 0}
          numBases={Math.min(movement.to - movement.from, 4)}
          color={teamColor}
          fadeAtEnd={movement.isOut}
        />
      ))}
    </group>
  );
}

function StaticRunner({ position, color }) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[2.5, 12, 12]} />
      <meshBasicMaterial color={color} transparent opacity={0.9} />
    </mesh>
  );
}

/**
 * Animated runner — straight lines, constant speed, no stopping.
 */
function AnimatedRunner({ path, ballProgress, scores, startDelay = 0, numBases = 1, color, fadeAtEnd = false }) {
  const meshRef = useRef();
  const matRef = useRef();
  const elapsedRef = useRef(0);
  const startedRef = useRef(false);
  const trailPositions = useRef([]);

  // ~2.67 seconds per base (1.5x speed)
  const totalRunTime = numBases * 2.67;

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

    if (ballProgress > 0.5 + startDelay) {
      startedRef.current = true;
    }
    if (!startedRef.current) return;

    elapsedRef.current += delta;
    // Linear progress — constant speed, no easing, no stops
    const runProgress = Math.min(elapsedRef.current / totalRunTime, 1);

    const pathIdx = Math.min(Math.floor(runProgress * (path.length - 1)), path.length - 2);
    const pathFrac = runProgress * (path.length - 1) - pathIdx;

    const p0 = path[pathIdx];
    const p1 = path[pathIdx + 1] || p0;

    const x = p0.x + (p1.x - p0.x) * pathFrac;
    const z = p0.z + (p1.z - p0.z) * pathFrac;

    meshRef.current.position.set(x, 0.5, z);

    // Subtle bob while running
    if (runProgress > 0 && runProgress < 1) {
      const bob = Math.abs(Math.sin(elapsedRef.current * 6)) * 1.0;
      meshRef.current.position.y = 0.5 + bob;
    }

    // Fade out batter on outs when they reach the base
    if (fadeAtEnd && matRef.current && runProgress > 0.8) {
      matRef.current.opacity = 0.9 * (1 - (runProgress - 0.8) / 0.2);
    }

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
  const startPos = path[0];

  return (
    <group>
      <line geometry={trailGeo}>
        <lineBasicMaterial color={color} transparent opacity={0.3} />
      </line>

      <mesh ref={meshRef} position={[startPos.x, 0.5, startPos.z]}>
        <sphereGeometry args={[2.5, 12, 12]} />
        <meshBasicMaterial ref={matRef} color={color} transparent opacity={0.9} />
      </mesh>

      {scores && <ScoreFlash runnerRef={meshRef} color={color} />}
    </group>
  );
}

function ScoreFlash({ runnerRef, color }) {
  const ringRef = useRef();
  const flashedRef = useRef(false);

  useFrame(() => {
    if (!ringRef.current) return;

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
      <meshBasicMaterial color={color} transparent opacity={0.8} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

export { BASES, computeRunnerMovements, getTeamColor };
