import { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";

// Sky dome shaders
const skyVertexShader = `
  varying float vWorldY;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldY = worldPos.y;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const skyFragmentShader = `
  varying float vWorldY;
  void main() {
    float t = clamp(vWorldY / 500.0, -0.3, 1.0);
    vec3 belowHorizon = vec3(0.55, 0.62, 0.7);
    vec3 horizon = vec3(0.45, 0.6, 0.8);
    vec3 zenith = vec3(0.15, 0.3, 0.6);
    vec3 color;
    if (t < 0.0) {
      color = mix(belowHorizon, horizon, t + 1.0);
    } else {
      color = mix(horizon, zenith, t);
    }
    gl_FragColor = vec4(color, 1.0);
  }
`;

// Bowl constants
const FENCE_H = 10;
const RISER_H = 2.5;
const TREAD_D = 3.5;
const TIER1_ROWS = 8;
const TIER2_ROWS = 6;
const CONCOURSE_H = 5;
const CONCOURSE_D = 6;
const PUSH_BACK = 15; // gap between fence and first row

/**
 * Procedural 3D stadium background.
 * Bowl + seats built directly from fence points (not LatheGeometry).
 */
export default function StadiumBackground({ fencePoints, teamColors }) {
  const seatMeshRef = useRef();
  const primaryColor = teamColors?.primary || "#2a3a5c";
  const secondaryColor = teamColors?.secondary || "#1a2a4c";

  // Compute outward normals for each fence point (away from home plate)
  const normals = useMemo(() => {
    if (!fencePoints?.length) return [];
    return fencePoints.map(([x, , z]) => {
      const dist = Math.sqrt(x * x + z * z) || 1;
      return [x / dist, z / dist];
    });
  }, [fencePoints]);

  // Build bowl geometry from fence points — extrude outward with stair-step profile
  const bowlGeo = useMemo(() => {
    if (!fencePoints?.length || !normals.length) return null;

    const pts = fencePoints;
    const n = pts.length;

    // Build the cross-section heights and radial offsets for each row
    const rows = [];
    let y = FENCE_H;
    let offset = PUSH_BACK;

    // Tier 1
    for (let i = 0; i < TIER1_ROWS; i++) {
      rows.push({ offset, y }); // tread surface
      y += RISER_H;
      offset += TREAD_D;
    }

    // Concourse
    const concourseOffset = offset;
    const concourseY = y;
    y += CONCOURSE_H;
    offset += CONCOURSE_D;

    // Tier 2
    for (let i = 0; i < TIER2_ROWS; i++) {
      rows.push({ offset, y });
      y += RISER_H;
      offset += TREAD_D;
    }

    // Add a top edge and back wall drop
    rows.push({ offset, y }); // top
    const topOffset = offset;
    const topY = y;

    // For each fence point and each row, generate a vertex
    // Total rows for the raked surface + back wall
    const profilePts = [];
    // Bottom edge at fence height
    profilePts.push({ offset: PUSH_BACK, y: FENCE_H });
    // Each row: tread then riser (simplified: just the tread tops)
    for (const r of rows) {
      profilePts.push(r);
    }
    // Back wall bottom
    profilePts.push({ offset: topOffset, y: 0 });

    const numProfile = profilePts.length;
    const vertices = new Float32Array(n * numProfile * 3);
    const indices = [];

    // Generate vertices
    for (let f = 0; f < n; f++) {
      const [fx, , fz] = pts[f];
      const [nx, nz] = normals[f];

      for (let p = 0; p < numProfile; p++) {
        const { offset, y: py } = profilePts[p];
        const idx = (f * numProfile + p) * 3;
        vertices[idx] = fx + nx * offset;
        vertices[idx + 1] = py;
        vertices[idx + 2] = fz + nz * offset;
      }
    }

    // Generate indices — connect adjacent fence points
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

  // Fascia strip at concourse level
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

      // Bottom of fascia
      vertices[(f * 2) * 3] = bx;
      vertices[(f * 2) * 3 + 1] = fasciaY;
      vertices[(f * 2) * 3 + 2] = bz;
      // Top of fascia
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

  // Instanced seat blocks — placed on each tread of the bowl
  const seatBlockGeo = useMemo(() => new THREE.BoxGeometry(6, 0.8, 2.0), []);

  const { seatCount, seatMatrices, seatColorArray } = useMemo(() => {
    if (!fencePoints?.length || !normals.length)
      return { seatCount: 0, seatMatrices: null, seatColorArray: null };

    const pts = fencePoints;
    const n = pts.length;
    const matrices = [];
    const colors = [];
    const priColor = new THREE.Color(primaryColor);
    const secColor = new THREE.Color(secondaryColor);
    const dummy = new THREE.Object3D();

    // Place seats every ~8ft along the fence arc, on each row
    const seatSpacing = 8;

    // Walk fence points and place seats at intervals
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

    // Compute foul line angles from home plate
    // LF foul line and RF foul line — find the fence points with most extreme
    // negative-x and positive-x that are still in the outfield (z < -80)
    let lfAngle = 0, rfAngle = 0;
    for (let f = 0; f < n; f++) {
      const [fx, , fz] = pts[f];
      if (fz > -80) continue; // skip backstop area
      const angle = Math.atan2(fx, -fz); // angle from center field axis
      if (angle < lfAngle) lfAngle = angle;
      if (angle > rfAngle) rfAngle = angle;
    }
    // Add small buffer so seats don't go right to the foul pole
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

        // Skip seats past the foul lines (in foul territory behind home)
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

        const section = Math.floor(s / 4);
        const c = (section + rowIdx) % 2 === 0 ? priColor : secColor;
        colors.push(c.r, c.g, c.b);
      }
    };

    // Tier 1
    for (let i = 0; i < TIER1_ROWS; i++) {
      const rowOffset = PUSH_BACK + TREAD_D * i + TREAD_D / 2;
      const rowY = FENCE_H + RISER_H * (i + 1) + 0.4;
      addRow(rowOffset, rowY, i);
    }

    // Tier 2
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

  // Sky dome
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
        <meshLambertMaterial color="#3a3a50" side={THREE.DoubleSide} />
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

      {/* Sky dome */}
      <mesh material={skyMat}>
        <sphereGeometry args={[600, 24, 16]} />
      </mesh>
    </group>
  );
}
