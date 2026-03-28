import { useMemo, useEffect, useRef } from "react";
import * as THREE from "three";
import stadiumPaths from "../../data/stadiumPaths.json";
import ALL_TEAMS from "../../data/teams";
import StadiumBackground from "./StadiumBackground";

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
// Module-level constants — avoid re-creation on every render
const B1 = [63.64, 0, -63.64];
const B2 = [0, 0, -127.28];
const B3 = [-63.64, 0, -63.64];
const MOUND = [0, 0.75, -60.5];

export default function Field3D({ venueTeamId, teamColor }) {
  const stadium = getStadiumData(venueTeamId);

  const { grassShape, dirtShape, infieldGrassShape, fencePoints, foulLinePoints, foulPolePositions } = useMemo(() => {
    if (!stadium) return {};

    // Outfield grass shape: fence polygon + home plate to close
    // Note: Shape lives in XY plane, rotation -PI/2 around X maps shape_Y → -mesh_Z
    // So we use -fz to get the correct orientation (outfield at negative Z)
    const outerPts = stadium.outfield_outer.map(([x, y]) => {
      const [fx, , fz] = mlbamTo3D(x, y);
      return new THREE.Vector2(fx, -fz);
    });
    // Close with home plate
    outerPts.push(new THREE.Vector2(0, 0));
    const grassShape = new THREE.Shape(outerPts);

    // Infield dirt (outer)
    const dirtPts = stadium.infield_outer.map(([x, y]) => {
      const [fx, , fz] = mlbamTo3D(x, y);
      return new THREE.Vector2(fx, -fz);
    });
    const dirtShape = new THREE.Shape(dirtPts);

    // Infield grass cutout (inner)
    const innerPts = stadium.infield_inner.map(([x, y]) => {
      const [fx, , fz] = mlbamTo3D(x, y);
      return new THREE.Vector2(fx, -fz);
    });
    const infieldGrassShape = new THREE.Shape(innerPts);

    // Fence 3D points for wall geometry
    const fencePoints = stadium.outfield_outer.map(([x, y]) => mlbamTo3D(x, y));

    // Foul line points
    const foulLinePoints = stadium.foul_lines.map(([x, y]) => mlbamTo3D(x, y));

    // Foul pole positions: the two furthest points on the foul lines
    // (one on each side of home plate — negative x = LF, positive x = RF)
    let lfPole = null, rfPole = null;
    let lfDist = 0, rfDist = 0;
    for (const [x, , z] of foulLinePoints) {
      const dist = Math.sqrt(x * x + z * z);
      if (x < -20 && dist > lfDist) { lfDist = dist; lfPole = { x, z, side: "left" }; }
      if (x > 20 && dist > rfDist) { rfDist = dist; rfPole = { x, z, side: "right" }; }
    }
    const foulPolePositions = [lfPole, rfPole].filter(Boolean);

    return { grassShape, dirtShape, infieldGrassShape, fencePoints, foulLinePoints, foulPolePositions };
  }, [stadium]);

  if (!grassShape) return null;

  return (
    <group>
      {/* Outfield grass */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <shapeGeometry args={[grassShape]} />
        <meshLambertMaterial color="#1a5c1a" />
      </mesh>

      {/* Infield dirt */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
        <shapeGeometry args={[dirtShape]} />
        <meshLambertMaterial color="#8B6B3D" />
      </mesh>

      {/* Infield grass cutout */}
      {infieldGrassShape && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.15, 0]}>
          <shapeGeometry args={[infieldGrassShape]} />
          <meshLambertMaterial color="#1a6e1a" />
        </mesh>
      )}

      {/* Fence wall — vertical plane along fence line */}
      <FenceWall points={fencePoints} />

      {/* Stadium background: bowl, towers, skyline, sky dome */}
      <StadiumBackground fencePoints={fencePoints} teamColors={{ primary: teamColor, secondary: ALL_TEAMS[venueTeamId]?.secondary || "#1a2a4c" }} />

      {/* Foul poles */}
      {foulPolePositions && foulPolePositions.map((pole, i) => {
        const POLE_HEIGHT = 90;
        const panelW = 8;
        const panelH = POLE_HEIGHT * 0.65;
        const panelOffsetX = pole.side === "left" ? panelW / 2 : -panelW / 2;
        return (
          <group key={`foul-pole-${i}`} position={[pole.x, 0, pole.z]}>
            <mesh position={[0, POLE_HEIGHT / 2, 0]}>
              <cylinderGeometry args={[0.7, 0.9, POLE_HEIGHT, 8]} />
              <meshLambertMaterial color="#FFD700" emissive="#FFD700" emissiveIntensity={0.2} />
            </mesh>
            <mesh position={[panelOffsetX, POLE_HEIGHT * 0.4, 0]}>
              <boxGeometry args={[panelW, panelH, 0.3]} />
              <meshLambertMaterial color="#FFD700" emissive="#FFD700" emissiveIntensity={0.08} transparent opacity={0.4} />
            </mesh>
            <mesh position={[0, POLE_HEIGHT + 1.2, 0]}>
              <sphereGeometry args={[1.4, 8, 8]} />
              <meshLambertMaterial color="#FFD700" emissive="#FFD700" emissiveIntensity={0.35} />
            </mesh>
          </group>
        );
      })}

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
          <meshLambertMaterial color="#8B6B3D" transparent opacity={0.6} />
        </mesh>
        {/* Rubber */}
        <mesh position={[0, 0.4, 0]}>
          <boxGeometry args={[2, 0.15, 0.5]} />
          <meshLambertMaterial color="#ffffff" transparent opacity={0.8} />
        </mesh>
      </group>

      {/* Ground plane (dark area beyond the field) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.2, 0]}>
        <planeGeometry args={[1200, 1200]} />
        <meshBasicMaterial color="#050808" />
      </mesh>
    </group>
  );
}

function FenceWall({ points }) {
  const wallHeight = 10; // ~10ft fence

  const { wallGeo, railGeo } = useMemo(() => {
    if (!points?.length) return {};

    // Wall surface
    const vertices = [];
    const indices = [];
    const uvs = [];

    for (let i = 0; i < points.length; i++) {
      const [x, , z] = points[i];
      vertices.push(x, 0, z);
      vertices.push(x, wallHeight, z);
      uvs.push(i / points.length, 0);
      uvs.push(i / points.length, 1);
    }

    for (let i = 0; i < points.length - 1; i++) {
      const bl = i * 2;
      const tl = i * 2 + 1;
      const br = (i + 1) * 2;
      const tr = (i + 1) * 2 + 1;
      indices.push(bl, br, tl);
      indices.push(tl, br, tr);
    }

    const wallGeo = new THREE.BufferGeometry();
    wallGeo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    wallGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    wallGeo.setIndex(indices);
    wallGeo.computeVertexNormals();

    // Top rail line
    const railVerts = points.flatMap(([x, , z]) => [x, wallHeight, z]);
    const railGeo = new THREE.BufferGeometry();
    railGeo.setAttribute("position", new THREE.Float32BufferAttribute(railVerts, 3));

    return { wallGeo, railGeo };
  }, [points]);

  // Dispose on unmount only (not on dep change — meshes still reference them)
  const geosRef = useRef({ wallGeo, railGeo });
  geosRef.current = { wallGeo, railGeo };
  useEffect(() => {
    return () => { geosRef.current.wallGeo?.dispose(); geosRef.current.railGeo?.dispose(); };
  }, []);

  if (!wallGeo) return null;
  return (
    <group>
      {/* Wall surface — dark green, padded look */}
      <mesh geometry={wallGeo}>
        <meshLambertMaterial
          color="#0d3d0d"
          transparent
          opacity={0.85}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Yellow top rail */}
      <line geometry={railGeo}>
        <lineBasicMaterial color="#ffd700" linewidth={2} />
      </line>
    </group>
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
      <meshLambertMaterial color="#ffffff" transparent opacity={0.9} side={THREE.DoubleSide} />
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
      <meshLambertMaterial color="#ffffff" transparent opacity={0.9} side={THREE.DoubleSide} />
    </mesh>
  );
}

export { mlbamTo3D, MLBAM_TO_FT, HP };
