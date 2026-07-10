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
import type { ModelId } from "@/lib/potentials/load";
import { AccelArrow, EquipotentialOverlay } from "./overlays";

export interface SceneObject {
  id: string;
  label: string;
  color: string;
  /** interleaved x,y,z positions, uniform in time over totalGyr */
  positions: Float32Array;
  emphasis: boolean;
}

/**
 * Mutable playback clock shared between the control panel and the render
 * loop. Advanced inside useFrame and read by markers/overlays per frame —
 * deliberately NOT React state: driving 60 fps animation through setState
 * re-renders the whole viewer tree (with multi-MB typed-array props) every
 * frame and, with dev-tools render instrumentation, exhausts memory.
 */
export interface ViewerClock {
  t: number; // Gyr
  playing: boolean;
  speed: number; // 1 = 4 Gyr in 32 s
}

export type ViewPreset = "threequarter" | "faceon" | "edgeon";

interface SceneProps {
  objects: SceneObject[];
  clock: ViewerClock;
  totalGyr: number;
  barred: boolean;
  omega: number; // release sign convention (negative = clockwise)
  frame: "rotating" | "inertial";
  showDisc: boolean;
  showAccel: boolean;
  showPotential: boolean;
  modelId: string;
  /** camera preset command; applied whenever seq changes */
  view: { preset: ViewPreset; seq: number };
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

/** bar overlay: wireframe ellipsoid, half-length ~4.5 kpc; orientation is
 * applied by the enclosing SpinGroup */
function BarOverlay({ visible }: { visible: boolean }) {
  return (
    <mesh scale={[4.5, 1.4, 0.9]} visible={visible}>
      <sphereGeometry args={[1, 24, 12]} />
      <meshBasicMaterial
        color="#f0865c"
        wireframe
        transparent
        opacity={0.12}
        depthWrite={false}
      />
    </mesh>
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
  clock,
  totalGyr,
  omega,
  frame,
  reportRef,
}: {
  obj: SceneObject;
  clock: ViewerClock;
  totalGyr: number;
  omega: number;
  frame: "rotating" | "inertial";
  reportRef?: React.RefObject<[number, number, number] | null>;
}) {
  const ref = useRef<THREE.Group>(null);
  const n = obj.positions.length / 3;
  useFrame(() => {
    if (!ref.current) return;
    const tGyr = clock.t;
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
    if (reportRef) reportRef.current = [x, y, z];
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

/** Advances the shared clock once per rendered frame. */
function ClockDriver({ clock, totalGyr }: { clock: ViewerClock; totalGyr: number }) {
  useFrame((_, delta) => {
    if (clock.playing) {
      clock.t = (clock.t + (delta * clock.speed * totalGyr) / 32) % totalGyr;
    }
  });
  return null;
}

/** Group whose z-rotation follows the bar: frozen in the rotating frame,
 * spinning with omega in the inertial view. */
export function SpinGroup({
  clock,
  omega,
  frame,
  base,
  children,
}: {
  clock: ViewerClock;
  omega: number;
  frame: "rotating" | "inertial";
  base: number;
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!ref.current) return;
    const spin =
      frame === "inertial" && omega !== 0
        ? omega * (clock.t / TIME_UNIT_GYR)
        : 0;
    ref.current.rotation.z = base + spin;
  });
  return <group ref={ref}>{children}</group>;
}

const VIEW_POSITIONS: Record<ViewPreset, [number, number, number]> = {
  threequarter: [6, -22, 12],
  faceon: [0, -0.8, 30],
  edgeon: [0, -30, 1.2],
};

function CameraRig({ view }: { view: { preset: ViewPreset; seq: number } }) {
  const { camera, controls } = useThree();
  useEffect(() => {
    camera.up.set(0, 0, 1);
    camera.position.set(...VIEW_POSITIONS[view.preset]);
    camera.lookAt(0, 0, 0);
    const oc = controls as unknown as {
      target?: THREE.Vector3;
      update?: () => void;
    } | null;
    if (oc?.target) {
      oc.target.set(0, 0, 0);
      oc.update?.();
    }
  }, [camera, controls, view.preset, view.seq]);
  return null;
}

export default function GalaxyScene(props: SceneProps) {
  const {
    objects,
    clock,
    totalGyr,
    barred,
    omega,
    frame,
    showDisc,
    showAccel,
    showPotential,
    modelId,
    view,
  } = props;
  const primaryPosRef = useRef<[number, number, number] | null>(null);
  return (
    <Canvas
      gl={{ antialias: true, powerPreference: "high-performance" }}
      dpr={[1, 1.5]}
      style={{ background: "var(--background)" }}
      camera={{ fov: 50, near: 0.01, far: 2000 }}
      onCreated={({ gl }) => {
        // surface context loss explicitly instead of silently going blank
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          console.warn("[viewer] WebGL context lost — attempting restore");
        });
      }}
    >
      <CameraRig view={view} />
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
      <ClockDriver clock={clock} totalGyr={totalGyr} />
      <SolarRing />
      <DiscPoints visible={showDisc} />
      <SpinGroup clock={clock} omega={omega} frame={frame} base={BAR_ANGLE}>
        <BarOverlay visible={barred} />
      </SpinGroup>
      <EquipotentialOverlay
        modelId={modelId}
        barred={barred}
        omegaP={-omega}
        clock={clock}
        omega={omega}
        frame={frame}
        visible={showPotential}
      />
      <AccelArrow
        modelId={modelId as ModelId}
        getPosition={() => primaryPosRef.current}
        omega={omega}
        frame={frame}
        clock={clock}
        visible={showAccel}
      />

      {objects.map((o) => (
        <group key={o.id}>
          <OrbitTrail obj={o} omega={omega} frame={frame} totalGyr={totalGyr} />
          <MovingMarker
            obj={o}
            clock={clock}
            totalGyr={totalGyr}
            omega={omega}
            frame={frame}
            reportRef={o.emphasis ? primaryPosRef : undefined}
          />
        </group>
      ))}
    </Canvas>
  );
}
