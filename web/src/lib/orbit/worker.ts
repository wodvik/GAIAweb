/// <reference lib="webworker" />
/**
 * Orbit integration Web Worker. Loads potential grids on demand (cached per
 * worker) and integrates orbits off the main thread.
 *
 * request:  { id, modelId, ic: number[6], omega, tGyr?, samples? }
 * response: { id, ok, positions: Float32Array (x,y,z interleaved),
 *             velocities: Float32Array, phi: Float32Array, summary, meta }
 */

import { PotentialModel } from "../potentials/model";
import type { PotentialMeta } from "../potentials/types";
import {
  CompositeModel,
  LabIndex,
  LabSettings,
  componentModel,
} from "../potentials/lab";
import { integrateOrbit } from "./integrate";
import { summarizeOrbit } from "./summary";

interface OrbitRequest {
  id: number;
  modelId: string;
  ic: number[];
  omega: number;
  tGyr?: number;
  samples?: number;
  /** Model-Lab composite: component multipliers; when set, modelId selects
   * the base ("lab_static" | "lab_barred") and grids come from /data/lab. */
  lab?: LabSettings & { rotating: boolean };
}

const models = new Map<string, Promise<PotentialModel>>();
let labIndexPromise: Promise<LabIndex> | null = null;
const labParts = new Map<string, Promise<PotentialModel>>();

function getLabIndex(): Promise<LabIndex> {
  if (!labIndexPromise) {
    labIndexPromise = fetch(`${self.location.origin}/data/lab/index.json`).then(
      (r) => {
        if (!r.ok) throw new Error("failed to load lab index");
        return r.json();
      },
    );
  }
  return labIndexPromise;
}

async function getLabPart(id: string): Promise<PotentialModel> {
  let p = labParts.get(id);
  if (!p) {
    p = (async () => {
      const index = await getLabIndex();
      const comp = index.components.find((c) => c.id === id);
      if (!comp) throw new Error(`unknown lab component ${id}`);
      const res = await fetch(`${self.location.origin}/data/lab/${comp.file}`);
      if (!res.ok) throw new Error(`failed to load lab component ${id}`);
      return componentModel(index, comp, await res.arrayBuffer());
    })();
    labParts.set(id, p);
  }
  return p;
}

async function buildComposite(
  lab: LabSettings & { rotating: boolean },
): Promise<CompositeModel> {
  const index = await getLabIndex();
  // static lab uses the axisymmetrised bar; barred lab swaps in the full bar
  const wanted = index.components.filter((c) =>
    lab.rotating ? c.id !== "bar_axi" : c.id !== "bar_full",
  );
  const parts = await Promise.all(
    wanted.map(async (c) => ({
      model: await getLabPart(c.id),
      k: lab.k[c.id] ?? 1,
    })),
  );
  return new CompositeModel(
    parts,
    index.blackHole,
    lab.kBH,
    lab.rotating,
    index.barAngleRad,
    index.barRotationSign,
  );
}

function getModel(modelId: string): Promise<PotentialModel> {
  let p = models.get(modelId);
  if (!p) {
    p = (async () => {
      const base = `${self.location.origin}/data/potentials`;
      const [metaRes, binRes] = await Promise.all([
        fetch(`${base}/${modelId}.meta.json`),
        fetch(`${base}/${modelId}.f32`),
      ]);
      if (!metaRes.ok || !binRes.ok)
        throw new Error(`failed to load potential ${modelId}`);
      const meta = (await metaRes.json()) as PotentialMeta;
      const buf = await binRes.arrayBuffer();
      return new PotentialModel(meta, buf);
    })();
    models.set(modelId, p);
  }
  return p;
}

self.onmessage = async (ev: MessageEvent<OrbitRequest>) => {
  const { id, modelId, ic, omega, tGyr, samples, lab } = ev.data;
  try {
    const model = lab ? await buildComposite(lab) : await getModel(modelId);
    const t0 = performance.now();
    let lastProgress = 0;
    const traj = integrateOrbit(model, ic, {
      omega,
      tGyr,
      samples,
      onProgress: (frac) => {
        const now = performance.now();
        if (now - lastProgress > 120) {
          lastProgress = now;
          self.postMessage({ id, progress: frac });
        }
      },
    });
    const summary = summarizeOrbit(traj);
    const n = traj.x.length;
    const positions = new Float32Array(n * 3);
    const velocities = new Float32Array(n * 3);
    const phi = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      positions[3 * i] = traj.x[i];
      positions[3 * i + 1] = traj.y[i];
      positions[3 * i + 2] = traj.z[i];
      velocities[3 * i] = traj.vx[i];
      velocities[3 * i + 1] = traj.vy[i];
      velocities[3 * i + 2] = traj.vz[i];
      phi[i] = traj.phi[i];
    }
    self.postMessage(
      {
        id,
        ok: true,
        positions,
        velocities,
        phi,
        summary,
        elapsedMs: performance.now() - t0,
        nSteps: traj.nSteps,
        omega,
        modelId,
      },
      { transfer: [positions.buffer, velocities.buffer, phi.buffer] },
    );
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err) });
  }
};
