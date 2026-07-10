/**
 * Full-catalogue validation of the browser orbit engine.
 *
 * Integrates all 1,952 Tier A+B+C stars with the TypeScript integrator on the
 * exported potential grids and compares R_peri / R_apo / z_max / ecc (and for
 * the barred model the Jacobi-energy conservation) against the published
 * point-estimate columns of catalogue_expanded_orbits_tierABC.csv, which were
 * produced with AGAMA DOP853 (release script phase0g_expanded_orbits.py).
 *
 * Writes web/public/data/validation.json, which the site's provenance page
 * displays. Run:  npx tsx scripts/validate.ts [nStars] [static|barred|both]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { PotentialModel } from "../src/lib/potentials/model";
import type { PotentialMeta } from "../src/lib/potentials/types";
import { integrateOrbit } from "../src/lib/orbit/integrate";
import { summarizeOrbit } from "../src/lib/orbit/summary";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "public", "data");

function loadModel(id: string): PotentialModel {
  const meta = JSON.parse(
    readFileSync(join(dataDir, "potentials", `${id}.meta.json`), "utf8"),
  ) as PotentialMeta;
  const buf = readFileSync(join(dataDir, "potentials", `${id}.f32`));
  return new PotentialModel(
    meta,
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
}

interface OrbitsFile {
  n: number;
  columns: Record<string, (number | string | null)[]>;
}

function percentile(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function stats(diffs: number[]) {
  const s = [...diffs].sort((a, b) => a - b);
  return {
    n: s.length,
    p50: percentile(s, 0.5),
    p95: percentile(s, 0.95),
    p99: percentile(s, 0.99),
    max: s[s.length - 1],
  };
}

function run(
  modelId: string,
  prefix: "static" | "barred",
  omega: number,
  orbits: OrbitsFile,
  nStars: number,
) {
  const model = loadModel(modelId);
  const c = orbits.columns;
  const n = Math.min(nStars, orbits.n);
  const dPeri: number[] = [];
  const dApo: number[] = [];
  const dZmax: number[] = [];
  const dEcc: number[] = [];
  const eDrift: number[] = [];
  const worst: {
    source_id: string;
    dPeri_pc: number;
    got: number;
    ref: number;
  }[] = [];
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const ic = [
      c.x_kpc[i] as number,
      c.y_kpc[i] as number,
      c.z_kpc[i] as number,
      c.vx_kms[i] as number,
      c.vy_kms[i] as number,
      c.vz_kms[i] as number,
    ];
    const traj = integrateOrbit(model, ic, { omega });
    const s = summarizeOrbit(traj);
    const refPeri = c[`${prefix}_R_peri_kpc`][i] as number;
    const refApo = c[`${prefix}_R_apo_kpc`][i] as number;
    const refZ = c[`${prefix}_z_max_kpc`][i] as number;
    const refEcc = c[`${prefix}_ecc`][i] as number;
    const dp = Math.abs(s.R_peri_kpc - refPeri) * 1000;
    dPeri.push(dp);
    dApo.push(Math.abs(s.R_apo_kpc - refApo) * 1000);
    dZmax.push(Math.abs(s.z_max_kpc - refZ) * 1000);
    dEcc.push(Math.abs(s.ecc - refEcc));
    eDrift.push(omega !== 0 ? s.EJ_drift_rel : s.E_drift_rel);
    worst.push({
      source_id: c.source_id[i] as string,
      dPeri_pc: dp,
      got: s.R_peri_kpc,
      ref: refPeri,
    });
    if ((i + 1) % 100 === 0) {
      const rate = (i + 1) / ((Date.now() - t0) / 1000);
      console.log(
        `  [${modelId}] ${i + 1}/${n} orbits (${rate.toFixed(1)}/s)`,
      );
    }
  }
  worst.sort((a, b) => b.dPeri_pc - a.dPeri_pc);
  const report = {
    model: modelId,
    referenceColumns: `${prefix}_*`,
    omega,
    nStars: n,
    R_peri_absdiff_pc: stats(dPeri),
    R_apo_absdiff_pc: stats(dApo),
    z_max_absdiff_pc: stats(dZmax),
    ecc_absdiff: stats(dEcc),
    energy_drift_rel: stats(eDrift),
    worst5_R_peri: worst.slice(0, 5),
    elapsed_s: (Date.now() - t0) / 1000,
  };
  console.log(
    `[${modelId} vs ${prefix}_*] n=${n}  ` +
      `dR_peri p50=${report.R_peri_absdiff_pc.p50.toFixed(3)} pc ` +
      `p99=${report.R_peri_absdiff_pc.p99.toFixed(2)} max=${report.R_peri_absdiff_pc.max.toFixed(2)} | ` +
      `dR_apo p50=${report.R_apo_absdiff_pc.p50.toFixed(3)} pc | ` +
      `decc p50=${report.ecc_absdiff.p50.toExponential(2)} | ` +
      `Edrift p50=${report.energy_drift_rel.p50.toExponential(2)}`,
  );
  return report;
}

const nStars = process.argv[2] ? parseInt(process.argv[2], 10) : Infinity;
const which = process.argv[3] ?? "both";

const orbits = JSON.parse(
  readFileSync(join(dataDir, "catalogue", "orbits.json"), "utf8"),
) as OrbitsFile;

const reports: unknown[] = [];
if (which === "static" || which === "both") {
  reports.push(run("hunter24_axi", "static", 0, orbits, nStars));
}
if (which === "barred" || which === "both") {
  reports.push(run("hunter24_bar", "barred", -37.5, orbits, nStars));
}

const out = {
  generated: new Date().toISOString(),
  description:
    "In-browser (TypeScript) orbit engine vs published catalogue orbit columns " +
    "(AGAMA DOP853, release v1.0.8-review). Differences in absolute value.",
  reports,
};
writeFileSync(join(dataDir, "validation.json"), JSON.stringify(out, null, 2));
console.log("wrote public/data/validation.json");
