/** Client-side loaders for the exported catalogue JSON (column-oriented). */

export interface ColumnFile {
  release: string;
  n: number;
  columns: Record<string, (number | string | boolean | null)[]>;
}

export interface OrbitStar {
  source_id: string;
  tier: string;
  P_vgrf_below_25: number;
  vgrf_default_exact: number;
  rv_quality: string;
  rvs_quality_ok: boolean;
  ic: [number, number, number, number, number, number];
  static: {
    R_peri_kpc: number;
    R_apo_kpc: number;
    z_max_kpc: number;
    min_r_sph_kpc: number;
    ecc: number;
    Lz_kpc_kms: number;
  };
  barred: {
    R_peri_kpc: number;
    R_apo_kpc: number;
    z_max_kpc: number;
    min_r_sph_kpc: number;
    ecc: number;
    Lz_kpc_kms: number;
  };
  mcmillan?: {
    R_peri_kpc: number;
    R_apo_kpc: number;
    z_max_kpc: number;
    min_r_sph_kpc: number;
    ecc: number;
  };
  mc?: {
    R_peri_kpc: [number, number, number];
    R_apo_kpc: [number, number, number];
    z_max_kpc: [number, number, number];
    ecc: [number, number, number];
  };
  index: number;
}

let orbitsPromise: Promise<ColumnFile> | null = null;

export function loadOrbits(baseUrl = "/data"): Promise<ColumnFile> {
  if (!orbitsPromise) {
    orbitsPromise = fetch(`${baseUrl}/catalogue/orbits.json`).then((r) => {
      if (!r.ok) throw new Error("failed to load orbits.json");
      return r.json();
    });
  }
  return orbitsPromise;
}

let masterPromise: Promise<ColumnFile> | null = null;

export function loadMaster(baseUrl = "/data"): Promise<ColumnFile> {
  if (!masterPromise) {
    masterPromise = fetch(`${baseUrl}/catalogue/master.json`).then((r) => {
      if (!r.ok) throw new Error("failed to load master.json");
      return r.json();
    });
  }
  return masterPromise;
}

function num(f: ColumnFile, col: string, i: number): number {
  const v = f.columns[col]?.[i];
  return typeof v === "number" ? v : NaN;
}

function tri(
  f: ColumnFile,
  base: string,
  i: number,
): [number, number, number] {
  return [num(f, `${base}_p16`, i), num(f, `${base}_p50`, i), num(f, `${base}_p84`, i)];
}

export function orbitStarAt(f: ColumnFile, i: number): OrbitStar {
  return {
    source_id: String(f.columns.source_id[i]),
    tier: String(f.columns.tier[i]),
    P_vgrf_below_25: num(f, "P_vgrf_below_25", i),
    vgrf_default_exact: num(f, "vgrf_default_exact", i),
    rv_quality: String(f.columns.rv_quality[i] ?? ""),
    rvs_quality_ok: f.columns.rvs_quality_ok?.[i] === true,
    ic: [
      num(f, "x_kpc", i),
      num(f, "y_kpc", i),
      num(f, "z_kpc", i),
      num(f, "vx_kms", i),
      num(f, "vy_kms", i),
      num(f, "vz_kms", i),
    ],
    static: {
      R_peri_kpc: num(f, "static_R_peri_kpc", i),
      R_apo_kpc: num(f, "static_R_apo_kpc", i),
      z_max_kpc: num(f, "static_z_max_kpc", i),
      min_r_sph_kpc: num(f, "static_min_r_sph_kpc", i),
      ecc: num(f, "static_ecc", i),
      Lz_kpc_kms: num(f, "static_Lz_kpc_kms", i),
    },
    barred: {
      R_peri_kpc: num(f, "barred_R_peri_kpc", i),
      R_apo_kpc: num(f, "barred_R_apo_kpc", i),
      z_max_kpc: num(f, "barred_z_max_kpc", i),
      min_r_sph_kpc: num(f, "barred_min_r_sph_kpc", i),
      ecc: num(f, "barred_ecc", i),
      Lz_kpc_kms: num(f, "barred_Lz_kpc_kms", i),
    },
    mcmillan: f.columns.mcm_R_peri_kpc
      ? {
          R_peri_kpc: num(f, "mcm_R_peri_kpc", i),
          R_apo_kpc: num(f, "mcm_R_apo_kpc", i),
          z_max_kpc: num(f, "mcm_z_max_kpc", i),
          min_r_sph_kpc: num(f, "mcm_min_r_sph_kpc", i),
          ecc: num(f, "mcm_ecc", i),
        }
      : undefined,
    mc: f.columns.R_peri_kpc_p50
      ? {
          R_peri_kpc: tri(f, "R_peri_kpc", i),
          R_apo_kpc: tri(f, "R_apo_kpc", i),
          z_max_kpc: tri(f, "z_max_kpc", i),
          ecc: tri(f, "ecc", i),
        }
      : undefined,
    index: i,
  };
}

export function findBySourceId(f: ColumnFile, sourceId: string): number {
  const ids = f.columns.source_id as string[];
  return ids.indexOf(sourceId);
}

/** Reference objects (Sun, context stars, featured catalogue stars). */
export interface ReferenceObject {
  id: string;
  label: string;
  category: "context" | "featured";
  why?: string;
  provenance?: string;
  ic: number[];
  tier?: string;
  P_vgrf_below_25?: number;
  static?: {
    summary: Record<string, number>;
    trajectory: number[];
  };
  barred?: {
    summary: Record<string, number>;
    omega_p: number;
    trajectory: number[];
  };
}

export interface ReferenceFile {
  release: string;
  trajPoints: number;
  tGyr: number;
  barAngleRad: number;
  solarVariants: Record<
    string,
    { R0_kpc: number; z_sun_pc: number; Vc_kms: number; U_kms: number; V_kms: number; W_kms: number }
  >;
  objects: ReferenceObject[];
}

let refPromise: Promise<ReferenceFile> | null = null;

export function loadReference(baseUrl = "/data"): Promise<ReferenceFile> {
  if (!refPromise) {
    refPromise = fetch(`${baseUrl}/reference/objects.json`).then((r) => {
      if (!r.ok) throw new Error("failed to load reference objects");
      return r.json();
    });
  }
  return refPromise;
}

export const TIER_COLORS: Record<string, string> = {
  A: "#62d6e8",
  B: "#8fa3f5",
  C: "#e8b46a",
  D: "#9a7ba8",
  X: "#4a5568",
};
