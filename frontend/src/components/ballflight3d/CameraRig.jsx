import { useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Camera presets for different viewing angles.
 * Each defines a position and lookAt target.
 */
const CAMERA_PRESETS = {
  // Classic broadcast angle — closer and lower for better launch angle visibility
  broadcast: {
    position: [0, 100, 110],
    lookAt: [0, 10, -130],
    fov: 50,
  },
  // Center field camera — behind the pitcher looking at the batter
  centerField: {
    position: [0, 60, -350],
    lookAt: [0, 5, 0],
    fov: 30,
  },
  // Overhead / blimp view
  overhead: {
    position: [0, 400, -100],
    lookAt: [0, 0, -120],
    fov: 50,
  },
  // First base side
  firstBase: {
    position: [200, 60, -30],
    lookAt: [0, 20, -120],
    fov: 45,
  },
  // Third base side
  thirdBase: {
    position: [-200, 60, -30],
    lookAt: [0, 20, -120],
    fov: 45,
  },
  // Batter's eye — behind the batter looking out
  battersEye: {
    position: [0, 8, 15],
    lookAt: [0, 30, -200],
    fov: 65,
  },
};

/**
 * Camera system with smooth transitions between presets and ball-following mode.
 *
 * Props:
 *  - preset: key from CAMERA_PRESETS
 *  - followBall: if true, camera tracks the ball position
 *  - ballPosition: { x, y, z } current ball position (Three.js coords)
 *  - transitionSpeed: how fast the camera transitions (default 2)
 */
export default function CameraRig({
  preset = "broadcast",
  followBall = false,
  ballPosition,
  transitionSpeed = 2,
}) {
  const { camera } = useThree();
  const targetPos = useRef(new THREE.Vector3());
  const targetLook = useRef(new THREE.Vector3());
  const currentLook = useRef(new THREE.Vector3(0, 0, -150));

  // Set initial camera position
  useEffect(() => {
    const p = CAMERA_PRESETS[preset] || CAMERA_PRESETS.broadcast;
    camera.position.set(...p.position);
    camera.fov = p.fov;
    camera.updateProjectionMatrix();
    currentLook.current.set(...p.lookAt);
    camera.lookAt(currentLook.current);
  }, []);

  useFrame((_, delta) => {
    const p = CAMERA_PRESETS[preset] || CAMERA_PRESETS.broadcast;
    const speed = transitionSpeed * delta;

    if (followBall && ballPosition) {
      // Follow mode: position behind and above the ball's path
      const bx = ballPosition.x || 0;
      const by = ballPosition.y || 0;
      const bz = ballPosition.z || 0;

      // Camera orbits slightly behind the ball's horizontal direction
      const offsetBack = 80;
      const offsetUp = 40 + by * 0.3;
      const angle = Math.atan2(bx, bz);

      targetPos.current.set(
        bx + Math.sin(angle) * offsetBack * 0.3,
        offsetUp,
        bz + offsetBack
      );
      targetLook.current.set(bx, Math.max(by, 0), bz);
    } else {
      targetPos.current.set(...p.position);
      targetLook.current.set(...p.lookAt);
    }

    // Smooth lerp camera position
    camera.position.lerp(targetPos.current, speed);

    // Smooth lerp lookAt
    currentLook.current.lerp(targetLook.current, speed);
    camera.lookAt(currentLook.current);

    // Smoothly transition FOV
    const targetFov = CAMERA_PRESETS[preset]?.fov || 45;
    if (Math.abs(camera.fov - targetFov) > 0.1) {
      camera.fov += (targetFov - camera.fov) * speed;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}

export { CAMERA_PRESETS };
