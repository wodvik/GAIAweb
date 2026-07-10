/**
 * Grid-based evaluation of the release potential models.
 *
 * This is an exact mirror of the numpy reference implementation in
 * pipeline/export_potentials.py (class StackedGrid / GridModel), which is
 * validated against direct AGAMA evaluation before any grid is published.
 * Any change here must be reflected there and re-validated.
 *
 * Units: kpc, km/s; Phi in (km/s)^2; acceleration in (km/s)^2 / kpc;
 * time unit = kpc/(km/s) = 0.9778 Gyr.
 */

import type { PotentialMeta } from "./types";

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

/** Catmull-Rom weights for fractional offset t in [0,1). */
function crWeights(t: number, w: Float64Array): void {
  const t2 = t * t;
  const t3 = t2 * t;
  w[0] = -0.5 * t3 + t2 - 0.5 * t;
  w[1] = 1.5 * t3 - 2.5 * t2 + 1.0;
  w[2] = -1.5 * t3 + 2.0 * t2 + 0.5 * t;
  w[3] = 0.5 * t3 - 0.5 * t2;
}

export interface AccelPhi {
  ax: number;
  ay: number;
  az: number;
  phi: number;
}

export class PotentialModel {
  readonly meta: PotentialMeta;
  private readonly data: Float32Array; // all arrays concatenated
  private readonly index = new Map<string, number>(); // name -> array offset index
  private readonly parity: Float64Array;
  private readonly nu: number;
  private readonly nth: number;
  private readonly u0: number;
  private readonly du: number;
  private readonly dth: number;
  private readonly stride: number; // nu*nth
  private readonly wu = new Float64Array(4);
  private readonly wt = new Float64Array(4);
  // per-array interpolated values, reused across eval calls
  private readonly vals: Float64Array;

  private readonly thetaLambda: number;

  constructor(meta: PotentialMeta, buffer: ArrayBuffer) {
    this.meta = meta;
    const { nu, nth, u0, u1 } = meta.grid;
    this.nu = nu;
    this.nth = nth;
    this.u0 = u0;
    this.du = (u1 - u0) / (nu - 1);
    this.dth = meta.grid.thetaMax / (nth - 1);
    this.thetaLambda = meta.grid.thetaMap?.lambda ?? 0;
    this.stride = nu * nth;
    this.data = new Float32Array(buffer);
    if (this.data.length !== meta.arrays.length * this.stride) {
      throw new Error(
        `${meta.name}: grid buffer length ${this.data.length} != ` +
          `${meta.arrays.length} arrays x ${this.stride}`,
      );
    }
    meta.arrays.forEach((name, k) => this.index.set(name, k));
    this.parity = Float64Array.from(meta.poleParity);
    this.vals = new Float64Array(meta.arrays.length);
  }

  get isRotating(): boolean {
    return !!this.meta.rotatingFrame;
  }

  /** Invert theta = s + lambda*sin(2s) by Newton iteration (4 steps, as in
   *  the Python reference implementation). */
  private sOfTheta(th: number): number {
    const lam = this.thetaLambda;
    if (lam === 0) return th;
    let s = th;
    for (let i = 0; i < 4; i++) {
      const f = s + lam * Math.sin(2 * s) - th;
      const fp = 1 + 2 * lam * Math.cos(2 * s);
      s -= f / fp;
    }
    return s;
  }

  /** Interpolate every stored array at (u, theta); results land in this.vals. */
  private evalArrays(u: number, th: number): Float64Array {
    const { nu, nth, stride, data, parity, vals } = this;
    const fu = clamp((u - this.u0) / this.du, 0, nu - 1.000001);
    const ft = this.sOfTheta(th) / this.dth;
    const iu = Math.floor(fu);
    const it = Math.floor(ft);
    crWeights(fu - iu, this.wu);
    crWeights(ft - it, this.wt);
    vals.fill(0);
    for (let a = 0; a < 4; a++) {
      const ia = clamp(iu + a - 1, 0, nu - 1);
      const rowBase = ia * nth;
      const wua = this.wu[a];
      if (wua === 0) continue;
      for (let b = 0; b < 4; b++) {
        const wtb = this.wt[b];
        if (wtb === 0) continue;
        let j = it + b - 1;
        let flip = false;
        if (j < 0) {
          j = -j;
          flip = true;
        }
        if (j > nth - 1) {
          j = 2 * (nth - 1) - j;
          flip = true;
        }
        const w = wua * wtb;
        const base = rowBase + j;
        for (let k = 0; k < vals.length; k++) {
          const v = data[k * stride + base];
          vals[k] += w * (flip ? v * parity[k] : v);
        }
      }
    }
    return vals;
  }

  /**
   * Acceleration + potential at a cartesian point IN THE GRID FRAME
   * (galactocentric for axisymmetric models, bar frame for fourier3d models).
   */
  accelPhi(x: number, y: number, z: number, out: AccelPhi): void {
    let r = Math.sqrt(x * x + y * y + z * z);
    const rmin = Math.pow(10, this.u0);
    if (r < rmin) r = rmin;
    const u = Math.log10(r);
    const th = Math.acos(clamp(z / r, -1, 1));
    const ph = Math.atan2(y, x);
    const vals = this.evalArrays(u, th);

    let phi = 0;
    let ar = 0;
    let ath = 0;
    let aph = 0;
    if (this.meta.kind === "axisymmetric") {
      phi = vals[this.index.get("Phi")!];
      ar = vals[this.index.get("ar")!];
      ath = vals[this.index.get("ath")!];
    } else {
      for (const m of this.meta.moments!) {
        const cm = Math.cos(m * ph);
        const sm = Math.sin(m * ph);
        const kPhiC = this.index.get(`Phi_C${m}`);
        const kPhiS = this.index.get(`Phi_S${m}`);
        const kArC = this.index.get(`ar_C${m}`);
        const kArS = this.index.get(`ar_S${m}`);
        const kAthC = this.index.get(`ath_C${m}`);
        const kAthS = this.index.get(`ath_S${m}`);
        const kAphC = this.index.get(`aphi_C${m}`);
        const kAphS = this.index.get(`aphi_S${m}`);
        if (kPhiC !== undefined) phi += cm * vals[kPhiC];
        if (kPhiS !== undefined) phi += sm * vals[kPhiS];
        if (kArC !== undefined) ar += cm * vals[kArC];
        if (kArS !== undefined) ar += sm * vals[kArS];
        if (kAthC !== undefined) ath += cm * vals[kAthC];
        if (kAthS !== undefined) ath += sm * vals[kAthS];
        if (kAphC !== undefined) aph += cm * vals[kAphC];
        if (kAphS !== undefined) aph += sm * vals[kAphS];
      }
    }

    const st = Math.sin(th);
    const ct = Math.cos(th);
    const sp = Math.sin(ph);
    const cp = Math.cos(ph);
    out.ax = ar * st * cp + ath * ct * cp - aph * sp;
    out.ay = ar * st * sp + ath * ct * sp + aph * cp;
    out.az = ar * ct - ath * st;
    out.phi = phi;
  }

  /** Circular speed from the exported rotation curve (linear interp in log R). */
  vcirc(R: number): number {
    const { R_kpc, vc_kms } = this.meta.rotationCurve;
    if (R <= R_kpc[0]) return vc_kms[0];
    if (R >= R_kpc[R_kpc.length - 1]) return vc_kms[vc_kms.length - 1];
    let lo = 0;
    let hi = R_kpc.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (R_kpc[mid] <= R) lo = mid;
      else hi = mid;
    }
    const t =
      (Math.log(R) - Math.log(R_kpc[lo])) /
      (Math.log(R_kpc[hi]) - Math.log(R_kpc[lo]));
    return vc_kms[lo] + t * (vc_kms[hi] - vc_kms[lo]);
  }
}

/** Rotate (x, y) about z by angle (radians), in place on a length-3+ view. */
export function rotZ(
  v: { x: number; y: number },
  angle: number,
): { x: number; y: number } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: c * v.x - s * v.y, y: s * v.x + c * v.y };
}
