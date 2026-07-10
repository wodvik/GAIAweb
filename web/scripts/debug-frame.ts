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

for (const i of [0, 1, 2]) {
  const oc = orbits.columns;
  const sid = oc.source_id[i] as string;
  const j = mIndex.get(sid)!;
  const mc = master.columns;
  const obs = {
    ra_deg: mc.ra[j] as number,
    dec_deg: mc.dec[j] as number,
    dist_pc: oc.dist_pc_final_screen[i] as number,
    pmra_masyr: mc.pmra[j] as number,
    pmdec_masyr: mc.pmdec[j] as number,
    rv_kms: mc.radial_velocity[j] as number,
  };
  const g = icrsToGalactocentric(obs, SOLAR_VARIANTS.default);
  console.log(sid, "dist_pc", obs.dist_pc);
  console.log(
    "  got  ",
    [g.x, g.y, g.z].map((v) => v.toFixed(4)).join(", "),
    "|",
    [g.vx, g.vy, g.vz].map((v) => v.toFixed(2)).join(", "),
  );
  console.log(
    "  want ",
    [oc.x_kpc[i], oc.y_kpc[i], oc.z_kpc[i]]
      .map((v) => (v as number).toFixed(4))
      .join(", "),
    "|",
    [oc.vx_kms[i], oc.vy_kms[i], oc.vz_kms[i]]
      .map((v) => (v as number).toFixed(2))
      .join(", "),
  );
}
