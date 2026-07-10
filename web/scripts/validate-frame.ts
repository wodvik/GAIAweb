/**
 * Validate the TypeScript ICRS->Galactocentric transform against the release
 * orbit initial conditions (produced with astropy in phase0g).
 * Run: npx tsx scripts/validate-frame.ts
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  icrsToGalactocentric,
  SOLAR_VARIANTS,
} from "../src/lib/astro/galactocentric";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "public", "data");

interface ColFile {
  n: number;
  columns: Record<string, (number | string | null)[]>;
}

const orbits = JSON.parse(
  readFileSync(join(dataDir, "catalogue", "orbits.json"), "utf8"),
) as ColFile;
const master = JSON.parse(
  readFileSync(join(dataDir, "catalogue", "master.json"), "utf8"),
) as ColFile;

const mIndex = new Map<string, number>();
(master.columns.source_id as string[]).forEach((s, i) => mIndex.set(s, i));

let maxPos = 0;
let maxVel = 0;
let n = 0;
const oc = orbits.columns;
for (let i = 0; i < orbits.n; i++) {
  const sid = oc.source_id[i] as string;
  const j = mIndex.get(sid);
  if (j === undefined) continue;
  const mc = master.columns;
  const obs = {
    ra_deg: mc.ra[j] as number,
    dec_deg: mc.dec[j] as number,
    dist_pc: oc.dist_pc_final_screen[i] as number,
    pmra_masyr: mc.pmra[j] as number,
    pmdec_masyr: mc.pmdec[j] as number,
    rv_kms: mc.radial_velocity[j] as number,
  };
  if (Object.values(obs).some((v) => typeof v !== "number" || Number.isNaN(v)))
    continue;
  const g = icrsToGalactocentric(obs, SOLAR_VARIANTS.default);
  const dp = Math.hypot(
    g.x - (oc.x_kpc[i] as number),
    g.y - (oc.y_kpc[i] as number),
    g.z - (oc.z_kpc[i] as number),
  );
  const dv = Math.hypot(
    g.vx - (oc.vx_kms[i] as number),
    g.vy - (oc.vy_kms[i] as number),
    g.vz - (oc.vz_kms[i] as number),
  );
  if (dp > maxPos) maxPos = dp;
  if (dv > maxVel) maxVel = dv;
  n++;
}
console.log(
  `frame check over ${n} stars: max |dpos| = ${(maxPos * 1e6).toFixed(3)} mpc, ` +
    `max |dvel| = ${(maxVel * 1000).toFixed(4)} m/s`,
);
if (maxPos > 1e-6 || maxVel > 1e-3) {
  console.error("FRAME MISMATCH — do not ship");
  process.exit(1);
}
console.log("PASS");
