import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

/**
 * 3D "OUT" indicator that flashes above a position.
 *
 * Shows a small expanding red ring + "OUT" text overlay.
 *
 * Props:
 *  - position: { x, y, z } in Three.js coords where the out happened
 */
export default function OutIndicator({ position }) {
  const ringRef = useRef();
  const ring2Ref = useRef();
  const timeRef = useRef(0);
  const doneRef = useRef(false);

  const x = position?.x || 0;
  const y = (position?.y || 0) + 5;
  const z = position?.z || 0;

  useFrame((_, delta) => {
    if (doneRef.current) return;
    timeRef.current += delta;
    const t = timeRef.current;

    if (t > 3) { doneRef.current = true; return; }

    if (ringRef.current) {
      const scale = 1 + t * 6;
      if (scale > 10) {
        ringRef.current.visible = false;
      } else {
        ringRef.current.scale.set(scale, scale, 1);
        ringRef.current.material.opacity = Math.max(0, 0.7 - t * 0.35);
      }
    }

    if (ring2Ref.current) {
      const age = Math.max(0, t - 0.08);
      const scale = 1 + age * 5;
      if (scale > 10) {
        ring2Ref.current.visible = false;
      } else {
        ring2Ref.current.scale.set(scale, scale, 1);
        ring2Ref.current.material.opacity = Math.max(0, 0.5 - age * 0.3);
      }
    }
  });

  return (
    <group>
      {/* Small burst rings */}
      <mesh ref={ringRef} position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.8, 1.5, 24]} />
        <meshBasicMaterial
          color="#ef4444"
          transparent
          opacity={0.7}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      <mesh ref={ring2Ref} position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5, 1.2, 24]} />
        <meshBasicMaterial
          color="#ff6666"
          transparent
          opacity={0.5}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* "OUT" text as HTML overlay */}
      <Html position={[x, y + 6, z]} center distanceFactor={200} zIndexRange={[100, 0]}>
        <div
          style={{
            color: "#ef4444",
            fontSize: "28px",
            fontWeight: 900,
            fontFamily: "'Segoe UI', system-ui, sans-serif",
            textShadow: "0 0 12px rgba(239,68,68,0.8), 0 0 24px rgba(239,68,68,0.4), 0 2px 4px rgba(0,0,0,0.8)",
            letterSpacing: "4px",
            userSelect: "none",
            pointerEvents: "none",
            animation: "outFlash 0.6s ease-out",
          }}
        >
          OUT
        </div>
      </Html>
    </group>
  );
}
