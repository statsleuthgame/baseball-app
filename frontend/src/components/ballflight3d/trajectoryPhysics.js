/**
 * Ball flight trajectory physics engine.
 *
 * Given exit velocity (mph), launch angle (deg), spray angle (deg), and
 * optional hit distance (ft), computes a 3D parabolic arc with simplified
 * aerodynamic drag.  Returns an array of { x, y, z } points in feet,
 * where home plate is the origin, +x is toward first base, +y is
 * straight-away center field, and +z is up.
 *
 * Physics references:
 *  - Prof. Alan Nathan's trajectory calculator
 *  - Simplified drag model: F_drag = ½ ρ C_d A v²
 */

const G = 32.174; // ft/s² gravity
const RHO = 0.0023769; // air density slug/ft³ (sea level, ~70°F)
const CD = 0.35; // drag coefficient for a baseball
const BALL_RADIUS = 0.121; // ft (2.9 inches diameter / 2)
const BALL_AREA = Math.PI * BALL_RADIUS * BALL_RADIUS;
const BALL_MASS = 0.3125; // slugs (5 oz / 16 = 0.3125 lb, already in slugs ≈ 0.00971 but let's use lbs and adjust)

// Use simpler drag factor: k = ½ ρ CD A / m
// With mass in lbs (divide G out), we work in ft/s units directly.
// Effective drag deceleration = k * v²  where k ≈ 0.0015 per foot (empirical fit)
const DRAG_K = 0.0015;

const DEG_TO_RAD = Math.PI / 180;
const MPH_TO_FPS = 5280 / 3600; // 1.4667

/**
 * Compute spray angle from MLBAM coordinates.
 * Returns degrees: 0 = center, negative = left field, positive = right field.
 */
export function sprayAngleFromMLBAM(hitX, hitY, hpX = 125.42, hpY = 198.27) {
  const dx = hitX - hpX;
  const dy = hpY - hitY; // flip Y (MLBAM Y increases downward)
  return Math.atan2(dx, dy) * (180 / Math.PI);
}

/**
 * Estimate horizontal distance from MLBAM coordinates.
 * Each MLBAM unit ≈ 2.495671 feet.
 */
export function distanceFromMLBAM(hitX, hitY, hpX = 125.42, hpY = 198.27) {
  const dx = hitX - hpX;
  const dy = hpY - hitY;
  return Math.sqrt(dx * dx + dy * dy) * 2.495671;
}

/**
 * Generate a 3D trajectory.
 *
 * @param {number} exitVeloMph   Exit velocity in mph
 * @param {number} launchAngleDeg Launch angle in degrees (0 = flat, 90 = straight up)
 * @param {number} sprayAngleDeg  Spray angle in degrees (0 = center, + = right field)
 * @param {number} [targetDistFt] Known total distance in feet (used to calibrate drag)
 * @param {string} [trajectory]   "fly_ball" | "line_drive" | "ground_ball" | "popup"
 * @returns {{ points: Array<{x:number,y:number,z:number}>, duration: number, apexHeight: number }}
 */
export function computeTrajectory(exitVeloMph, launchAngleDeg, sprayAngleDeg, targetDistFt, trajectory) {
  // Ground balls get a dedicated simple trajectory
  if (trajectory === "ground_ball") {
    return computeGroundBall(exitVeloMph, sprayAngleDeg, targetDistFt);
  }

  const v0 = exitVeloMph * MPH_TO_FPS;
  const la = launchAngleDeg * DEG_TO_RAD;
  const sa = sprayAngleDeg * DEG_TO_RAD;

  // Initial velocity components
  const vHoriz = v0 * Math.cos(la); // horizontal speed
  const vz0 = v0 * Math.sin(la);    // vertical speed

  // Horizontal direction (spray angle: 0 = +y center field)
  const vx0 = vHoriz * Math.sin(sa); // toward right field (+x)
  const vy0 = vHoriz * Math.cos(sa); // toward center field (+y)

  // Adaptive drag to hit target distance if known
  let dragK = DRAG_K;
  if (targetDistFt && targetDistFt > 50) {
    dragK = calibrateDrag(v0, la, sa, targetDistFt);
  }

  // Simulate with RK4-lite (Euler with small dt is fine for display)
  const dt = 0.01; // seconds
  const maxT = 15;  // max 15 seconds
  const points = [];

  let x = 0, y = 0, z = 3; // start at ~3ft (bat height)
  let vx = vx0, vy = vy0, vz = vz0;
  let t = 0;
  let apexHeight = z;
  let landed = false;

  points.push({ x, y, z, t });

  while (t < maxT && !landed) {
    t += dt;

    // Speed
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const dragAccel = dragK * speed; // deceleration magnitude per velocity component

    // Update velocities
    if (speed > 0.1) {
      vx -= dragAccel * vx / speed * dt * speed;
      vy -= dragAccel * vy / speed * dt * speed;
      vz -= (G + dragAccel * vz / speed * speed) * dt;
    } else {
      vz -= G * dt;
    }

    // Update position
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;

    if (z > apexHeight) apexHeight = z;

    if (z <= 0) {
      z = 0;
      landed = true;
    }

    points.push({ x, y, z, t });
  }

  return {
    points,
    duration: t,
    apexHeight,
  };
}

/**
 * Simple ground ball trajectory: short hop off bat then rolls/decelerates to target distance.
 */
function computeGroundBall(exitVeloMph, sprayAngleDeg, targetDistFt) {
  const dist = targetDistFt || 90;
  const sa = sprayAngleDeg * DEG_TO_RAD;
  const dirX = Math.sin(sa);
  const dirY = Math.cos(sa);

  // Ground ball speed (mph → fps), mostly horizontal
  const speed0 = exitVeloMph * MPH_TO_FPS * 0.85; // some energy lost hitting ground
  // Time to travel target distance with linear deceleration
  // d = v0*t - 0.5*a*t²; v_final = 0 → a = v0/t → d = 0.5*v0*t → t = 2d/v0
  const totalTime = (2 * dist) / speed0;

  const dt = 0.01;
  const points = [];
  let t = 0;
  const hopHeight = 2; // small initial hop off the bat (feet)
  const hopDuration = 0.25; // seconds for initial hop

  while (t <= totalTime) {
    const progress = t / totalTime;
    // Linear deceleration: distance = dist * (2*progress - progress²)
    const d = dist * (2 * progress - progress * progress);
    const x = d * dirX;
    const y = d * dirY;

    // Small hop at the start, then stays on ground with tiny bounces
    let z;
    if (t < hopDuration) {
      // Initial hop arc
      const hopProgress = t / hopDuration;
      z = hopHeight * Math.sin(hopProgress * Math.PI);
    } else {
      // Small diminishing bounces
      const bounceT = t - hopDuration;
      const bounceAmp = Math.max(0, 0.8 * Math.exp(-bounceT * 4));
      z = bounceAmp * Math.abs(Math.sin(bounceT * 12));
    }

    points.push({ x, y, z, t });
    t += dt;
  }

  // Ensure final point is exactly at target
  points.push({ x: dist * dirX, y: dist * dirY, z: 0, t: totalTime });

  return {
    points,
    duration: totalTime,
    apexHeight: hopHeight,
  };
}

/**
 * Binary-search for a drag coefficient that makes the ball land at targetDist.
 */
function calibrateDrag(v0, launchAngleRad, sprayAngleRad, targetDist) {
  let lo = 0.0001;
  let hi = 0.01;

  for (let iter = 0; iter < 20; iter++) {
    const mid = (lo + hi) / 2;
    const dist = simulateDistance(v0, launchAngleRad, sprayAngleRad, mid);
    if (dist > targetDist) {
      lo = mid; // more drag needed
    } else {
      hi = mid; // less drag needed
    }
  }
  return (lo + hi) / 2;
}

function simulateDistance(v0, la, sa, dragK) {
  const dt = 0.02;
  const vHoriz = v0 * Math.cos(la);
  let vx = vHoriz * Math.sin(sa);
  let vy = vHoriz * Math.cos(sa);
  let vz = v0 * Math.sin(la);
  let x = 0, y = 0, z = 3;
  let t = 0;

  while (t < 15 && z > 0) {
    t += dt;
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (speed > 0.1) {
      const d = dragK * speed;
      vx -= d * vx / speed * dt * speed;
      vy -= d * vy / speed * dt * speed;
      vz -= (G + d * vz / speed * speed) * dt;
    } else {
      vz -= G * dt;
    }
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
  }
  return Math.sqrt(x * x + y * y);
}

/**
 * Sample the trajectory at N evenly-spaced time steps for smooth animation.
 */
export function sampleTrajectory(traj, numSamples = 120) {
  const { points, duration } = traj;
  if (!points.length) return [];

  const sampled = [];
  for (let i = 0; i <= numSamples; i++) {
    const targetT = (i / numSamples) * duration;
    // Find surrounding points
    let lo = 0;
    let hi = points.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (points[mid].t <= targetT) lo = mid;
      else hi = mid;
    }
    const p0 = points[lo];
    const p1 = points[hi];
    const frac = p1.t === p0.t ? 0 : (targetT - p0.t) / (p1.t - p0.t);
    sampled.push({
      x: p0.x + (p1.x - p0.x) * frac,
      y: p0.y + (p1.y - p0.y) * frac,
      z: p0.z + (p1.z - p0.z) * frac,
      t: targetT,
    });
  }
  return sampled;
}
