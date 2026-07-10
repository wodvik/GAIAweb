"use client";

/** 'Show the model' overlays: equipotential contours and the live
 * acceleration vector, both derived from the release potential models. */

import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { loadPotential, type ModelId } from "@/lib/potentials/load";
import type { PotentialModel } from "@/lib/potentials/model";
import { TIME_UNIT_GYR } from "@/lib/orbit/integrate";
import type { ViewerClock } from "./GalaxyScene";

const BAR_ANGLE = -0.44;

interface ContourSeg {
  level: number;
  xy: [number, number][];
}

interface OverlayFile {
  frame: "bar" | "galactocentric";
  midplanePhi: ContourSeg[];
  effective?: Record<string, ContourSeg[]>;
}

const overlayCache = new Map<string, Promise<OverlayFile>>();

function loadOverlay(modelId: string): Promise<OverlayFile> {
  let p = overlayCache.get(modelId);
  if (!p) {
    p = fetch(`/data/overlays/${modelId}.json`).then((r) => {
      if (!r.ok) throw new Error(`no overlay for ${modelId}`);
      return r.json();
    });
    overlayCache.set(modelId, p);
  }
  return p;
}

export function EquipotentialOverlay({
  modelId,
  barred,
  omegaP,
  clock,
  omega,
  frame,
  visible,
}: {
  modelId: string;
  barred: boolean;
  omegaP: number;
  clock: ViewerClock;
  omega: number;
  frame: "rotating" | "inertial";
  visible: boolean;
}) {
  const [data, setData] = useState<OverlayFile | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    loadOverlay(modelId).then(
      (d) => alive && setData(d),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [modelId, visible]);

  const base = data?.frame === "bar" ? BAR_ANGLE : 0;
  useFrame(() => {
    if (!groupRef.current) return;
    const spin =
      data?.frame === "bar" && frame === "inertial" && omega !== 0
        ? omega * (clock.t / TIME_UNIT_GYR)
        : 0;
    groupRef.current.rotation.z = base + spin;
  });

  if (!visible || !data) return null;
  const segs: ContourSeg[] = barred
    ? (data.effective?.[String(omegaP)] ?? data.midplanePhi)
    : data.midplanePhi;

  return (
    <group ref={groupRef} rotation={[0, 0, base]}>
      {segs.map((seg, i) => (
        <Line
          key={i}
          points={seg.xy.map(([x, y]) => [x, y, 0.01] as [number, number, number])}
          color={barred ? "#f0865c" : "#62d6e8"}
          transparent
          opacity={0.28}
          lineWidth={1}
        />
      ))}
    </group>
  );
}

/** Arrow showing the gravitational acceleration (model force only, no
 * centrifugal/Coriolis terms) at the primary object's current position. */
export function AccelArrow({
  modelId,
  getPosition,
  omega,
  frame,
  clock,
  visible,
}: {
  modelId: ModelId;
  /** returns the primary marker's current DISPLAY-frame position, or null */
  getPosition: () => [number, number, number] | null;
  omega: number;
  frame: "rotating" | "inertial";
  clock: ViewerClock;
  visible: boolean;
}) {
  const [model, setModel] = useState<PotentialModel | null>(null);
  const arrowRef = useRef<THREE.ArrowHelper>(null);
  const acc = useRef({ ax: 0, ay: 0, az: 0, phi: 0 });

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    loadPotential(modelId).then(
      (m) => alive && setModel(m),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [modelId, visible]);

  useFrame(() => {
    const arrow = arrowRef.current;
    if (!arrow || !model || !visible) return;
    const pos = getPosition();
    if (!pos) {
      arrow.visible = false;
      return;
    }
    // display frame -> grid frame
    let [x, y] = pos;
    const z = pos[2];
    // undo inertial spin (display -> release rotating frame)
    if (frame === "inertial" && omega !== 0) {
      const ang = -omega * (clock.t / TIME_UNIT_GYR);
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      [x, y] = [c * x - s * y, s * x + c * y];
    }
    // release rotating frame -> bar (grid) frame
    let bx = x;
    let by = y;
    const barRot = model.isRotating
      ? (model.meta.barRotationSign ?? 1) * (model.meta.barAngleRad ?? 0)
      : 0;
    if (barRot !== 0) {
      const c = Math.cos(barRot);
      const s = Math.sin(barRot);
      bx = c * x - s * y;
      by = s * x + c * y;
    }
    model.accelPhi(bx, by, z, acc.current);
    // grid frame -> display frame (reverse both rotations)
    let ax = acc.current.ax;
    let ay = acc.current.ay;
    if (barRot !== 0) {
      const c = Math.cos(-barRot);
      const s = Math.sin(-barRot);
      [ax, ay] = [c * ax - s * ay, s * ax + c * ay];
    }
    if (frame === "inertial" && omega !== 0) {
      const ang = omega * (clock.t / TIME_UNIT_GYR);
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      [ax, ay] = [c * ax - s * ay, s * ax + c * ay];
    }
    const az = acc.current.az;
    const mag = Math.hypot(ax, ay, az);
    if (mag === 0) {
      arrow.visible = false;
      return;
    }
    arrow.visible = true;
    arrow.position.set(pos[0], pos[1], pos[2]);
    arrow.setDirection(
      new THREE.Vector3(ax / mag, ay / mag, az / mag),
    );
    // length grows gently with |a| so plunges visibly "feel" the centre
    const len = Math.min(4, 0.8 + Math.log10(1 + mag / 500));
    arrow.setLength(len, 0.35, 0.18);
  });

  if (!visible) return null;
  return (
    <arrowHelper
      ref={arrowRef}
      args={[new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), 1.5, "#ffd869"]}
    />
  );
}
