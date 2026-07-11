/**
 * Model Lab: user-editable composite potential built from per-component
 * grids of the Hunter+2024 model (pipeline/export_components.py).
 *
 * Gravity is linear, so Phi_total = sum_i k_i Phi_i (+ k_bh * Plummer) is
 * EXACT for any mass multipliers k_i — the k=1 sum is validated against the
 * release potential in the pipeline before the grids ship.
 */

import { PotentialModel } from "./model";
import type { PotentialMeta } from "./types";

export const G_KPC = 4.300917270e-6; // kpc (km/s)^2 / Msun

export interface LabComponentMeta {
  id: string;
  label: string;
  group: string; // halo | disc | gas | bar | nsd | nsc
  kind: "axisymmetric" | "fourier3d";
  file: string;
  arrays: string[];
  poleParity: number[];
  moments?: number[];
  totalMass_Msun: number;
  vc2_R_kpc?: number[];
  vc2_kms2?: number[];
}

export interface LabIndex {
  release: string;
  source: string;
  grid: PotentialMeta["grid"];
  timeUnitGyr: number;
  blackHole: { type: string; mass: number; scaleRadius: number };
  barAngleRad: number;
  barRotationSign: number;
  components: LabComponentMeta[];
  validationStatic?: unknown;
  validationBarred?: unknown;
}

/** Multipliers applied per component id, plus the black hole. */
export interface LabSettings {
  k: Record<string, number>; // component id -> multiplier
  kBH: number;
}

export function labSignature(s: LabSettings, ids: string[]): string {
  return ids.map((id) => (s.k[id] ?? 1).toFixed(3)).join(",") + "|" + s.kBH.toFixed(3);
}

export function defaultLabSettings(): LabSettings {
  return {
    k: {
      halo: 1,
      disc_thin: 1,
      disc_thick: 1,
      gas_hi: 1,
      gas_mol: 1,
      nsd: 1,
      nsc: 1,
      bar_axi: 1,
      bar_full: 1,
    },
    kBH: 1,
  };
}

/** Composite potential exposing the same interface integrateOrbit needs. */
export class CompositeModel {
  readonly meta: {
    barAngleRad?: number;
    barRotationSign?: number;
  };
  private readonly parts: { model: PotentialModel; k: number }[];
  private readonly bhGM: number; // G * M_BH * k
  private readonly bhA2: number;
  private readonly rotating: boolean;
  private readonly tmp = { ax: 0, ay: 0, az: 0, phi: 0 };

  constructor(
    parts: { model: PotentialModel; k: number }[],
    bh: { mass: number; scaleRadius: number },
    kBH: number,
    rotating: boolean,
    barAngleRad?: number,
    barRotationSign?: number,
  ) {
    this.parts = parts.filter((p) => p.k !== 0);
    this.bhGM = G_KPC * bh.mass * kBH;
    this.bhA2 = bh.scaleRadius * bh.scaleRadius;
    this.rotating = rotating;
    this.meta = rotating
      ? { barAngleRad, barRotationSign }
      : {};
  }

  get isRotating(): boolean {
    return this.rotating;
  }

  accelPhi(
    x: number,
    y: number,
    z: number,
    out: { ax: number; ay: number; az: number; phi: number },
  ): void {
    let ax = 0;
    let ay = 0;
    let az = 0;
    let phi = 0;
    for (const p of this.parts) {
      p.model.accelPhi(x, y, z, this.tmp);
      ax += p.k * this.tmp.ax;
      ay += p.k * this.tmp.ay;
      az += p.k * this.tmp.az;
      phi += p.k * this.tmp.phi;
    }
    if (this.bhGM > 0) {
      const s2 = x * x + y * y + z * z + this.bhA2;
      const s = Math.sqrt(s2);
      const f = -this.bhGM / (s2 * s);
      ax += f * x;
      ay += f * y;
      az += f * z;
      phi += -this.bhGM / s;
    }
    out.ax = ax;
    out.ay = ay;
    out.az = az;
    out.phi = phi;
  }
}

/** Build a PotentialModel for one lab component from the shared lab index. */
export function componentModel(
  index: LabIndex,
  comp: LabComponentMeta,
  buffer: ArrayBuffer,
): PotentialModel {
  const meta = {
    name: comp.id,
    kind: comp.kind,
    release: index.release,
    label: comp.label,
    paperRole: "default",
    source: index.source,
    grid: index.grid,
    arrays: comp.arrays,
    poleParity: comp.poleParity,
    moments: comp.moments,
    rotationCurve: { R_kpc: [1, 10], vc_kms: [0, 0] }, // unused for parts
    timeUnitGyr: index.timeUnitGyr,
    validation: null,
  } as unknown as PotentialMeta;
  return new PotentialModel(meta, buffer);
}

/** vc^2 contribution of the black hole at radius R (midplane). */
export function bhVc2(index: LabIndex, kBH: number, R: number): number {
  const a = index.blackHole.scaleRadius;
  const gm = G_KPC * index.blackHole.mass * kBH;
  return (gm * R * R) / Math.pow(R * R + a * a, 1.5);
}
