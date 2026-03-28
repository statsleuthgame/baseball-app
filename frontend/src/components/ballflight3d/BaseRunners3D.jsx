import { useRef, useMemo, useEffect, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import ALL_TEAMS from "../../data/teams";
import { isOutEvent, batterBasesForEvent } from "./eventClassifier";

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

export function getTeamColor(teamId) {
  return ALL_TEAMS[teamId]?.primary || "#3b82f6";
}

const BASE_MAP = { "1B": 1, "2B": 2, "3B": 3, "score": 4 };

/**
 * Convert MLB API runner data directly to movements.
 * Each runner has: { start, end, isOut, name }
 * start: null (batter) | "1B" | "2B" | "3B"
 * end: null (out without base) | "1B" | "2B" | "3B" | "score"
 */
function computeRunnerMovements(event, runnersOn, description = "", apiRunners = []) {
  // If we have API runner data, use it directly — no guessing
  if (apiRunners?.length > 0) {
    return apiRunners.map((r) => {
      const from = r.start ? (BASE_MAP[r.start] || 0) : 0;
      const to = r.end ? (BASE_MAP[r.end] || 0) : (r.isOut ? Math.min(from + 1, 4) : from);
      return {
        from,
        to,
        scores: r.end === "score",
        isOut: r.isOut,
        isBatter: !r.start, // null start = batter from home
      };
    }).filter((m) => m.from !== m.to || m.isOut); // skip runners that don't move
  }

  // Fallback: basic logic when API data not available (replays without runner data)
  const movements = [];
  const batterBases = batterBasesForEvent(event);
  if (runnersOn?.third) movements.push({ from: 3, to: 4, scores: true });
  if (runnersOn?.second) movements.push({ from: 2, to: Math.min(2 + batterBases, 4), scores: 2 + batterBases >= 4 });
  if (runnersOn?.first) movements.push({ from: 1, to: Math.min(1 + batterBases, 4), scores: 1 + batterBases >= 4 });
  movements.push({ from: 0, to: Math.min(batterBases, 4), scores: batterBases >= 4, isBatter: true });
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
  runnerNames = {},
  event = "",
  description = "",
  apiRunners,
  ballProgress = 0,
  isAnimating = false,
  teamColor = "#3b82f6",
}) {
  const movements = useMemo(
    () => computeRunnerMovements(event, runnersOn, description, apiRunners),
    [event, runnersOn, description, apiRunners]
  );

  // Map each movement to a last name — prefer API runner names
  const movementNames = useMemo(() => {
    if (apiRunners?.length > 0) {
      return movements.map((m, i) => apiRunners[i]?.name || "");
    }
    const baseNameMap = { 1: "first", 2: "second", 3: "third" };
    return movements.map((m) => {
      if (m.isBatter) return runnerNames?.batter || "";
      const key = baseNameMap[m.from];
      return key ? (runnerNames?.[key] || "") : "";
    });
  }, [movements, runnerNames, apiRunners]);

  const paths = useMemo(
    () => movements.map((m) => getRunnerPath(m.from, m.to)),
    [movements]
  );

  const isOutPlay = isOutEvent(event);

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
          {runnersOn?.first && !animatedBases.has("first") && <StaticRunner position={BASES.first} color={teamColor} name={runnerNames?.first} />}
          {runnersOn?.second && !animatedBases.has("second") && <StaticRunner position={BASES.second} color={teamColor} name={runnerNames?.second} />}
          {runnersOn?.third && !animatedBases.has("third") && <StaticRunner position={BASES.third} color={teamColor} name={runnerNames?.third} />}
        </>
      )}

      {isAnimating && movements.map((movement, i) => (
        <AnimatedRunner
          key={`${movement.from}-${movement.to}-${movement.isBatter ? 'b' : 'r'}`}
          path={paths[i]}
          ballProgress={ballProgress}
          scores={movement.scores}
          startDelay={movement.isBatter ? 0.15 : 0}
          numBases={Math.min(movement.to - movement.from, 4)}
          color={teamColor}
          fadeAtEnd={movement.isOut}
          name={movementNames[i]}
        />
      ))}
    </group>
  );
}

const SUFFIXES = new Set(["Jr.", "Jr", "Sr.", "Sr", "II", "III", "IV", "V"]);

function RunnerLabel({ name, opacity = 1 }) {
  if (!name) return null;
  const parts = name.split(" ");
  // Get last name, but skip suffixes like Jr., II, III
  let last = parts.length > 1 ? parts[parts.length - 1] : name;
  if (SUFFIXES.has(last) && parts.length > 2) {
    last = parts[parts.length - 2] + " " + last;
  }
  if (opacity <= 0) return null;
  return (
    <Html position={[0, 9, 0]} center distanceFactor={250} zIndexRange={[50, 0]}>
      <div style={{
        color: "#fff", fontSize: "10px", fontWeight: 700, textShadow: "0 1px 4px rgba(0,0,0,0.9)",
        whiteSpace: "nowrap", pointerEvents: "none", userSelect: "none",
        opacity,
      }}>{last}</div>
    </Html>
  );
}

function StaticRunner({ position, color, name }) {
  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[2.5, 12, 12]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} />
      </mesh>
      <RunnerLabel name={name} />
    </group>
  );
}

/**
 * Animated runner — straight lines, constant speed, no stopping.
 */
function AnimatedRunner({ path, ballProgress, scores, startDelay = 0, numBases = 1, color, fadeAtEnd = false, name }) {
  const meshRef = useRef();
  const matRef = useRef();
  const [labelOpacity, setLabelOpacity] = useState(1);
  const elapsedRef = useRef(0);
  const startedRef = useRef(false);
  const trailPositions = useRef([]);

  // Reset animation state when path changes (replay or new play)
  useEffect(() => {
    elapsedRef.current = 0;
    startedRef.current = false;
    trailPositions.current = [];
  }, [path]);

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

    // Fade out batter on outs when approaching the base
    if (fadeAtEnd && runProgress > 0.6) {
      const fade = Math.max(0, 1 - (runProgress - 0.6) / 0.4);
      if (matRef.current) matRef.current.opacity = 0.9 * fade;
      setLabelOpacity(fade);
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

      <group ref={meshRef} position={[startPos.x, 0.5, startPos.z]}>
        <mesh>
          <sphereGeometry args={[2.5, 12, 12]} />
          <meshBasicMaterial ref={matRef} color={color} transparent opacity={0.9} />
        </mesh>
        <RunnerLabel name={name} opacity={labelOpacity} />
      </group>

      {scores && <ScoreFlash runnerRef={meshRef} color={color} />}
    </group>
  );
}

function ScoreFlash({ runnerRef, color }) {
  const ringRef = useRef();
  const flashedRef = useRef(false);

  useFrame((_, delta) => {
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
      const scale = ringRef.current.scale.x + delta * 30;
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

export { BASES, computeRunnerMovements };
