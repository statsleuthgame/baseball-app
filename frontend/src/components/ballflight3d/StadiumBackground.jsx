import { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";

// ─── Sky Dome Shaders ────────────────────────────────────────────────
const skyVertexShader = `
  varying vec3 vWorldPos;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const skyFragmentShader = `
  varying vec3 vWorldPos;

  void main() {
    float y = vWorldPos.y;
    float t = clamp(y / 500.0, -0.3, 1.0);

    // Daytime sky gradient
    vec3 belowHorizon = vec3(0.6, 0.68, 0.75);   // hazy blue-gray
    vec3 horizon = vec3(0.52, 0.70, 0.88);        // pale sky blue
    vec3 mid = vec3(0.30, 0.55, 0.85);            // bright blue
    vec3 zenith = vec3(0.15, 0.35, 0.70);         // deep blue

    vec3 color;
    if (t < 0.0) {
      color = mix(belowHorizon, horizon, t + 1.0);
    } else if (t < 0.3) {
      color = mix(horizon, mid, t / 0.3);
    } else {
      color = mix(mid, zenith, (t - 0.3) / 0.7);
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;

// ─── Bowl Constants ──────────────────────────────────────────────────
const FENCE_H = 10;
const RISER_H = 2.5;
const TREAD_D = 3.5;
const TIER1_ROWS = 8;
const TIER2_ROWS = 6;
const CONCOURSE_H = 5;
const CONCOURSE_D = 6;
const PUSH_BACK = 15;

// ─── Simple seeded noise for mountain heights ────────────────────────
function pseudoNoise(x, seed) {
  const s = Math.sin(x * 127.1 + seed * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function mountainHeight(angle, seed, octaves) {
  let h = 0;
  let amp = 1;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    // Smoother, wider peaks: lower frequency multiplier
    h += pseudoNoise(angle * freq, seed + i * 13.37) * amp;
    amp *= 0.45;
    freq *= 1.6;
  }
  return h;
}

/**
 * Procedural 3D stadium background with mountain backdrop.
 */
export default function StadiumBackground({ fencePoints, teamColors }) {
  const seatMeshRef = useRef();
  const primaryColor = teamColors?.primary || "#2a3a5c";
  const secondaryColor = teamColors?.secondary || "#1a2a4c";

  // ─── Outward normals ────────────────────────────────────────────
  const normals = useMemo(() => {
    if (!fencePoints?.length) return [];
    return fencePoints.map(([x, , z]) => {
      const dist = Math.sqrt(x * x + z * z) || 1;
      return [x / dist, z / dist];
    });
  }, [fencePoints]);

  // ─── Bowl geometry ──────────────────────────────────────────────
  const bowlGeo = useMemo(() => {
    if (!fencePoints?.length || !normals.length) return null;

    const pts = fencePoints;
    const n = pts.length;
    const rows = [];
    let y = FENCE_H;
    let offset = PUSH_BACK;

    for (let i = 0; i < TIER1_ROWS; i++) {
      rows.push({ offset, y });
      y += RISER_H;
      offset += TREAD_D;
    }
    y += CONCOURSE_H;
    offset += CONCOURSE_D;
    for (let i = 0; i < TIER2_ROWS; i++) {
      rows.push({ offset, y });
      y += RISER_H;
      offset += TREAD_D;
    }
    rows.push({ offset, y });
    const topOffset = offset;

    const profilePts = [{ offset: PUSH_BACK, y: FENCE_H }];
    for (const r of rows) profilePts.push(r);
    profilePts.push({ offset: topOffset, y: 0 });

    const numProfile = profilePts.length;
    const vertices = new Float32Array(n * numProfile * 3);
    const indices = [];

    for (let f = 0; f < n; f++) {
      const [fx, , fz] = pts[f];
      const [nx, nz] = normals[f];
      for (let p = 0; p < numProfile; p++) {
        const { offset: off, y: py } = profilePts[p];
        const idx = (f * numProfile + p) * 3;
        vertices[idx] = fx + nx * off;
        vertices[idx + 1] = py;
        vertices[idx + 2] = fz + nz * off;
      }
    }

    for (let f = 0; f < n - 1; f++) {
      for (let p = 0; p < numProfile - 1; p++) {
        const bl = f * numProfile + p;
        const br = (f + 1) * numProfile + p;
        const tl = f * numProfile + p + 1;
        const tr = (f + 1) * numProfile + p + 1;
        indices.push(bl, br, tl);
        indices.push(tl, br, tr);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [fencePoints, normals]);

  // ─── Fascia ─────────────────────────────────────────────────────
  const fasciaGeo = useMemo(() => {
    if (!fencePoints?.length || !normals.length) return null;

    const pts = fencePoints;
    const n = pts.length;
    const fasciaOffset = PUSH_BACK + TREAD_D * TIER1_ROWS;
    const fasciaY = FENCE_H + RISER_H * TIER1_ROWS;

    const vertices = new Float32Array(n * 2 * 3);
    const indices = [];

    for (let f = 0; f < n; f++) {
      const [fx, , fz] = pts[f];
      const [nx, nz] = normals[f];
      const bx = fx + nx * fasciaOffset;
      const bz = fz + nz * fasciaOffset;
      vertices[(f * 2) * 3] = bx;
      vertices[(f * 2) * 3 + 1] = fasciaY;
      vertices[(f * 2) * 3 + 2] = bz;
      vertices[(f * 2 + 1) * 3] = bx;
      vertices[(f * 2 + 1) * 3 + 1] = fasciaY + CONCOURSE_H;
      vertices[(f * 2 + 1) * 3 + 2] = bz;
    }

    for (let f = 0; f < n - 1; f++) {
      const bl = f * 2;
      const tl = f * 2 + 1;
      const br = (f + 1) * 2;
      const tr = (f + 1) * 2 + 1;
      indices.push(bl, br, tl);
      indices.push(tl, br, tr);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [fencePoints, normals]);

  // ─── Seats ──────────────────────────────────────────────────────
  const seatBlockGeo = useMemo(() => new THREE.BoxGeometry(5, 1.6, 1.2), []);

  const { seatCount, seatMatrices, seatColorArray } = useMemo(() => {
    if (!fencePoints?.length || !normals.length)
      return { seatCount: 0, seatMatrices: null, seatColorArray: null };

    const pts = fencePoints;
    const n = pts.length;
    const matrices = [];
    const colors = [];
    const priColor = new THREE.Color(primaryColor);
    const secColor = new THREE.Color(secondaryColor);
    const priLight = new THREE.Color(primaryColor).lerp(new THREE.Color("#ffffff"), 0.15);
    const secLight = new THREE.Color(secondaryColor).lerp(new THREE.Color("#ffffff"), 0.15);
    const dummy = new THREE.Object3D();
    const seatSpacing = 6;

    let arcDist = 0;
    const fenceArcPositions = [{ idx: 0, arc: 0 }];
    for (let f = 1; f < n; f++) {
      const dx = pts[f][0] - pts[f - 1][0];
      const dz = pts[f][2] - pts[f - 1][2];
      arcDist += Math.sqrt(dx * dx + dz * dz);
      fenceArcPositions.push({ idx: f, arc: arcDist });
    }
    const totalArc = arcDist;
    const seatsPerRow = Math.floor(totalArc / seatSpacing);

    // Foul line angles
    let lfAngle = 0, rfAngle = 0;
    for (let f = 0; f < n; f++) {
      const [fx, , fz] = pts[f];
      if (fz > -80) continue;
      const angle = Math.atan2(fx, -fz);
      if (angle < lfAngle) lfAngle = angle;
      if (angle > rfAngle) rfAngle = angle;
    }
    lfAngle += 0.02;
    rfAngle -= 0.02;

    const addRow = (rowOffset, rowY, rowIdx) => {
      for (let s = 0; s < seatsPerRow; s++) {
        const targetArc = (s + 0.5) * seatSpacing;
        let fIdx = 0;
        for (let f = 1; f < fenceArcPositions.length; f++) {
          if (fenceArcPositions[f].arc >= targetArc) { fIdx = f - 1; break; }
          fIdx = f - 1;
        }
        if (fIdx >= n - 1) fIdx = n - 2;

        const f0 = fenceArcPositions[fIdx];
        const f1 = fenceArcPositions[fIdx + 1];
        const segLen = f1.arc - f0.arc;
        const t = segLen > 0 ? (targetArc - f0.arc) / segLen : 0;

        const fx = pts[fIdx][0] + (pts[fIdx + 1][0] - pts[fIdx][0]) * t;
        const fz = pts[fIdx][2] + (pts[fIdx + 1][2] - pts[fIdx][2]) * t;

        const seatAngle = Math.atan2(fx, -fz);
        if (seatAngle < lfAngle || seatAngle > rfAngle) continue;

        const nx = normals[fIdx][0] + (normals[fIdx + 1][0] - normals[fIdx][0]) * t;
        const nz = normals[fIdx][1] + (normals[fIdx + 1][1] - normals[fIdx][1]) * t;
        const nLen = Math.sqrt(nx * nx + nz * nz) || 1;

        const x = fx + (nx / nLen) * rowOffset;
        const z = fz + (nz / nLen) * rowOffset;

        const tanX = pts[fIdx + 1][0] - pts[fIdx][0];
        const tanZ = pts[fIdx + 1][2] - pts[fIdx][2];
        const angle = Math.atan2(tanX, tanZ);

        dummy.position.set(x, rowY, z);
        dummy.rotation.set(0, angle, 0);
        dummy.updateMatrix();

        const mat = new THREE.Matrix4();
        mat.copy(dummy.matrix);
        matrices.push(mat);

        const section = Math.floor(s / 6);
        const isOddRow = rowIdx % 2 === 1;
        let c;
        if ((section + rowIdx) % 2 === 0) {
          c = isOddRow ? priLight : priColor;
        } else {
          c = isOddRow ? secLight : secColor;
        }
        colors.push(c.r, c.g, c.b);
      }
    };

    for (let i = 0; i < TIER1_ROWS; i++) {
      const rowOffset = PUSH_BACK + TREAD_D * i + TREAD_D / 2;
      const rowY = FENCE_H + RISER_H * (i + 1) + 0.4;
      addRow(rowOffset, rowY, i);
    }

    const t2BaseOff = PUSH_BACK + TREAD_D * TIER1_ROWS + CONCOURSE_D;
    const t2BaseY = FENCE_H + RISER_H * TIER1_ROWS + CONCOURSE_H;
    for (let i = 0; i < TIER2_ROWS; i++) {
      const rowOffset = t2BaseOff + TREAD_D * i + TREAD_D / 2;
      const rowY = t2BaseY + RISER_H * (i + 1) + 0.4;
      addRow(rowOffset, rowY, TIER1_ROWS + i);
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
  }, [fencePoints, normals, primaryColor, secondaryColor]);

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

  // ─── Mountain ranges ────────────────────────────────────────────
  const mountainGeos = useMemo(() => {
    if (!fencePoints?.length || !normals.length) return [];

    const pts = fencePoints;
    const n = pts.length;

    const ranges = [
      { dist: 180, baseY: 0, peak: 100, color: "#2d4a2d", seed: 1.0,  octaves: 4, opacity: 0.95 }, // near — dark green forest
      { dist: 320, baseY: 0, peak: 180, color: "#3a5a5a", seed: 7.5,  octaves: 3, opacity: 0.85 }, // mid — blue-green ridgeline
      { dist: 500, baseY: 0, peak: 280, color: "#6a7a8a", seed: 15.3, octaves: 2, opacity: 0.70 }, // far — hazy gray-blue peaks
    ];

    return ranges.map((range) => {
      const { dist, baseY, peak, color, seed, octaves, opacity } = range;
      const segments = n * 2;
      const vertices = [];
      const indices = [];

      for (let i = 0; i <= segments; i++) {
        const frac = i / segments;
        const fIdx = Math.min(Math.floor(frac * (n - 1)), n - 2);
        const localFrac = frac * (n - 1) - fIdx;

        const fx = pts[fIdx][0] + (pts[fIdx + 1][0] - pts[fIdx][0]) * localFrac;
        const fz = pts[fIdx][2] + (pts[fIdx + 1][2] - pts[fIdx][2]) * localFrac;
        const nx = normals[fIdx][0] + (normals[fIdx + 1][0] - normals[fIdx][0]) * localFrac;
        const nz = normals[fIdx][1] + (normals[fIdx + 1][1] - normals[fIdx][1]) * localFrac;
        const nLen = Math.sqrt(nx * nx + nz * nz) || 1;

        const x = fx + (nx / nLen) * dist;
        const z = fz + (nz / nLen) * dist;
        const angle = Math.atan2(x, z);
        const h = mountainHeight(angle * 1.5, seed, octaves);
        const peakY = baseY + peak * 0.3 + h * peak * 0.7;

        vertices.push(x, baseY, z);
        vertices.push(x, peakY, z);
      }

      for (let i = 0; i < segments; i++) {
        const bl = i * 2;
        const tl = i * 2 + 1;
        const br = (i + 1) * 2;
        const tr = (i + 1) * 2 + 1;
        indices.push(bl, br, tl);
        indices.push(tl, br, tr);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(vertices), 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return { geo, color, opacity };
    });
  }, [fencePoints, normals]);

  // ─── Sky material ───────────────────────────────────────────────
  const skyMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: skyVertexShader,
    fragmentShader: skyFragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
  }), []);

  if (!bowlGeo) return null;

  return (
    <group>
      {/* Seating bowl */}
      <mesh geometry={bowlGeo}>
        <meshLambertMaterial color="#2a2a3a" side={THREE.DoubleSide} />
      </mesh>

      {/* Seat blocks */}
      {seatCount > 0 && (
        <instancedMesh
          ref={seatMeshRef}
          args={[seatBlockGeo, null, seatCount]}
          frustumCulled={false}
        >
          <meshLambertMaterial vertexColors />
        </instancedMesh>
      )}

      {/* Fascia accent */}
      {fasciaGeo && (
        <mesh geometry={fasciaGeo}>
          <meshLambertMaterial color={primaryColor} emissive={primaryColor} emissiveIntensity={0.3} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Mountain ranges */}
      {mountainGeos.map((range, i) => (
        <mesh key={`mountain-${i}`} geometry={range.geo}>
          <meshLambertMaterial color={range.color} transparent opacity={range.opacity} side={THREE.DoubleSide} />
        </mesh>
      ))}


      {/* Press box */}
      {fencePoints?.length > 0 && (() => {
        const pressBoxOffset = PUSH_BACK + TREAD_D * (TIER1_ROWS + TIER2_ROWS) + CONCOURSE_D + 5;
        const pressBoxY = FENCE_H + RISER_H * TIER1_ROWS + CONCOURSE_H + RISER_H * TIER2_ROWS;
        const midIdx = Math.floor(fencePoints.length / 2);
        const [mx, , mz] = fencePoints[midIdx];
        const [mnx, mnz] = normals[midIdx];
        const mLen = Math.sqrt(mnx * mnx + mnz * mnz) || 1;
        const pbX = mx + (mnx / mLen) * pressBoxOffset;
        const pbZ = mz + (mnz / mLen) * pressBoxOffset;
        return (
          <group position={[pbX, pressBoxY, pbZ]}>
            <mesh>
              <boxGeometry args={[60, 8, 12]} />
              <meshLambertMaterial color="#1a1a2e" />
            </mesh>
            <mesh position={[0, 0, 6.1]}>
              <boxGeometry args={[56, 4, 0.2]} />
              <meshBasicMaterial color="#88aacc" transparent opacity={0.4} />
            </mesh>
          </group>
        );
      })()}

      {/* Sky dome */}
      <mesh material={skyMat}>
        <sphereGeometry args={[600, 32, 20]} />
      </mesh>
    </group>
  );
}
