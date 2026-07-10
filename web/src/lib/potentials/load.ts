/** Loading of exported potential grids (browser fetch or Node fs). */

import { PotentialModel } from "./model";
import type { PotentialMeta } from "./types";

export const MODEL_IDS = [
  "hunter24_axi",
  "mcmillan17",
  "hunter24_bar",
  "portail17",
] as const;
export type ModelId = (typeof MODEL_IDS)[number];

const cache = new Map<string, Promise<PotentialModel>>();

export function loadPotential(
  id: ModelId,
  baseUrl = "/data/potentials",
): Promise<PotentialModel> {
  const key = `${baseUrl}/${id}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const [metaRes, binRes] = await Promise.all([
        fetch(`${baseUrl}/${id}.meta.json`),
        fetch(`${baseUrl}/${id}.f32`),
      ]);
      if (!metaRes.ok || !binRes.ok) {
        throw new Error(`failed to load potential ${id}`);
      }
      const meta = (await metaRes.json()) as PotentialMeta;
      const buf = await binRes.arrayBuffer();
      return new PotentialModel(meta, buf);
    })();
    cache.set(key, p);
  }
  return p;
}
