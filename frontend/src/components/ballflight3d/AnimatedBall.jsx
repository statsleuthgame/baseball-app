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
  onAnimationComplete,
  onProgress,
  animationSpeed = 1,
  isPlaying = true,
}) {
  const ballRef = useRef();
  const trailRef = useRef();
  const glowRef = useRef();
  const progressRef = useRef(0);
  const [landed, setLanded] = useState(false);
  const trailPositions = useRef([]);

  const baseColor = useMemo(() => velocityColor(exitVelo), [exitVelo]);
  const accentColor = useMemo(
    () => (isHit ? new THREE.Color("#22c55e") : new THREE.Color("#ef4444")),
    [isHit]
  );

  // Ball glow intensity based on exit velo
  const glowIntensity = exitVelo >= 100 ? 3 : exitVelo >= 95 ? 2 : 1;

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
    if (!isPlaying || !sampledPoints?.length || landed) return;

    // Advance time
    progressRef.current += delta * animationSpeed;
    const t = Math.min(progressRef.current, duration);
    const frac = t / duration;
    const idx = Math.min(Math.floor(frac * (sampledPoints.length - 1)), sampledPoints.length - 2);
    const localFrac = frac * (sampledPoints.length - 1) - idx;

    // Interpolate position
    const p0 = sampledPoints[idx];
    const p1 = sampledPoints[idx + 1];
    const x = p0.x + (p1.x - p0.x) * localFrac;
    const y = p0.z + (p1.z - p0.z) * localFrac; // z in physics = y in Three.js (up)
    const z = -(p0.y + (p1.y - p0.y) * localFrac); // y in physics = -z in Three.js (into screen)

    if (ballRef.current) {
      ballRef.current.position.set(x, Math.max(y, 0), z);

      // Ball gets smaller at apex (distance effect) and larger close up
      const distFromCamera = ballRef.current.position.length();
      const scale = Math.max(0.5, Math.min(2, distFromCamera / 200));
      ballRef.current.scale.setScalar(scale);
    }

    if (glowRef.current) {
      glowRef.current.position.set(x, Math.max(y, 0), z);
      // Pulse glow
      const pulse = 1 + Math.sin(t * 10) * 0.15;
      glowRef.current.scale.setScalar(pulse * 3);
    }

    // Report progress for fielder animation
    onProgress?.(frac, { x, y: Math.max(y, 0), z });

    // Update trail
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

      // Color fades from base color (old) to bright white (newest)
      const age = i / len;
      const r = baseColor.r * (1 - age * 0.3) + age * 0.3;
      const g = baseColor.g * (1 - age * 0.3) + age * 0.3;
      const b = baseColor.b * (1 - age * 0.3) + age * 0.3;
      colAttr.setXYZ(i, r, g, b);
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    trailGeo.setDrawRange(0, len);

    // Check if landed
    if (t >= duration) {
      setLanded(true);
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

      {/* Ball glow (larger transparent sphere) */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[2, 16, 16]} />
        <meshBasicMaterial
          color={baseColor}
          transparent
          opacity={0.15 * glowIntensity}
          depthWrite={false}
        />
      </mesh>

      {/* The baseball itself */}
      <mesh ref={ballRef}>
        <sphereGeometry args={[1.2, 16, 16]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive={baseColor}
          emissiveIntensity={0.5}
          roughness={0.3}
        />
      </mesh>

      {/* Landing impact effect (shows after ball lands) */}
      {landed && <LandingImpact position={sampledPoints[sampledPoints.length - 1]} accentColor={accentColor} exitVelo={exitVelo} />}
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

  const pos = useMemo(() => {
    if (!position) return [0, 0, 0];
    return [position.x, 0.1, -position.y];
  }, [position]);

  // Number of rings based on exit velo
  const numRings = exitVelo >= 100 ? 3 : exitVelo >= 90 ? 2 : 1;

  useFrame((_, delta) => {
    timeRef.current += delta;
    const t = timeRef.current;

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
