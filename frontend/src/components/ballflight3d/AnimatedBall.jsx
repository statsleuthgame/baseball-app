import { useRef, useMemo, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Velocity-based color for the ball trail.
 * Blue (soft) → Yellow (medium) → Orange (hard) → Red/White (barreled)
 */
function velocityColor(exitVelo) {
  if (exitVelo >= 100) return new THREE.Color("#ff4444"); // barreled — hot red
  if (exitVelo >= 95) return new THREE.Color("#ff8c00");  // hard hit — orange
  if (exitVelo >= 85) return new THREE.Color("#ffd700");  // medium — gold
  return new THREE.Color("#4da6ff");                      // soft — cool blue
}

/**
 * Animated baseball that flies along a sampled trajectory path.
 *
 * Props:
 *  - sampledPoints: array of {x, y, z, t} in feet (from trajectoryPhysics)
 *  - duration: total flight time in seconds
 *  - exitVelo: exit velocity for coloring
 *  - isHit: boolean — green glow for hits, red for outs
 *  - onAnimationComplete: callback when ball lands
 *  - animationSpeed: playback speed multiplier (default 1)
 *  - isPlaying: whether the animation is currently active
 *  - onProgress: callback with (progress 0-1, {x,y,z} position) each frame
 */
export default function AnimatedBall({
  sampledPoints,
  duration,
  exitVelo = 90,
  isHit = true,
  isHomeRun = false,
  onAnimationComplete,
  onProgress,
  animationSpeed = 1,
  isPlaying = true,
}) {
  const ballRef = useRef();
  const progressRef = useRef(0);
  const landedRef = useRef(false);
  const [showImpact, setShowImpact] = useState(false); // only for render trigger
  const behindFenceRef = useRef(false);
  const trailPositions = useRef([]);

  const baseColor = useMemo(() => velocityColor(exitVelo), [exitVelo]);
  const accentColor = useMemo(
    () => (isHit ? new THREE.Color("#22c55e") : new THREE.Color("#ef4444")),
    [isHit]
  );

  // Pre-compute trail geometry buffer
  const maxTrailLength = 60;
  const trailGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(maxTrailLength * 3);
    const colors = new Float32Array(maxTrailLength * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setDrawRange(0, 0);
    return geo;
  }, []);

  useFrame((_, delta) => {
    if (!isPlaying || !sampledPoints?.length || landedRef.current) return;

    progressRef.current += delta * animationSpeed;
    const t = Math.min(progressRef.current, duration);
    const frac = t / duration;
    const idx = Math.min(Math.floor(frac * (sampledPoints.length - 1)), sampledPoints.length - 2);
    const localFrac = frac * (sampledPoints.length - 1) - idx;

    const p0 = sampledPoints[idx];
    const p1 = sampledPoints[idx + 1];
    const x = p0.x + (p1.x - p0.x) * localFrac;
    const y = p0.z + (p1.z - p0.z) * localFrac;
    const z = -(p0.y + (p1.y - p0.y) * localFrac);

    const pastFence = isHomeRun && frac > 0.7 && y < 10;
    if (pastFence) behindFenceRef.current = true;

    if (ballRef.current) {
      ballRef.current.position.set(x, Math.max(y, 0), z);
      ballRef.current.visible = !behindFenceRef.current;
      ballRef.current.scale.setScalar(1);
    }


    onProgress?.(frac, { x, y: Math.max(y, 0), z });

    if (behindFenceRef.current) {
      if (trailPositions.current.length > 0) {
        trailPositions.current = [];
        trailGeo.setDrawRange(0, 0);
      }
    } else {
      trailPositions.current.push([x, Math.max(y, 0), z]);
      if (trailPositions.current.length > maxTrailLength) {
        trailPositions.current.shift();
      }

      const posAttr = trailGeo.getAttribute("position");
      const colAttr = trailGeo.getAttribute("color");
      const len = trailPositions.current.length;

      for (let i = 0; i < len; i++) {
        const [px, py, pz] = trailPositions.current[i];
        posAttr.setXYZ(i, px, py, pz);
        const age = i / len;
        colAttr.setXYZ(i,
          baseColor.r * (1 - age * 0.3) + age * 0.3,
          baseColor.g * (1 - age * 0.3) + age * 0.3,
          baseColor.b * (1 - age * 0.3) + age * 0.3,
        );
      }

      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      trailGeo.setDrawRange(0, len);
    }

    if (t >= duration) {
      landedRef.current = true;
      setShowImpact(true);
      onAnimationComplete?.();
    }
  });

  if (!sampledPoints?.length) return null;

  return (
    <group>
      {/* Ball trail */}
      <line geometry={trailGeo}>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={0.8}
          linewidth={2}
        />
      </line>

      {/* The baseball — flashes green (hit) or red (out) */}
      <mesh ref={ballRef}>
        <sphereGeometry args={[1.2, 16, 16]} />
        <meshLambertMaterial
          color={isHit ? "#22c55e" : "#ef4444"}
          emissive={isHit ? "#22c55e" : "#ef4444"}
          emissiveIntensity={0.4}
        />
      </mesh>

      {/* Landing impact effect (shows after ball lands) */}
      {showImpact && <LandingImpact position={sampledPoints[sampledPoints.length - 1]} accentColor={accentColor} exitVelo={exitVelo} />}
    </group>
  );
}

/**
 * Expanding ring ripple effect at the landing spot.
 */
function LandingImpact({ position, accentColor, exitVelo }) {
  const ring1Ref = useRef();
  const ring2Ref = useRef();
  const ring3Ref = useRef();
  const timeRef = useRef(0);
  const doneRef = useRef(false);

  const pos = useMemo(() => {
    if (!position) return [0, 0, 0];
    return [position.x, 0.1, -position.y];
  }, [position]);

  const numRings = exitVelo >= 100 ? 3 : exitVelo >= 90 ? 2 : 1;

  useFrame((_, delta) => {
    if (doneRef.current) return;
    timeRef.current += delta;
    const t = timeRef.current;
    if (t > 3) { doneRef.current = true; return; }

    const animateRing = (ref, delay) => {
      if (!ref.current) return;
      const age = Math.max(0, t - delay);
      if (age > 2) {
        ref.current.visible = false;
        return;
      }
      ref.current.visible = true;
      const scale = 1 + age * 15;
      ref.current.scale.set(scale, scale, 1);
      ref.current.material.opacity = Math.max(0, 0.6 - age * 0.3);
    };

    animateRing(ring1Ref, 0);
    animateRing(ring2Ref, 0.15);
    animateRing(ring3Ref, 0.3);
  });

  return (
    <group position={pos}>
      <mesh ref={ring1Ref} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.5, 2.5, 32]} />
        <meshBasicMaterial color={accentColor} transparent opacity={0.6} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {numRings >= 2 && (
        <mesh ref={ring2Ref} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.5, 2.5, 32]} />
          <meshBasicMaterial color={accentColor} transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
      {numRings >= 3 && (
        <mesh ref={ring3Ref} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.5, 2.5, 32]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}
