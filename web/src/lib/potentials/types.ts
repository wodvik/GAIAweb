/** Metadata written by pipeline/export_potentials.py (one per model). */

export interface GridSpec {
  nu: number;
  nth: number;
  u0: number; // log10(r/kpc) at first radial node
  u1: number;
  thetaMax: number; // pi
  /** grid is uniform in s, with theta = s + lambda*sin(2s) (denser at the disc plane) */
  thetaMap?: { type: string; lambda: number; note?: string };
}

export interface RotationCurve {
  R_kpc: number[];
  vc_kms: number[];
  note?: string;
}

export interface PotentialMeta {
  name: string;
  kind: "axisymmetric" | "fourier3d";
  release: string;
  label: string;
  paperRole: "default" | "comparison" | "barred" | "barred_independent";
  source: string;
  grid: GridSpec;
  arrays: string[]; // order of (nu x nth) float32 blocks in the .f32 file
  poleParity: number[]; // +-1 per array, applied when a theta ghost index crosses a pole
  moments?: number[]; // fourier3d: retained azimuthal orders m
  rotatingFrame?: boolean;
  barAngleRad?: number; // present-day bar angle in the galactocentric frame (-0.44)
  barRotationSign?: number; // s: pot_rotated(x) = pot_native(rotz(x, s*barAngle))
  patternSpeeds?: Record<string, number | number[]>;
  rotationCurve: RotationCurve;
  timeUnitGyr: number; // kpc/(km/s) in Gyr = 0.9778
  validation: unknown;
}

/** Solar-frame variants copied from the release config.yml. */
export interface SolarVariant {
  R0_kpc: number;
  z_sun_pc: number;
  Vc_kms: number;
  U_kms: number;
  V_kms: number;
  W_kms: number;
}
