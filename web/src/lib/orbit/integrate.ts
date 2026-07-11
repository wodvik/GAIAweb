/**
 * Orbit integration on a PotentialModel, reproducing the release pipeline
 * conventions (phase0g_expanded_orbits.py):
 *
 *  - 4 Gyr (time T = 4 / 0.9778 in kpc/(km/s) units), 40,001 uniform samples
 *  - barred models: integration in the corotating frame with pattern speed
 *    Omega (negative = clockwise), i.e. a = -grad(Phi) - 2 Omega ez x v
 *    + Omega^2 (x, y, 0); trajectory reported in rotating-frame coordinates
 *  - cylindrical pericentre from parabola interpolation at dR = 0 (pmin)
 *
 * Integrator: Dormand-Prince RK5(4) with adaptive PI step control and cubic
 * Hermite dense output. Tolerances default to rtol 1e-9 / atol 1e-12, which
 * the Node validation harness shows reproduces the published static_* /
 * barred_* orbit columns (AGAMA DOP853) to sub-parsec level.
 *
 * Frame bookkeeping for barred models: the force grid is stored in the BAR
 * frame while catalogue initial conditions are galactocentric. We rotate ICs
 * into the bar frame, integrate there, and rotate the output back, so the
 * returned trajectory is in the release's rotating frame (bar at its
 * present-day angle of -0.44 rad, frozen).
 */

/** Anything integrable: the grid-backed PotentialModel or the Model-Lab
 * CompositeModel. */
export interface OrbitModel {
  readonly isRotating: boolean;
  readonly meta: { barAngleRad?: number; barRotationSign?: number };
  accelPhi(
    x: number,
    y: number,
    z: number,
    out: { ax: number; ay: number; az: number; phi: number },
  ): void;
}

export const TIME_UNIT_GYR = 0.9778;
export const DEFAULT_T_GYR = 4.0;
export const DEFAULT_SAMPLES = 40001;

// Dormand-Prince coefficients (RK45, FSAL)
const A21 = 1 / 5;
const A31 = 3 / 40,
  A32 = 9 / 40;
const A41 = 44 / 45,
  A42 = -56 / 15,
  A43 = 32 / 9;
const A51 = 19372 / 6561,
  A52 = -25360 / 2187,
  A53 = 64448 / 6561,
  A54 = -212 / 729;
const A61 = 9017 / 3168,
  A62 = -355 / 33,
  A63 = 46732 / 5247,
  A64 = 49 / 176,
  A65 = -5103 / 18656;
const B1 = 35 / 384,
  B3 = 500 / 1113,
  B4 = 125 / 192,
  B5 = -2187 / 6784,
  B6 = 11 / 84;
const E1 = 71 / 57600,
  E3 = -71 / 16695,
  E4 = 71 / 1920,
  E5 = -17253 / 339200,
  E6 = 22 / 525,
  E7 = -1 / 40;

export interface IntegrationOptions {
  tGyr?: number;
  samples?: number;
  omega?: number; // pattern speed in the release sign convention (e.g. -37.5)
  rtol?: number;
  atol?: number;
  /** progress callback, called with fraction complete in [0,1] */
  onProgress?: (frac: number) => void;
  /** polled periodically; return true to abort (throws OrbitAbort) */
  shouldAbort?: () => boolean;
}

/** Thrown when an integration is superseded and aborts mid-run. */
export class OrbitAbort extends Error {
  constructor() {
    super("orbit integration aborted");
    this.name = "OrbitAbort";
  }
}

export interface Trajectory {
  /** uniform sample times, in kpc/(km/s) units */
  t: Float64Array;
  /** positions+velocities in the (rotating, galactocentric-aligned) frame */
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  vz: Float64Array;
  /** potential at each sample (grid frame value, rotation-invariant) */
  phi: Float64Array;
  omega: number;
  nSteps: number;
  nRejected: number;
}

interface Derivative {
  (t: number, w: Float64Array, dw: Float64Array): void;
}

export function integrateOrbit(
  model: OrbitModel,
  icGalactocentric: readonly number[],
  opts: IntegrationOptions = {},
): Trajectory {
  const tGyr = opts.tGyr ?? DEFAULT_T_GYR;
  const samples = opts.samples ?? DEFAULT_SAMPLES;
  const omega = opts.omega ?? 0;
  const rtol = opts.rtol ?? 1e-10;
  const atol = opts.atol ?? 1e-13;
  const tmax = tGyr / TIME_UNIT_GYR;

  // rotate ICs into the grid frame (bar frame for fourier3d models)
  const barRot =
    model.isRotating && model.meta.barAngleRad !== undefined
      ? (model.meta.barRotationSign ?? 1) * model.meta.barAngleRad
      : 0;
  const cB = Math.cos(barRot);
  const sB = Math.sin(barRot);
  const [gx, gy, gz, gvx, gvy, gvz] = icGalactocentric;
  const w = new Float64Array(6);
  w[0] = cB * gx - sB * gy;
  w[1] = sB * gx + cB * gy;
  w[2] = gz;
  w[3] = cB * gvx - sB * gvy;
  w[4] = sB * gvx + cB * gvy;
  w[5] = gvz;
  // Catalogue ICs carry INERTIAL velocities. The rotating-frame state uses
  // u = dx_rot/dt = v - Omega x r (agama.orbit(Omega=...) takes and returns
  // velocities as inertial vectors projected on rotating axes — that is what
  // makes the release's E_J = E - Omega*Lz conserved — so we convert here and
  // convert back when recording).
  if (omega !== 0) {
    w[3] += omega * w[1];
    w[4] -= omega * w[0];
  }

  const acc = { ax: 0, ay: 0, az: 0, phi: 0 };
  const om2 = omega * omega;
  const rhs: Derivative = (_t, s, ds) => {
    model.accelPhi(s[0], s[1], s[2], acc);
    ds[0] = s[3];
    ds[1] = s[4];
    ds[2] = s[5];
    ds[3] = acc.ax;
    ds[4] = acc.ay;
    ds[5] = acc.az;
    if (omega !== 0) {
      ds[3] += 2 * omega * s[4] + om2 * s[0];
      ds[4] += -2 * omega * s[3] + om2 * s[1];
    }
  };

  const out: Trajectory = {
    t: new Float64Array(samples),
    x: new Float64Array(samples),
    y: new Float64Array(samples),
    z: new Float64Array(samples),
    vx: new Float64Array(samples),
    vy: new Float64Array(samples),
    vz: new Float64Array(samples),
    phi: new Float64Array(samples),
    omega,
    nSteps: 0,
    nRejected: 0,
  };
  const dtSample = tmax / (samples - 1);
  for (let i = 0; i < samples; i++) out.t[i] = i * dtSample;

  // un-rotate from grid frame back to the galactocentric-aligned frame, and
  // convert velocities back to inertial vectors on rotating axes
  const record = (i: number, tv: number, s: Float64Array) => {
    let svx = s[3];
    let svy = s[4];
    if (omega !== 0) {
      svx -= omega * s[1]; // v = u + Omega x r
      svy += omega * s[0];
    }
    out.x[i] = cB * s[0] + sB * s[1];
    out.y[i] = -sB * s[0] + cB * s[1];
    out.z[i] = s[2];
    out.vx[i] = cB * svx + sB * svy;
    out.vy[i] = -sB * svx + cB * svy;
    out.vz[i] = s[5];
    model.accelPhi(s[0], s[1], s[2], acc);
    out.phi[i] = acc.phi;
    void tv;
  };

  // --- adaptive Dormand-Prince loop with cubic Hermite dense output ---
  const n = 6;
  const k1 = new Float64Array(n);
  const k2 = new Float64Array(n);
  const k3 = new Float64Array(n);
  const k4 = new Float64Array(n);
  const k5 = new Float64Array(n);
  const k6 = new Float64Array(n);
  const k7 = new Float64Array(n);
  const tmp = new Float64Array(n);
  const wNew = new Float64Array(n);
  const err = new Float64Array(n);

  let t = 0;
  rhs(t, w, k1);
  record(0, 0, w);
  let nextSample = 1;

  // initial step: a small fraction of the inner dynamical time
  let h = Math.min(1e-4, tmax / 1000);
  const hMax = tmax / 50;
  let prevErrNorm = 1;

  // hCtrl is the controller-chosen step; the executed step h is additionally
  // clamped to land exactly on the next sample time so that every recorded
  // point is a true error-controlled solution point (no dense-output error in
  // the R_peri parabola interpolation), matching the release pipeline.
  let hCtrl = h;
  while (t < tmax && nextSample < samples) {
    h = hCtrl;
    if (t + h > tmax) h = tmax - t;
    if (nextSample < samples && t + h > out.t[nextSample] + 1e-15) {
      h = out.t[nextSample] - t;
    }

    for (let i = 0; i < n; i++) tmp[i] = w[i] + h * A21 * k1[i];
    rhs(t + h / 5, tmp, k2);
    for (let i = 0; i < n; i++)
      tmp[i] = w[i] + h * (A31 * k1[i] + A32 * k2[i]);
    rhs(t + (3 * h) / 10, tmp, k3);
    for (let i = 0; i < n; i++)
      tmp[i] = w[i] + h * (A41 * k1[i] + A42 * k2[i] + A43 * k3[i]);
    rhs(t + (4 * h) / 5, tmp, k4);
    for (let i = 0; i < n; i++)
      tmp[i] =
        w[i] + h * (A51 * k1[i] + A52 * k2[i] + A53 * k3[i] + A54 * k4[i]);
    rhs(t + (8 * h) / 9, tmp, k5);
    for (let i = 0; i < n; i++)
      tmp[i] =
        w[i] +
        h * (A61 * k1[i] + A62 * k2[i] + A63 * k3[i] + A64 * k4[i] + A65 * k5[i]);
    rhs(t + h, tmp, k6);
    for (let i = 0; i < n; i++)
      wNew[i] =
        w[i] +
        h * (B1 * k1[i] + B3 * k3[i] + B4 * k4[i] + B5 * k5[i] + B6 * k6[i]);
    rhs(t + h, wNew, k7);

    // error estimate
    let errNorm = 0;
    for (let i = 0; i < n; i++) {
      err[i] =
        h *
        (E1 * k1[i] + E3 * k3[i] + E4 * k4[i] + E5 * k5[i] + E6 * k6[i] +
          E7 * k7[i]);
      const sc = atol + rtol * Math.max(Math.abs(w[i]), Math.abs(wNew[i]));
      const r = err[i] / sc;
      errNorm += r * r;
    }
    errNorm = Math.sqrt(errNorm / n);

    if (errNorm <= 1) {
      const tNew = t + h;
      if (nextSample < samples && Math.abs(out.t[nextSample] - tNew) <= 1e-15) {
        record(nextSample, tNew, wNew);
        nextSample++;
      }
      t = tNew;
      w.set(wNew);
      k1.set(k7); // FSAL
      out.nSteps++;
      if (out.nSteps % 256 === 0) {
        if (opts.onProgress) opts.onProgress(t / tmax);
        if (opts.shouldAbort && opts.shouldAbort()) throw new OrbitAbort();
      }
      // PI step-size control on the controller step (not the clamped one)
      const fac =
        0.9 * Math.pow(errNorm || 1e-10, -0.7 / 5) * Math.pow(prevErrNorm, 0.4 / 5);
      hCtrl = h * Math.min(5, Math.max(0.2, fac));
      if (hCtrl > hMax) hCtrl = hMax;
      prevErrNorm = errNorm || 1e-10;
    } else {
      out.nRejected++;
      hCtrl = h * Math.max(0.1, 0.9 * Math.pow(errNorm, -1 / 5));
    }
    if (hCtrl < 1e-14)
      throw new Error("step size underflow in orbit integration");
  }
  if (opts.onProgress) opts.onProgress(1);
  return out;
}
