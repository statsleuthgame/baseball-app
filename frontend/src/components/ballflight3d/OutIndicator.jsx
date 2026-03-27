import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * 3D "OUT" indicator that flashes above a position.
 *
 * Shows an expanding red ring burst + a floating red sphere
 * that pulses and fades out.
 *
 * Props:
 *  - position: { x, y, z } in Three.js coords where the out happened
 */
export default function OutIndicator({ position }) {
  const groupRef = useRef();
  const ring1Ref = useRef();
  const ring2Ref = useRef();
  const sphereRef = useRef();
  const timeRef = useRef(0);

  const x = position?.x || 0;
  const y = (position?.y || 0) + 8;
  const z = position?.z || 0;

  useFrame((_, delta) => {
    timeRef.current += delta;
    const t = timeRef.current;

    // Expanding rings
    if (ring1Ref.current) {
      const scale = 1 + t * 20;
      if (scale > 30) {
        ring1Ref.current.visible = false;
      } else {
        ring1Ref.current.scale.set(scale, scale, 1);
        ring1Ref.current.material.opacity = Math.max(0, 0.8 - t * 0.4);
      }
    }

    if (ring2Ref.current) {
      const age = Math.max(0, t - 0.1);
      const scale = 1 + age * 18;
      if (scale > 30) {
        ring2Ref.current.visible = false;
      } else {
        ring2Ref.current.scale.set(scale, scale, 1);
        ring2Ref.current.material.opacity = Math.max(0, 0.6 - age * 0.35);
      }
    }

    // Pulsing sphere rises and fades
    if (sphereRef.current) {
      const rise = Math.min(t * 8, 12);
      sphereRef.current.position.set(x, y + rise, z);
      const pulse = 1 + Math.sin(t * 12) * 0.3;
      sphereRef.current.scale.setScalar(pulse * 3);
      if (t > 2) {
        sphereRef.current.material.opacity = Math.max(0, 1 - (t - 2) * 0.8);
      }
    }
  });

  return (
    <group ref={groupRef}>
      {/* Burst rings at the out position */}
      <mesh ref={ring1Ref} position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.5, 3, 32]} />
        <meshBasicMaterial
          color="#ef4444"
          transparent
          opacity={0.8}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      <mesh ref={ring2Ref} position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1, 2.5, 32]} />
        <meshBasicMaterial
          color="#ff6666"
          transparent
          opacity={0.6}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Glowing red sphere that rises */}
      <mesh ref={sphereRef} position={[x, y, z]}>
        <sphereGeometry args={[2, 16, 16]} />
        <meshBasicMaterial
          color="#ef4444"
          transparent
          opacity={0.9}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
