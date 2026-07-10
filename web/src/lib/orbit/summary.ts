/**
 * Orbit summary statistics, mirroring orbit_summary() and pmin() in the
 * release script phase0g_expanded_orbits.py so that in-browser results are
 * directly comparable to the published static_* / barred_* columns.
 */

import type { Trajectory } from "./integrate";

export interface OrbitSummary {
  R_peri_kpc: number;
  R_apo_kpc: number;
  z_max_kpc: number;
  min_r_sph_kpc: number;
  ecc: number;
  n_peri: number;
  E_drift_rel: number;
  E_range_rel: number;
  EJ_drift_rel: number;
  EJ_range_rel: number;
  Lz_kpc_kms: number;
  E_mean: number;
  EJ_mean: number;
}

/** Parabola-interpolated minimum of R at dR = 0 sign changes (release pmin). */
export function pmin(R: Float64Array): number {
  let best = Infinity;
  for (let i = 0; i < R.length; i++) if (R[i] < best) best = R[i];
  // dR[k-1] < 0 && dR[k] > 0  <=>  R[k] < R[k-1] && R[k+1] > R[k]
  for (let k = 1; k < R.length - 1; k++) {
    const d0 = R[k] - R[k - 1];
    const d1 = R[k + 1] - R[k];
    if (d0 < 0 && d1 > 0) {
      const y0 = R[k - 1];
      const y1 = R[k];
      const y2 = R[k + 1];
      const den = y0 - 2 * y1 + y2;
      if (den > 0) {
        const ym = y1 - ((y0 - y2) * (y0 - y2)) / (8 * den);
        if (ym < best) best = ym;
      }
    }
  }
  return best;
}

export function summarizeOrbit(traj: Trajectory): OrbitSummary {
  const n = traj.x.length;
  const R = new Float64Array(n);
  let rApo = 0;
  let zMax = 0;
  let minRsph = Infinity;
  let lzSum = 0;
  let eMin = Infinity;
  let eMax = -Infinity;
  let ejMin = Infinity;
  let ejMax = -Infinity;
  let eSum = 0;
  let ejSum = 0;
  let eFirst = 0;
  let eLast = 0;
  let ejFirst = 0;
  let ejLast = 0;

  for (let i = 0; i < n; i++) {
    const x = traj.x[i];
    const y = traj.y[i];
    const z = traj.z[i];
    const vx = traj.vx[i];
    const vy = traj.vy[i];
    const vz = traj.vz[i];
    const Rc = Math.hypot(x, y);
    R[i] = Rc;
    if (Rc > rApo) rApo = Rc;
    const az = Math.abs(z);
    if (az > zMax) zMax = az;
    const rs = Math.sqrt(Rc * Rc + z * z);
    if (rs < minRsph) minRsph = rs;
    const lz = x * vy - y * vx;
    lzSum += lz;
    const E = 0.5 * (vx * vx + vy * vy + vz * vz) + traj.phi[i];
    const EJ = E - traj.omega * lz;
    if (E < eMin) eMin = E;
    if (E > eMax) eMax = E;
    if (EJ < ejMin) ejMin = EJ;
    if (EJ > ejMax) ejMax = EJ;
    eSum += E;
    ejSum += EJ;
    if (i === 0) {
      eFirst = E;
      ejFirst = EJ;
    }
    if (i === n - 1) {
      eLast = E;
      ejLast = EJ;
    }
  }

  let nPeri = 0;
  for (let k = 1; k < n - 1; k++) {
    if (R[k] - R[k - 1] < 0 && R[k + 1] - R[k] > 0) nPeri++;
  }
  const rPeri = pmin(R);
  const eMean = eSum / n;
  const ejMean = ejSum / n;

  return {
    R_peri_kpc: rPeri,
    R_apo_kpc: rApo,
    z_max_kpc: zMax,
    min_r_sph_kpc: minRsph,
    ecc: (rApo - rPeri) / (rApo + rPeri),
    n_peri: nPeri,
    E_drift_rel: Math.abs((eLast - eFirst) / eFirst),
    E_range_rel: (eMax - eMin) / Math.abs(eMean),
    EJ_drift_rel: Math.abs((ejLast - ejFirst) / ejFirst),
    EJ_range_rel: (ejMax - ejMin) / Math.abs(ejMean),
    Lz_kpc_kms: lzSum / n,
    E_mean: eMean,
    EJ_mean: ejMean,
  };
}
