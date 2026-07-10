/**
 * ICRS -> Galactocentric transform, matching astropy's Galactocentric frame
 * (v4.0 defaults for the galactic-centre direction and roll) with the release
 * solar conventions from config.yml (solar_variants).
 *
 * Definition (astropy): the galactic centre lies at ICRS
 * (ra, dec) = (266.4051, -28.936175) deg (Reid & Brunthaler 2004), roll = 0.
 * The Sun sits at (-sqrt(d^2 - z_sun^2), 0, z_sun) and moves with
 * galcen_v_sun = (U, Vc + V, W).
 *
 * Validated against the release orbit initial conditions (x_kpc..vz_kms in
 * catalogue_expanded_orbits_tierABC.csv) by scripts/validate-frame.ts.
 */

export interface SolarVariant {
  R0_kpc: number;
  z_sun_pc: number;
  Vc_kms: number;
  U_kms: number;
  V_kms: number;
  W_kms: number;
}

export const SOLAR_VARIANTS: Record<string, SolarVariant> = {
  default: { R0_kpc: 8.178, z_sun_pc: 25.0, Vc_kms: 229.0, U_kms: 11.1, V_kms: 12.24, W_kms: 7.25 },
  grav22: { R0_kpc: 8.275, z_sun_pc: 25.0, Vc_kms: 229.0, U_kms: 11.1, V_kms: 12.24, W_kms: 7.25 },
  lsr6: { R0_kpc: 8.178, z_sun_pc: 25.0, Vc_kms: 232.0, U_kms: 11.1, V_kms: 6.0, W_kms: 7.25 },
  rb20: { R0_kpc: 8.178, z_sun_pc: 25.0, Vc_kms: 248.5, U_kms: 11.1, V_kms: 12.24, W_kms: 7.25 },
};

const DEG = Math.PI / 180;
/** km/s per (mas/yr at 1 kpc) */
export const KAPPA = 4.740470463533349;

const GC_RA = 266.4051 * DEG;
const GC_DEC = -28.936175 * DEG;
/** astropy's roll0: rotation about x aligning the frame's +z with galactic
 * north after the GC direction is brought to +x */
const ROLL0 = 58.5986320306084 * DEG;

type Mat3 = [number, number, number, number, number, number, number, number, number];

function matMul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9) as Mat3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      out[3 * i + j] =
        a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j];
    }
  return out;
}

function matVec(m: Mat3, v: [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** rotation matrix about y axis by angle a (astropy rotation_matrix convention:
 * rotates vectors by -a, i.e. R(a) v rotates the frame) */
function rotY(a: Mat3 | number): Mat3 {
  const t = a as number;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [c, 0, -s, 0, 1, 0, s, 0, c];
}

function rotZ(t: number): Mat3 {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}

function rotX(t: number): Mat3 {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}

export interface ICRSKinematics {
  ra_deg: number;
  dec_deg: number;
  dist_pc: number;
  pmra_masyr: number; // mu_alpha* (includes cos dec)
  pmdec_masyr: number;
  rv_kms: number;
}

export interface GalactocentricState {
  x: number; // kpc
  y: number;
  z: number;
  vx: number; // km/s
  vy: number;
  vz: number;
  vgrf: number;
}

/** build the ICRS->Galactocentric rotation + tilt for a solar variant */
export function frameMatrices(sv: SolarVariant): {
  R: Mat3;
  H: Mat3;
  d: number;
  zsun: number;
  vsun: [number, number, number];
} {
  // R aligns the galactic-centre direction with +x and galactic north with +z
  const R = matMul(rotX(ROLL0), matMul(rotY(-GC_DEC), rotZ(GC_RA)));
  const d = sv.R0_kpc;
  const zsun = sv.z_sun_pc / 1000;
  const theta = Math.asin(zsun / d);
  const H = rotY(-theta);
  return { R, H, d, zsun, vsun: [sv.U_kms, sv.Vc_kms + sv.V_kms, sv.W_kms] };
}

export function icrsToGalactocentric(
  obs: ICRSKinematics,
  variant: SolarVariant = SOLAR_VARIANTS.default,
): GalactocentricState {
  const { R, H, d, vsun } = frameMatrices(variant);
  const ra = obs.ra_deg * DEG;
  const dec = obs.dec_deg * DEG;
  const dist = obs.dist_pc / 1000; // kpc

  const cr = Math.cos(ra);
  const sr = Math.sin(ra);
  const cd = Math.cos(dec);
  const sd = Math.sin(dec);

  // ICRS cartesian position (kpc)
  const p: [number, number, number] = [dist * cd * cr, dist * cd * sr, dist * sd];

  // ICRS cartesian velocity (km/s): unit vectors e_ra, e_dec, e_r
  const vra = KAPPA * obs.pmra_masyr * dist; // km/s along e_ra
  const vdec = KAPPA * obs.pmdec_masyr * dist;
  const vr = obs.rv_kms;
  const v: [number, number, number] = [
    -sr * vra - cr * sd * vdec + cd * cr * vr,
    cr * vra - sr * sd * vdec + cd * sr * vr,
    cd * vdec + sd * vr,
  ];

  // rotate so GC is on +x, translate Sun->GC, tilt for z_sun
  const p1 = matVec(R, p);
  p1[0] -= d;
  const pg = matVec(H, p1);
  const v1 = matVec(R, v);
  const vg = matVec(H, v1);
  vg[0] += vsun[0];
  vg[1] += vsun[1];
  vg[2] += vsun[2];

  const vgrf = Math.hypot(vg[0], vg[1], vg[2]);
  return { x: pg[0], y: pg[1], z: pg[2], vx: vg[0], vy: vg[1], vz: vg[2], vgrf };
}
