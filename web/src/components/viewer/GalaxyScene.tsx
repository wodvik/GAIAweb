"use client";

/**
 * R3F scene for the orbit viewer. Galactic coordinates are used directly
 * (kpc), with +z as galactic north; the camera's up vector is set to +z.
 *
 * Trajectories arrive in the release's rotating frame for barred models
 * (bar frozen at -0.44 rad). In "inertial" view we rotate each sample by
 * -omega * t (undoing the frame rotation); the bar overlay then spins.
 */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line, OrbitControls, Text } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { TIME_UNIT_GYR } from "@/lib/orbit/integrate";

export interface SceneObject {
  id: string;
  label: string;
  color: string;
  /** interleaved x,y,z positions, uniform in time over totalGyr */
  positions: Float32Array;
  emphasis: boolean;
}

interface SceneProps {
  objects: SceneObject[];
  tGyr: number;
  totalGyr: number;
  barred: boolean;
  omega: number; // release sign convention (negative = clockwise)
  frame: "rotating" | "inertial";
  showDisc: boolean;
  showAccel: boolean;
  showPotential: boolean;
  modelId: string;
}

const R0 = 8.178;
const BAR_ANGLE = -0.44;

/** decorative disc + bulge point cloud, scaled to the Milky Way */
function DiscPoints({ visible }: { visible: boolean }) {
  const geom = useMemo(() => {
    const N = 9000;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const rng = (() => {
      let s = 12345;
      return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
      };
    })();
    const cWarm = new THREE.Color("#ffe6c0");
    const cCool = new THREE.Color("#9fb8e8");
    for (let i = 0; i < N; i++) {
      let R: number;
      let z: number;
      if (i < N * 0.25) {
        // bulge-ish: r ~ exponential 0.8 kpc, flattened
        R = -0.9 * Math.log(1 - rng() * 0.995);
        z = (rng() - 0.5) * 0.5 * Math.exp(-R / 1.2);
      } else {
        // exponential disc, Rd = 2.6 kpc, hz = 0.3 kpc
        R = -2.6 * Math.log(1 - rng() * 0.998);
        z = -0.3 * Math.log(1 - rng() * 0.999) * (rng() < 0.5 ? 1 : -1) * 0.7;
      }
      const phi = rng() * Math.PI * 2;
      pos[3 * i] = R * Math.cos(phi);
      pos[3 * i + 1] = R * Math.sin(phi);
      pos[3 * i + 2] = z;
      const c = rng() < 0.5 ? cWarm : cCool;
      const f = 0.35 + 0.65 * rng();
      col[3 * i] = c.r * f;
      col[3 * i + 1] = c.g * f;
      col[3 * i + 2] = c.b * f;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  }, []);
  return (
    <points geometry={geom} visible={visible}>
      <pointsMaterial
        size={0.06}
        vertexColors
        transparent
        opacity={0.35}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

/** bar overlay: wireframe ellipsoid, half-length ~4.5 kpc, at BAR_ANGLE */
function BarOverlay({
  visible,
  spinAngle,
}: {
  visible: boolean;
  spinAngle: number;
}) {
  return (
    <group rotation={[0, 0, BAR_ANGLE + spinAngle]} visible={visible}>
      <mesh scale={[4.5, 1.4, 0.9]}>
        <sphereGeometry args={[1, 24, 12]} />
        <meshBasicMaterial
          color="#f0865c"
          wireframe
          transparent
          opacity={0.12}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function SolarRing() {
  const pts = useMemo(() => {
    const out: [number, number, number][] = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      out.push([R0 * Math.cos(a), R0 * Math.sin(a), 0]);
    }
    return out;
  }, []);
  return (
    <Line points={pts} color="#2a3a52" lineWidth={1} transparent opacity={0.7} />
  );
}

function OrbitTrail({
  obj,
  omega,
  frame,
  totalGyr,
}: {
  obj: SceneObject;
  omega: number;
  frame: "rotating" | "inertial";
  totalGyr: number;
}) {
  // decimate for the line (full resolution not needed visually)
  const points = useMemo(() => {
    const n = obj.positions.length / 3;
    const step = Math.max(1, Math.floor(n / 6000));
    const pts: [number, number, number][] = [];
    const tmaxUnits = totalGyr / TIME_UNIT_GYR;
    for (let i = 0; i < n; i += step) {
      let x = obj.positions[3 * i];
      let y = obj.positions[3 * i + 1];
      const z = obj.positions[3 * i + 2];
      if (frame === "inertial" && omega !== 0) {
        const ang = omega * (i / (n - 1)) * tmaxUnits;
        // rotating->inertial: undo frame rotation (rotate by +omega*t)
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const xi = c * x - s * y;
        y = s * x + c * y;
        x = xi;
      }
      pts.push([x, y, z]);
    }
    return pts;
  }, [obj.positions, omega, frame, totalGyr]);

  return (
    <Line
      points={points}
      color={obj.color}
      lineWidth={obj.emphasis ? 1.6 : 1}
      transparent
      opacity={obj.emphasis ? 0.85 : 0.5}
    />
  );
}

function MovingMarker({
  obj,
  tGyr,
  totalGyr,
  omega,
  frame,
}: {
  obj: SceneObject;
  tGyr: number;
  totalGyr: number;
  omega: number;
  frame: "rotating" | "inertial";
}) {
  const ref = useRef<THREE.Group>(null);
  const n = obj.positions.length / 3;
  useFrame(() => {
    if (!ref.current) return;
    const f = Math.min(0.99999, Math.max(0, tGyr / totalGyr));
    const fi = f * (n - 1);
    const i0 = Math.floor(fi);
    const w = fi - i0;
    const i1 = Math.min(n - 1, i0 + 1);
    let x =
      obj.positions[3 * i0] * (1 - w) + obj.positions[3 * i1] * w;
    let y =
      obj.positions[3 * i0 + 1] * (1 - w) + obj.positions[3 * i1 + 1] * w;
    const z =
      obj.positions[3 * i0 + 2] * (1 - w) + obj.positions[3 * i1 + 2] * w;
    if (frame === "inertial" && omega !== 0) {
      const ang = omega * (tGyr / TIME_UNIT_GYR);
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const xi = c * x - s * y;
      y = s * x + c * y;
      x = xi;
    }
    ref.current.position.set(x, y, z);
  });
  return (
    <group ref={ref}>
      <mesh>
        <sphereGeometry args={[obj.emphasis ? 0.13 : 0.09, 16, 16]} />
        <meshBasicMaterial color={obj.color} />
      </mesh>
      {obj.emphasis && (
        <Text
          position={[0.25, 0.25, 0.15]}
          fontSize={0.32}
          color={obj.color}
          anchorX="left"
        >
          {obj.label}
        </Text>
      )}
    </group>
  );
}

function BarSpin({
  omega,
  tGyr,
  frame,
  visible,
}: {
  omega: number;
  tGyr: number;
  frame: "rotating" | "inertial";
  visible: boolean;
}) {
  // in the rotating frame the bar is frozen; in the inertial frame it spins
  const spin =
    frame === "inertial" && omega !== 0 ? omega * (tGyr / TIME_UNIT_GYR) : 0;
  return <BarOverlay visible={visible} spinAngle={spin} />;
}

function CameraRig() {
  const { camera } = useThree();
  useEffect(() => {
    camera.up.set(0, 0, 1);
    camera.position.set(6, -22, 12);
    camera.lookAt(0, 0, 0);
  }, [camera]);
  return null;
}

export default function GalaxyScene(props: SceneProps) {
  const {
    objects,
    tGyr,
    totalGyr,
    barred,
    omega,
    frame,
    showDisc,
  } = props;
  return (
    <Canvas
      gl={{ antialias: true }}
      dpr={[1, 2]}
      style={{ background: "var(--background)" }}
      camera={{ fov: 50, near: 0.01, far: 2000 }}
    >
      <CameraRig />
      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
      <ambientLight intensity={0.6} />

      {/* galactic centre + Sun position */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.05, 12, 12]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <Text position={[0.15, 0.15, 0.1]} fontSize={0.3} color="#8494ac" anchorX="left">
        Sgr A*
      </Text>
      <SolarRing />
      <DiscPoints visible={showDisc} />
      <BarSpin omega={omega} tGyr={tGyr} frame={frame} visible={barred} />

      {objects.map((o) => (
        <group key={o.id}>
          <OrbitTrail obj={o} omega={omega} frame={frame} totalGyr={totalGyr} />
          <MovingMarker
            obj={o}
            tGyr={tGyr}
            totalGyr={totalGyr}
            omega={omega}
            frame={frame}
          />
        </group>
      ))}
    </Canvas>
  );
}
