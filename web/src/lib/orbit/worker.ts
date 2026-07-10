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
import { integrateOrbit } from "./integrate";
import { summarizeOrbit } from "./summary";

interface OrbitRequest {
  id: number;
  modelId: string;
  ic: number[];
  omega: number;
  tGyr?: number;
  samples?: number;
}

const models = new Map<string, Promise<PotentialModel>>();

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
  const { id, modelId, ic, omega, tGyr, samples } = ev.data;
  try {
    const model = await getModel(modelId);
    const t0 = performance.now();
    const traj = integrateOrbit(model, ic, {
      omega,
      tGyr,
      samples,
      onProgress: (frac) => {
        self.postMessage({ id, progress: frac });
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
