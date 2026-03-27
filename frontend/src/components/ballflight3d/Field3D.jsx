import { useMemo } from "react";
import * as THREE from "three";
import stadiumPaths from "../../data/stadiumPaths.json";

const HP = { x: 125.42, y: 198.27 };
const MLBAM_TO_FT = 2.495671;

// Convert MLBAM [x,y] to 3D feet [x, 0, -z] (y-up coord system)
// In our 3D world: +x = toward first base, +z = toward center field (negative Three.js z), y = up
function mlbamTo3D(mx, my) {
  const dx = (mx - HP.x) * MLBAM_TO_FT;
  const dz = (HP.y - my) * MLBAM_TO_FT; // flip: MLBAM y goes down, we want +z toward outfield
  return [dx, 0, -dz]; // Three.js z is negative into screen
}

function getStadiumData(teamId) {
  return stadiumPaths[String(teamId)] || null;
}

/**
 * 3D Baseball Field.
 * Renders grass, dirt, fence, bases, foul lines, pitcher's mound.
 */
export default function Field3D({ venueTeamId }) {
  const stadium = getStadiumData(venueTeamId);

  const { grassShape, dirtShape, infieldGrassShape, fencePoints, foulLinePoints } = useMemo(() => {
    if (!stadium) return {};

    // Outfield grass shape: fence polygon + home plate to close
    const outerPts = stadium.outfield_outer.map(([x, y]) => {
      const [fx, , fz] = mlbamTo3D(x, y);
      return new THREE.Vector2(fx, fz);
    });
    // Close with home plate
    outerPts.push(new THREE.Vector2(0, 0));
    const grassShape = new THREE.Shape(outerPts);

    // Infield dirt (outer)
    const dirtPts = stadium.infield_outer.map(([x, y]) => {
      const [fx, , fz] = mlbamTo3D(x, y);
      return new THREE.Vector2(fx, fz);
    });
    const dirtShape = new THREE.Shape(dirtPts);

    // Infield grass cutout (inner)
    const innerPts = stadium.infield_inner.map(([x, y]) => {
      const [fx, , fz] = mlbamTo3D(x, y);
      return new THREE.Vector2(fx, fz);
    });
    const infieldGrassShape = new THREE.Shape(innerPts);

    // Fence 3D points for wall geometry
    const fencePoints = stadium.outfield_outer.map(([x, y]) => mlbamTo3D(x, y));

    // Foul line points
    const foulLinePoints = stadium.foul_lines.map(([x, y]) => mlbamTo3D(x, y));

    return { grassShape, dirtShape, infieldGrassShape, fencePoints, foulLinePoints };
  }, [stadium]);

  // Base positions in feet from home plate
  const B1 = [63.64, 0, -63.64];  // 90ft at 45 degrees
  const B2 = [0, 0, -127.28];     // 2nd base
  const B3 = [-63.64, 0, -63.64]; // 3rd base
  const MOUND = [0, 0.75, -60.5]; // pitcher's mound slightly raised

  if (!grassShape) return null;

  return (
    <group>
      {/* Outfield grass */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <shapeGeometry args={[grassShape]} />
        <meshStandardMaterial color="#1a5c1a" transparent opacity={0.85} side={THREE.DoubleSide} />
      </mesh>

      {/* Infield dirt */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <shapeGeometry args={[dirtShape]} />
        <meshStandardMaterial color="#8B6B3D" transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>

      {/* Infield grass cutout */}
      {infieldGrassShape && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <shapeGeometry args={[infieldGrassShape]} />
          <meshStandardMaterial color="#1a6e1a" transparent opacity={0.9} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Fence wall — vertical plane along fence line */}
      <FenceWall points={fencePoints} />

      {/* Foul lines */}
      <FoulLines points={foulLinePoints} />

      {/* Base paths (white lines) */}
      <BasePath from={[0, 0.05, 0]} to={B1} />
      <BasePath from={B1} to={B2} />
      <BasePath from={B2} to={B3} />
      <BasePath from={B3} to={[0, 0.05, 0]} />

      {/* Bases */}
      <Base position={B1} />
      <Base position={B2} />
      <Base position={B3} />

      {/* Home plate */}
      <HomePlate />

      {/* Pitcher's mound */}
      <group position={MOUND}>
        <mesh>
          <cylinderGeometry args={[9, 10, 0.75, 32]} />
          <meshStandardMaterial color="#8B6B3D" transparent opacity={0.6} />
        </mesh>
        {/* Rubber */}
        <mesh position={[0, 0.4, 0]}>
          <boxGeometry args={[2, 0.15, 0.5]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.8} />
        </mesh>
      </group>

      {/* Ground plane (dark area beyond the field) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]}>
        <planeGeometry args={[800, 800]} />
        <meshStandardMaterial color="#0a1a0a" />
      </mesh>
    </group>
  );
}

function FenceWall({ points }) {
  const geometry = useMemo(() => {
    if (!points?.length) return null;
    const wallHeight = 10; // ~10ft fence
    const vertices = [];
    const indices = [];

    for (let i = 0; i < points.length; i++) {
      const [x, , z] = points[i];
      // Bottom vertex
      vertices.push(x, 0, z);
      // Top vertex
      vertices.push(x, wallHeight, z);
    }

    for (let i = 0; i < points.length - 1; i++) {
      const bl = i * 2;
      const tl = i * 2 + 1;
      const br = (i + 1) * 2;
      const tr = (i + 1) * 2 + 1;
      indices.push(bl, br, tl);
      indices.push(tl, br, tr);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [points]);

  if (!geometry) return null;
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#1a3a1a" transparent opacity={0.5} side={THREE.DoubleSide} />
    </mesh>
  );
}

function FoulLines({ points }) {
  const geometry = useMemo(() => {
    if (!points?.length) return null;
    const verts = points.flatMap(([x, , z]) => [x, 0.05, z]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    return geo;
  }, [points]);

  if (!geometry) return null;
  return (
    <line geometry={geometry}>
      <lineBasicMaterial color="#ffffff" transparent opacity={0.3} />
    </line>
  );
}

function BasePath({ from, to }) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute([...from, ...to], 3));
    return geo;
  }, [from, to]);

  return (
    <line geometry={geometry}>
      <lineBasicMaterial color="#ffffff" transparent opacity={0.2} />
    </line>
  );
}

function Base({ position }) {
  return (
    <mesh position={position} rotation={[-Math.PI / 2, Math.PI / 4, 0]}>
      <planeGeometry args={[3, 3]} />
      <meshStandardMaterial color="#ffffff" transparent opacity={0.9} side={THREE.DoubleSide} />
    </mesh>
  );
}

function HomePlate() {
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    // Pentagon shape for home plate (17 inches wide ≈ 1.42 ft)
    s.moveTo(-0.71, 0);
    s.lineTo(0, -0.85);
    s.lineTo(0.71, 0);
    s.lineTo(0.5, 0.5);
    s.lineTo(-0.5, 0.5);
    s.closePath();
    return s;
  }, []);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial color="#ffffff" transparent opacity={0.9} side={THREE.DoubleSide} />
    </mesh>
  );
}

export { mlbamTo3D, MLBAM_TO_FT, HP };
