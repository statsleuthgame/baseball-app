import { useMemo, useRef, useEffect } from "react";
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

// Shared bowl constants
const FENCE_H = 10;
const PUSH_BACK = 25;
const RISER_H = 3;
const TREAD_D = 4;
const TIER1_ROWS = 8;
const TIER2_ROWS = 6;
const CONCOURSE_H = 6;
const CONCOURSE_D = 8;
const SEGMENTS = 48;
const PHI_START = Math.PI * 0.15;
const PHI_LENGTH = Math.PI * 0.70;

/**
 * Procedural 3D stadium background.
 * Seating bowl, instanced seat blocks, city skyline, sky dome.
 */
export default function StadiumBackground({ fencePoints, teamColors }) {
  const seatMeshRef = useRef();
  const primaryColor = teamColors?.primary || "#2a3a5c";
  const secondaryColor = teamColors?.secondary || "#1a2a4c";

  // Compute center and radius of the fence arc for positioning
  const { bowlRadius } = useMemo(() => {
    if (!fencePoints?.length) return {};
    let cx = 0, cz = 0;
    for (const [x, , z] of fencePoints) { cx += x; cz += z; }
    cx /= fencePoints.length;
    cz /= fencePoints.length;

    let maxR = 0;
    for (const [x, , z] of fencePoints) {
      const d = Math.sqrt((x - cx) ** 2 + (z - cz) ** 2);
      if (d > maxR) maxR = d;
    }
    return { bowlRadius: maxR };
  }, [fencePoints]);

  const innerR = bowlRadius ? bowlRadius + PUSH_BACK : 0;

  // Seating bowl geometry — stair-step cross-section revolved around Y axis
  const bowlGeo = useMemo(() => {
    if (!innerR) return null;

    const profile = [];
    let y = FENCE_H;
    let r = innerR;

    // Tier 1
    for (let i = 0; i < TIER1_ROWS; i++) {
      profile.push(new THREE.Vector2(r, y));
      y += RISER_H;
      profile.push(new THREE.Vector2(r, y));
      r += TREAD_D;
      profile.push(new THREE.Vector2(r, y));
    }

    // Concourse gap
    profile.push(new THREE.Vector2(r, y));
    y += CONCOURSE_H;
    profile.push(new THREE.Vector2(r, y));
    r += CONCOURSE_D;
    profile.push(new THREE.Vector2(r, y));

    // Tier 2
    for (let i = 0; i < TIER2_ROWS; i++) {
      profile.push(new THREE.Vector2(r, y));
      y += RISER_H;
      profile.push(new THREE.Vector2(r, y));
      r += TREAD_D;
      profile.push(new THREE.Vector2(r, y));
    }

    // Back wall drops to ground
    profile.push(new THREE.Vector2(r, y));
    profile.push(new THREE.Vector2(r, 0));

    const geo = new THREE.LatheGeometry(profile, SEGMENTS, PHI_START, PHI_LENGTH);
    geo.computeVertexNormals();
    return geo;
  }, [innerR]);

  // Fascia accent strip — thin ring at concourse level with team color
  const fasciaGeo = useMemo(() => {
    if (!innerR) return null;
    const fasciaY = FENCE_H + RISER_H * TIER1_ROWS;
    const fasciaR = innerR + TREAD_D * TIER1_ROWS;

    const profile = [
      new THREE.Vector2(fasciaR - 1, fasciaY),
      new THREE.Vector2(fasciaR - 1, fasciaY + 6),
      new THREE.Vector2(fasciaR + 1, fasciaY + 6),
      new THREE.Vector2(fasciaR + 1, fasciaY),
    ];

    return new THREE.LatheGeometry(profile, SEGMENTS, PHI_START, PHI_LENGTH);
  }, [innerR]);

  // Instanced seat section blocks
  const seatBlockGeo = useMemo(() => new THREE.BoxGeometry(10, 1.0, 2.5), []);

  const { seatCount, seatMatrices, seatColorArray } = useMemo(() => {
    if (!innerR) return { seatCount: 0, seatMatrices: null, seatColorArray: null };

    const matrices = [];
    const colors = [];
    const dummy = new THREE.Object3D();
    const priColor = new THREE.Color(primaryColor);
    const secColor = new THREE.Color(secondaryColor);

    const blockWidth = 10;
    const gap = 2;

    const addRow = (rowR, rowY) => {
      // Arc length at this radius
      const arcLen = rowR * PHI_LENGTH;
      const blocksPerRow = Math.floor(arcLen / (blockWidth + gap));
      if (blocksPerRow < 1) return;

      const angularStep = PHI_LENGTH / blocksPerRow;
      const halfStep = angularStep * 0.5;

      for (let b = 0; b < blocksPerRow; b++) {
        const phi = PHI_START + halfStep + angularStep * b;

        // LatheGeometry convention: x = r*cos(phi), z = r*sin(phi)
        const x = rowR * Math.cos(phi);
        const z = rowR * Math.sin(phi);

        dummy.position.set(x, rowY, z);
        // Rotate so block faces inward (toward field center)
        dummy.rotation.set(0, -phi + Math.PI / 2, 0);
        dummy.updateMatrix();

        const mat = new THREE.Matrix4();
        mat.copy(dummy.matrix);
        matrices.push(mat);

        // Alternate colors by section (every ~4 blocks)
        const section = Math.floor(b / 4);
        const c = section % 2 === 0 ? priColor : secColor;
        colors.push(c.r, c.g, c.b);
      }
    };

    // Tier 1 rows
    for (let i = 0; i < TIER1_ROWS; i++) {
      const rowR = innerR + TREAD_D * i + TREAD_D / 2;
      const rowY = FENCE_H + RISER_H * (i + 1) + 0.5;
      addRow(rowR, rowY);
    }

    // Tier 2 rows (after concourse)
    const tier2BaseR = innerR + TREAD_D * TIER1_ROWS + CONCOURSE_D;
    const tier2BaseY = FENCE_H + RISER_H * TIER1_ROWS + CONCOURSE_H;
    for (let i = 0; i < TIER2_ROWS; i++) {
      const rowR = tier2BaseR + TREAD_D * i + TREAD_D / 2;
      const rowY = tier2BaseY + RISER_H * (i + 1) + 0.5;
      addRow(rowR, rowY);
    }

    const count = matrices.length;
    const matArray = new Float32Array(count * 16);
    for (let i = 0; i < count; i++) {
      matrices[i].toArray(matArray, i * 16);
    }

    return {
      seatCount: count,
      seatMatrices: matArray,
      seatColorArray: new Float32Array(colors),
    };
  }, [innerR, primaryColor, secondaryColor]);

  // Apply instance matrices and colors
  useEffect(() => {
    if (!seatMeshRef.current || !seatMatrices || seatCount === 0) return;
    const mesh = seatMeshRef.current;
    const mat4 = new THREE.Matrix4();

    for (let i = 0; i < seatCount; i++) {
      mat4.fromArray(seatMatrices, i * 16);
      mesh.setMatrixAt(i, mat4);
    }
    mesh.instanceMatrix.needsUpdate = true;

    mesh.instanceColor = new THREE.InstancedBufferAttribute(seatColorArray, 3);
    mesh.instanceColor.needsUpdate = true;
  }, [seatCount, seatMatrices, seatColorArray]);

  // City skyline — merged boxes + window dots
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

    const minDist = maxFenceDist + 250;
    const buildings = [];
    const windows = [];
    const rng = mulberry32(42);

    const count = 70;
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
  }, [bowlRadius, maxFenceDist]);

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
      {/* Seating bowl (concrete) */}
      <mesh geometry={bowlGeo}>
        <meshLambertMaterial color="#3a3a50" side={THREE.DoubleSide} />
      </mesh>

      {/* Instanced seat section blocks */}
      {seatCount > 0 && (
        <instancedMesh
          ref={seatMeshRef}
          args={[seatBlockGeo, null, seatCount]}
          frustumCulled={false}
        >
          <meshLambertMaterial vertexColors />
        </instancedMesh>
      )}

      {/* Fascia accent with team color */}
      {fasciaGeo && (
        <mesh geometry={fasciaGeo}>
          <meshLambertMaterial color={primaryColor} emissive={primaryColor} emissiveIntensity={0.3} side={THREE.DoubleSide} />
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
