import { useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Sky dome vertex shader: gradient based on vertex Y position
const skyVertexShader = `
  varying float vWorldY;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldY = worldPos.y;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

// Sky dome fragment shader: blue sky gradient
const skyFragmentShader = `
  varying float vWorldY;
  void main() {
    float t = clamp(vWorldY / 500.0, -0.3, 1.0);
    // Below horizon: light haze
    vec3 belowHorizon = vec3(0.55, 0.62, 0.7);    // soft blue-gray
    // Horizon: pale blue
    vec3 horizon = vec3(0.45, 0.6, 0.8);           // light sky blue
    // Zenith: deeper blue
    vec3 zenith = vec3(0.15, 0.3, 0.6);            // rich blue

    vec3 color;
    if (t < 0.0) {
      color = mix(belowHorizon, horizon, t + 1.0);
    } else {
      color = mix(horizon, zenith, t);
    }
    gl_FragColor = vec4(color, 1.0);
  }
`;

/**
 * Procedural 3D stadium background.
 * Seating bowl, light towers, city skyline, sky dome.
 */
export default function StadiumBackground({ fencePoints, teamColor }) {
  // Compute center and radius of the fence arc for positioning
  const { bowlCenter, bowlRadius, foulLeftAngle, foulRightAngle } = useMemo(() => {
    if (!fencePoints?.length) return {};
    let cx = 0, cz = 0;
    for (const [x, , z] of fencePoints) {
      cx += x;
      cz += z;
    }
    cx /= fencePoints.length;
    cz /= fencePoints.length;

    let maxR = 0;
    for (const [x, , z] of fencePoints) {
      const d = Math.sqrt((x - cx) ** 2 + (z - cz) ** 2);
      if (d > maxR) maxR = d;
    }

    // Foul pole angles (first and last fence points)
    const first = fencePoints[0];
    const last = fencePoints[fencePoints.length - 1];
    const foulLeftAngle = Math.atan2(first[2], first[0]);
    const foulRightAngle = Math.atan2(last[2], last[0]);

    return { bowlCenter: [cx, cz], bowlRadius: maxR, foulLeftAngle, foulRightAngle };
  }, [fencePoints]);

  // Seating bowl geometry — stair-step cross-section revolved around Y axis
  const bowlGeo = useMemo(() => {
    if (!bowlRadius) return null;

    const fenceH = 10;
    const pushBack = 25;
    const innerR = bowlRadius + pushBack;

    // Cross-section profile: riser/tread stair pattern for 2 tiers
    const profile = [];
    const riserH = 3;
    const treadD = 4;
    const tier1Rows = 8;
    const tier2Rows = 6;
    const concourseH = 6;
    const concourseD = 8;

    let y = fenceH;
    let r = innerR;

    // Tier 1
    for (let i = 0; i < tier1Rows; i++) {
      profile.push(new THREE.Vector2(r, y));
      y += riserH;
      profile.push(new THREE.Vector2(r, y));
      r += treadD;
      profile.push(new THREE.Vector2(r, y));
    }

    // Concourse gap
    profile.push(new THREE.Vector2(r, y));
    y += concourseH;
    profile.push(new THREE.Vector2(r, y));
    r += concourseD;
    profile.push(new THREE.Vector2(r, y));

    // Tier 2
    for (let i = 0; i < tier2Rows; i++) {
      profile.push(new THREE.Vector2(r, y));
      y += riserH;
      profile.push(new THREE.Vector2(r, y));
      r += treadD;
      profile.push(new THREE.Vector2(r, y));
    }

    // Back wall drops to ground
    profile.push(new THREE.Vector2(r, y));
    profile.push(new THREE.Vector2(r, 0));

    // About 270 degrees of coverage — leave center field open
    // phiStart and phiLength in radians
    const segments = 48;
    const phiStart = Math.PI * 0.15;  // start slightly past right field
    const phiLength = Math.PI * 0.70; // ~252 degrees coverage

    const geo = new THREE.LatheGeometry(profile, segments, phiStart, phiLength);
    geo.computeVertexNormals();
    return geo;
  }, [bowlRadius]);

  // Fascia accent strip — thin ring at concourse level with team color
  const fasciaGeo = useMemo(() => {
    if (!bowlRadius) return null;
    const pushBack = 25;
    const innerR = bowlRadius + pushBack;
    const fenceH = 10;
    const riserH = 3;
    const tier1Rows = 8;
    const fasciaY = fenceH + riserH * tier1Rows;
    const fasciaR = innerR + 4 * tier1Rows;

    const segments = 48;
    const phiStart = Math.PI * 0.15;
    const phiLength = Math.PI * 0.70;

    const profile = [
      new THREE.Vector2(fasciaR - 1, fasciaY),
      new THREE.Vector2(fasciaR - 1, fasciaY + 6),
      new THREE.Vector2(fasciaR + 1, fasciaY + 6),
      new THREE.Vector2(fasciaR + 1, fasciaY),
    ];

    const geo = new THREE.LatheGeometry(profile, segments, phiStart, phiLength);
    return geo;
  }, [bowlRadius]);

  // City skyline — merged boxes + window dots
  // Compute max fence distance from home plate (origin) for proper placement
  const maxFenceDist = useMemo(() => {
    if (!fencePoints?.length) return 400;
    let maxD = 0;
    for (const [x, , z] of fencePoints) {
      const d = Math.sqrt(x * x + z * z);
      if (d > maxD) maxD = d;
    }
    return maxD;
  }, [fencePoints]);

  const { skylineGeo, windowGeo } = useMemo(() => {
    if (!bowlRadius) return {};

    // Place buildings well behind the stadium bowl (500+ ft from home plate)
    const minDist = maxFenceDist + 250;
    const buildings = [];
    const windows = [];
    const rng = mulberry32(42); // deterministic seed

    const count = 70;
    // Arc behind the outfield: roughly center field direction
    const arcStart = Math.PI * 0.25;
    const arcEnd = Math.PI * 0.75;

    for (let i = 0; i < count; i++) {
      const angle = arcStart + (arcEnd - arcStart) * rng();
      const dist = minDist + rng() * 200;
      const x = Math.cos(angle) * dist;
      const z = -Math.sin(angle) * dist;
      const h = 40 + rng() * 160;
      const w = 8 + rng() * 20;
      const d = 8 + rng() * 20;

      const box = new THREE.BoxGeometry(w, h, d);
      box.translate(x, h / 2, z);
      buildings.push(box);

      // Scatter a few window dots on each building
      const numWindows = Math.floor(2 + rng() * 6);
      for (let j = 0; j < numWindows; j++) {
        const wy = 5 + rng() * (h - 10);
        const side = rng() > 0.5 ? 1 : -1;
        const wx = x + side * (w / 2 + 0.1);
        const wz = z + (rng() - 0.5) * d * 0.6;
        const win = new THREE.PlaneGeometry(1.5, 1.5);
        win.rotateY(side > 0 ? 0 : Math.PI);
        win.translate(wx, wy, wz);
        windows.push(win);
      }
    }

    const skylineGeo = mergeGeometries(buildings, false);
    buildings.forEach(g => g.dispose());

    const windowGeo = windows.length > 0 ? mergeGeometries(windows, false) : null;
    windows.forEach(g => g.dispose());

    return { skylineGeo, windowGeo };
  }, [bowlRadius]);

  // Sky dome shader material
  const skyMat = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: skyVertexShader,
      fragmentShader: skyFragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
    });
  }, []);

  if (!bowlGeo) return null;

  return (
    <group>
      {/* Seating bowl */}
      <mesh geometry={bowlGeo}>
        <meshLambertMaterial color="#3a3a50" side={THREE.DoubleSide} />
      </mesh>

      {/* Fascia accent with team color */}
      {fasciaGeo && (
        <mesh geometry={fasciaGeo}>
          <meshLambertMaterial color={teamColor || "#1a1a2e"} emissive={teamColor || "#000000"} emissiveIntensity={0.3} side={THREE.DoubleSide} />
        </mesh>
      )}


      {/* City skyline */}
      {skylineGeo && (
        <mesh geometry={skylineGeo}>
          <meshBasicMaterial color="#2a2a35" />
        </mesh>
      )}

      {/* Window dots */}
      {windowGeo && (
        <mesh geometry={windowGeo}>
          <meshBasicMaterial color="#ffd080" transparent opacity={0.7} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Sky dome */}
      <mesh material={skyMat}>
        <sphereGeometry args={[600, 24, 16]} />
      </mesh>
    </group>
  );
}

// Deterministic PRNG (Mulberry32)
function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
