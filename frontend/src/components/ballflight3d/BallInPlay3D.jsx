import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import Field3D from "./Field3D";
import AnimatedBall from "./AnimatedBall";
import CameraRig, { CAMERA_PRESETS } from "./CameraRig";
import {
  computeTrajectory,
  sampleTrajectory,
  sprayAngleFromMLBAM,
} from "./trajectoryPhysics";

const CAMERA_LABELS = {
  broadcast: "Broadcast",
  centerField: "Center Field",
  overhead: "Overhead",
  firstBase: "1B Side",
  thirdBase: "3B Side",
  battersEye: "Batter's Eye",
};

/**
 * 3D Ball-In-Play Visualization.
 *
 * Drop-in replacement / enhancement for BallInPlayVisual.
 * Uses React Three Fiber for a full 3D ball flight experience.
 *
 * Props:
 *  - hitData: { x, y, exitVelo, launchAngle, distance, trajectory, event }
 *             x/y in MLBAM coordinates
 *  - venueTeamId: team ID for stadium shape
 */
export default function BallInPlay3D({ hitData, venueTeamId }) {
  const [cameraPreset, setCameraPreset] = useState("broadcast");
  const [followBall, setFollowBall] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showMetrics, setShowMetrics] = useState(false);
  const [ballPos, setBallPos] = useState(null);
  const animFrameRef = useRef(0);

  // Compute trajectory from hit data
  const { sampledPoints, duration, apexHeight } = useMemo(() => {
    if (!hitData) return { sampledPoints: [], duration: 0, apexHeight: 0 };

    const sprayAngle = sprayAngleFromMLBAM(hitData.x, hitData.y);
    const traj = computeTrajectory(
      hitData.exitVelo || 90,
      hitData.launchAngle || 20,
      sprayAngle,
      hitData.distance,
      hitData.trajectory
    );
    const sampled = sampleTrajectory(traj, 150);
    return {
      sampledPoints: sampled,
      duration: traj.duration,
      apexHeight: traj.apexHeight,
    };
  }, [hitData]);

  // Auto-start animation after a short delay
  useEffect(() => {
    if (!hitData) return;
    setIsPlaying(false);
    setShowMetrics(false);
    setFollowBall(true);
    setCameraPreset("broadcast");

    const timer = setTimeout(() => setIsPlaying(true), 500);
    return () => clearTimeout(timer);
  }, [hitData]);

  const handleAnimationComplete = useCallback(() => {
    setFollowBall(false);
    // Show metrics with a slight delay for dramatic effect
    setTimeout(() => setShowMetrics(true), 300);
  }, []);

  const handleReplay = useCallback(() => {
    setIsPlaying(false);
    setShowMetrics(false);
    setFollowBall(true);
    // Small delay then restart
    setTimeout(() => setIsPlaying(true), 200);
  }, []);

  if (!hitData) return null;

  const event = hitData.event || "";
  const isHit = ["Single", "Double", "Triple", "Home Run"].includes(event);
  const accentColor = isHit ? "#22c55e" : "#ef4444";
  const isHomeRun = event === "Home Run";

  const trajLabel = isHomeRun
    ? "HOME RUN"
    : {
        fly_ball: "Fly Ball",
        line_drive: "Line Drive",
        ground_ball: "Ground Ball",
        popup: "Popup",
      }[hitData.trajectory] || "Batted Ball";

  const evLabel =
    hitData.exitVelo >= 100
      ? "BARRELED"
      : hitData.exitVelo >= 95
      ? "HARD HIT"
      : hitData.exitVelo >= 85
      ? "MEDIUM"
      : "SOFT";

  // Animation speed: slightly faster for ground balls, slower for deep flies
  const animSpeed = hitData.trajectory === "ground_ball" ? 1.5 : 1;

  return (
    <div className="bip3d-container">
      {/* 3D Canvas */}
      <div className="bip3d-canvas-wrap">
        <Canvas
          camera={{ fov: 45, near: 1, far: 2000, position: [0, 120, 80] }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: true }}
          style={{ background: "linear-gradient(180deg, #0a0e1a 0%, #0f1a0f 100%)" }}
        >
          {/* Lighting */}
          <ambientLight intensity={0.4} />
          <directionalLight position={[100, 200, 50]} intensity={0.8} color="#ffffff" />
          <directionalLight position={[-50, 100, -100]} intensity={0.3} color="#b4c7ff" />

          {/* Subtle stadium lights */}
          <pointLight position={[200, 150, -200]} intensity={0.5} color="#ffffcc" distance={500} />
          <pointLight position={[-200, 150, -200]} intensity={0.5} color="#ffffcc" distance={500} />
          <pointLight position={[0, 150, 50]} intensity={0.3} color="#ffffcc" distance={500} />

          {/* Night sky stars */}
          <Stars radius={400} depth={50} count={1500} factor={3} saturation={0} fade speed={0.5} />

          {/* Camera system */}
          <CameraRig
            preset={cameraPreset}
            followBall={followBall && isPlaying}
            ballPosition={ballPos}
            transitionSpeed={2}
          />

          {/* The field */}
          <Field3D venueTeamId={venueTeamId} />

          {/* Animated ball + trail */}
          {isPlaying && (
            <AnimatedBall
              sampledPoints={sampledPoints}
              duration={duration}
              exitVelo={hitData.exitVelo || 90}
              isHit={isHit}
              onAnimationComplete={handleAnimationComplete}
              animationSpeed={animSpeed}
              isPlaying={isPlaying}
            />
          )}

          {/* Fog for depth */}
          <fog attach="fog" args={["#0a0e1a", 300, 800]} />
        </Canvas>

        {/* Event label overlay (top) */}
        <div className="bip3d-event-label" style={{ color: accentColor }}>
          {isHomeRun && <span className="bip3d-hr-icon">💥</span>}
          {trajLabel}
        </div>

        {/* Camera controls overlay */}
        <div className="bip3d-camera-controls">
          {Object.entries(CAMERA_LABELS).map(([key, label]) => (
            <button
              key={key}
              className={`bip3d-cam-btn ${cameraPreset === key ? "active" : ""}`}
              onClick={() => {
                setCameraPreset(key);
                setFollowBall(false);
              }}
            >
              {label}
            </button>
          ))}
          <button
            className={`bip3d-cam-btn ${followBall ? "active" : ""}`}
            onClick={() => setFollowBall(true)}
          >
            Follow Ball
          </button>
        </div>

        {/* Replay button */}
        {showMetrics && (
          <button className="bip3d-replay-btn" onClick={handleReplay}>
            ↻ Replay
          </button>
        )}
      </div>

      {/* Metrics panel (slides in after landing) */}
      <div className={`bip3d-metrics ${showMetrics ? "visible" : ""}`}>
        <div className="bip3d-metrics-main">
          {hitData.exitVelo && (
            <div className="bip3d-metric">
              <span className="bip3d-metric-val" style={{ color: accentColor }}>
                {hitData.exitVelo}
              </span>
              <span className="bip3d-metric-unit">mph</span>
              <span className="bip3d-metric-label">EXIT VELO</span>
            </div>
          )}
          {hitData.distance && (
            <div className="bip3d-metric">
              <span className="bip3d-metric-val" style={{ color: accentColor }}>
                {hitData.distance}
              </span>
              <span className="bip3d-metric-unit">ft</span>
              <span className="bip3d-metric-label">DISTANCE</span>
            </div>
          )}
          {hitData.launchAngle != null && (
            <div className="bip3d-metric">
              <span className="bip3d-metric-val" style={{ color: accentColor }}>
                {hitData.launchAngle}°
              </span>
              <span className="bip3d-metric-unit">&nbsp;</span>
              <span className="bip3d-metric-label">LAUNCH ANGLE</span>
            </div>
          )}
          {apexHeight > 10 && (
            <div className="bip3d-metric">
              <span className="bip3d-metric-val" style={{ color: accentColor }}>
                {Math.round(apexHeight)}
              </span>
              <span className="bip3d-metric-unit">ft</span>
              <span className="bip3d-metric-label">APEX HEIGHT</span>
            </div>
          )}
        </div>
        <div className="bip3d-metrics-tags">
          <span className="bip3d-tag" style={{ borderColor: accentColor, color: accentColor }}>
            {trajLabel}
          </span>
          <span className="bip3d-tag" style={{ borderColor: accentColor, color: accentColor }}>
            {evLabel}
          </span>
          {isHomeRun && (
            <span className="bip3d-tag hr-tag">HOME RUN</span>
          )}
        </div>
      </div>
    </div>
  );
}
