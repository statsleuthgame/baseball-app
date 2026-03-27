import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Stars, Html } from "@react-three/drei";
import Field3D from "./Field3D";
import AnimatedBall from "./AnimatedBall";
import Fielders3D from "./Fielders3D";
import BaseRunners3D, { getTeamColor } from "./BaseRunners3D";
import CameraRig from "./CameraRig";
import ThrowToBase, { parseThrowTargets } from "./ThrowToBase";
import OutIndicator from "./OutIndicator";
import {
  isHitEvent, isOutEvent, isFlyOut, isGroundOut,
  isDoublePlay as isDoublePlayEvent, eventDisplayLabel,
} from "./eventClassifier";
import {
  computeTrajectory,
  sampleTrajectory,
  sprayAngleFromMLBAM,
} from "./trajectoryPhysics";


/**
 * 3D Ball-In-Play Visualization.
 *
 * Drop-in replacement / enhancement for BallInPlayVisual.
 * Uses React Three Fiber for a full 3D ball flight experience.
 *
 * Props:
 *  - hitData: { x, y, exitVelo, launchAngle, distance, trajectory, event, description }
 *             x/y in MLBAM coordinates
 *  - venueTeamId: team ID for stadium shape
 *  - runnersOn: { first: bool, second: bool, third: bool } — runners on base
 */
export default function BallInPlay3D({ hitData, venueTeamId, runnersOn }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [showMetrics, setShowMetrics] = useState(false);
  const [ballPos, setBallPos] = useState(null);
  const [ballProgress, setBallProgress] = useState(0);
  const [throwIndex, setThrowIndex] = useState(-1); // -1 = no throw, 0+ = which throw in chain
  const [throwFromPos, setThrowFromPos] = useState(null);
  const [outPositions, setOutPositions] = useState([]); // array of positions for OUT indicators
  const timersRef = useRef([]);

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

  // Compute landing position in Three.js coords for fielders
  const landingPos = useMemo(() => {
    if (!sampledPoints?.length) return null;
    const last = sampledPoints[sampledPoints.length - 1];
    return { x: last.x, z: -last.y }; // y in physics = -z in Three.js
  }, [sampledPoints]);

  // Determine throw chain (only ground-type outs, not fly outs/popups)
  const throwTargets = useMemo(() => {
    const ev = hitData?.event || "";
    if (!isOutEvent(ev)) return [];
    if (isFlyOut(ev)) return [];
    return parseThrowTargets(hitData?.description);
  }, [hitData]);

  // Auto-start animation after a short delay
  useEffect(() => {
    if (!hitData) return;
    timersRef.current.forEach(id => clearTimeout(id));
    timersRef.current = [];
    setIsPlaying(false);
    setShowMetrics(false);
    setBallProgress(0);
    setThrowIndex(-1);
    setThrowFromPos(null);
    setOutPositions([]);

    const timer = setTimeout(() => setIsPlaying(true), 500);
    timersRef.current.push(timer);
    return () => {
      timersRef.current.forEach(id => clearTimeout(id));
      timersRef.current = [];
    };
  }, [hitData]);

  const BASE_POS = {
    first: { x: 63.64, y: 3, z: -63.64 },
    second: { x: 0, y: 3, z: -127.28 },
    third: { x: -63.64, y: 3, z: -63.64 },
    home: { x: 0, y: 3, z: 0 },
  };

  const handleAnimationComplete = useCallback(() => {
    const ev = hitData?.event || "";
    const isOutPlay = isOutEvent(ev);

    if (isOutPlay && throwTargets.length > 0 && landingPos) {
      // Ground out with throw(s) — start first throw from fielder
      setThrowFromPos(landingPos);
      setThrowIndex(0);
    } else if (isOutPlay) {
      // Fly out / popup — show OUT at catch position
      setOutPositions([landingPos ? { x: landingPos.x, y: 5, z: landingPos.z } : null]);
      timersRef.current.push(setTimeout(() => setShowMetrics(true), 800));
    } else {
      timersRef.current.push(setTimeout(() => setShowMetrics(true), 300));
    }
  }, [hitData, throwTargets, landingPos]);

  const handleThrowComplete = useCallback(() => {
    // Current throw arrived — show OUT at that base
    const currentTarget = throwTargets[throwIndex];
    const outPos = BASE_POS[currentTarget];
    setOutPositions(prev => [...prev, outPos]);

    const nextIndex = throwIndex + 1;
    if (nextIndex < throwTargets.length) {
      // Chain: start next throw from the base we just threw to
      const fromBase = BASE_POS[currentTarget];
      setThrowFromPos({ x: fromBase.x, z: fromBase.z });
      setThrowIndex(nextIndex);
    } else {
      // All throws done
      timersRef.current.push(setTimeout(() => setShowMetrics(true), 800));
    }
  }, [throwTargets, throwIndex]);

  const handleProgress = useCallback((progress, pos) => {
    setBallProgress(progress);
    setBallPos(pos);
  }, []);

  const handleReplay = useCallback(() => {
    timersRef.current.forEach(id => clearTimeout(id));
    timersRef.current = [];
    setIsPlaying(false);
    setShowMetrics(false);
    setBallProgress(0);
    setThrowIndex(-1);
    setThrowFromPos(null);
    setOutPositions([]);
    timersRef.current.push(setTimeout(() => setIsPlaying(true), 200));
  }, []);

  const teamColor = getTeamColor(venueTeamId);

  if (!hitData) return null;

  const event = hitData.event || "";
  const isHit = isHitEvent(event);
  const isOut = isOutEvent(event);
  const accentColor = isHit ? "#22c55e" : "#ef4444";
  const isHomeRun = event === "Home Run";

  const trajType = {
    fly_ball: "Fly Ball",
    line_drive: "Line Drive",
    ground_ball: "Ground Ball",
    popup: "Popup",
  }[hitData.trajectory] || "Batted Ball";

  const displayEvent = eventDisplayLabel(event);
  const trajLabel = isHomeRun
    ? "HOME RUN"
    : displayEvent
      ? `${trajType} — ${displayEvent}`
      : trajType;

  const evLabel =
    hitData.exitVelo >= 100
      ? "BARRELED"
      : hitData.exitVelo >= 95
      ? "HARD HIT"
      : hitData.exitVelo >= 85
      ? "MEDIUM"
      : "SOFT";

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
            preset="broadcast"
            followBall={false}
            ballPosition={ballPos}
            transitionSpeed={2}
          />

          {/* The field */}
          <Field3D venueTeamId={venueTeamId} />

          {/* Fielders */}
          <Fielders3D
            landingPos={landingPos}
            isOut={isOut}
            description={hitData.description || ""}
            ballProgress={ballProgress}
            isAnimating={isPlaying}
            teamColor={teamColor}
          />

          {/* Base runners */}
          <BaseRunners3D
            runnersOn={runnersOn}
            event={event}
            description={hitData.description || ""}
            ballProgress={ballProgress}
            isAnimating={isPlaying}
            teamColor={teamColor}
          />

          {/* Animated ball + trail */}
          {isPlaying && (
            <AnimatedBall
              sampledPoints={sampledPoints}
              duration={duration}
              exitVelo={hitData.exitVelo || 90}
              isHit={isHit}
              isHomeRun={isHomeRun}
              onAnimationComplete={handleAnimationComplete}
              onProgress={handleProgress}
              animationSpeed={animSpeed}
              isPlaying={isPlaying}
            />
          )}

          {/* Throw to base (ground outs / double plays) */}
          {throwIndex >= 0 && throwFromPos && throwTargets[throwIndex] && (
            <ThrowToBase
              key={`throw-${throwIndex}`}
              fromPos={throwFromPos}
              targetBase={throwTargets[throwIndex]}
              onComplete={handleThrowComplete}
              throwSpeed={0.5}
            />
          )}

          {/* OUT indicators */}
          {outPositions.map((pos, i) => pos && <OutIndicator key={`out-${i}`} position={pos} />)}

          {/* Fog for depth */}
          <fog attach="fog" args={["#0a0e1a", 300, 800]} />
        </Canvas>

        {/* Event label overlay (top) */}
        <div className="bip3d-event-label" style={{ color: accentColor }}>
          {isHomeRun && <span className="bip3d-hr-icon">💥</span>}
          {trajLabel}
        </div>


        {/* Metrics overlay (fades in at bottom of canvas after landing) */}
        <div className={`bip3d-metrics-overlay ${showMetrics ? "visible" : ""}`}>
          <div className="bip3d-metrics-main">
            {hitData.exitVelo && (
              <div className="bip3d-metric">
                <span className="bip3d-metric-val" style={{ color: accentColor }}>{hitData.exitVelo}</span>
                <span className="bip3d-metric-unit">mph</span>
              </div>
            )}
            {hitData.distance && (
              <div className="bip3d-metric">
                <span className="bip3d-metric-val" style={{ color: accentColor }}>{hitData.distance}</span>
                <span className="bip3d-metric-unit">ft</span>
              </div>
            )}
            {hitData.launchAngle != null && (
              <div className="bip3d-metric">
                <span className="bip3d-metric-val" style={{ color: accentColor }}>{hitData.launchAngle}°</span>
                <span className="bip3d-metric-unit">LA</span>
              </div>
            )}
            {apexHeight > 10 && (
              <div className="bip3d-metric">
                <span className="bip3d-metric-val" style={{ color: accentColor }}>{Math.round(apexHeight)}</span>
                <span className="bip3d-metric-unit">ft apex</span>
              </div>
            )}
          </div>
          <div className="bip3d-metrics-tags">
            <span className="bip3d-tag" style={{ borderColor: accentColor, color: accentColor }}>{evLabel}</span>
            {isHomeRun && <span className="bip3d-tag hr-tag">HR</span>}
          </div>
        </div>

      </div>
    </div>
  );
}
