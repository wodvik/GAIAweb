"use client";
/**
 * React hook managing orbit integrations through the Web Worker.
 * Keyed by (objectId, modelId, omega): results are cached, in-flight requests
 * deduplicated, and stale results for deselected objects kept (cheap).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { OrbitSummary } from "./summary";

export interface OrbitResult {
  key: string;
  objectId: string;
  modelId: string;
  omega: number;
  positions: Float32Array; // interleaved x,y,z (galactocentric-aligned rotating frame)
  velocities: Float32Array;
  phi: Float32Array;
  summary: OrbitSummary;
  elapsedMs: number;
  nSteps: number;
}

export interface OrbitRequestSpec {
  objectId: string;
  ic: number[];
  modelId: string;
  omega: number;
  samples?: number;
  tGyr?: number;
  /** Model-Lab composite settings (component multipliers + BH + frame). */
  lab?: {
    k: Record<string, number>;
    kBH: number;
    rotating: boolean;
  };
  /** cache discriminator for lab requests (encode multipliers here) */
  labSig?: string;
}

export function orbitKey(
  objectId: string,
  modelId: string,
  omega: number,
  labSig?: string,
) {
  return `${objectId}|${modelId}|${omega}${labSig ? `|${labSig}` : ""}`;
}

interface WorkerMsg {
  id: number;
  ok?: boolean;
  progress?: number;
  positions?: Float32Array;
  velocities?: Float32Array;
  phi?: Float32Array;
  summary?: OrbitSummary;
  elapsedMs?: number;
  nSteps?: number;
  error?: string;
}

export function useOrbits(requests: OrbitRequestSpec[]) {
  const workerRef = useRef<Worker | null>(null);
  const seqRef = useRef(0);
  const pendingRef = useRef(new Map<number, string>());
  const specsRef = useRef(new Map<string, OrbitRequestSpec>());
  const [results, setResults] = useState<Map<string, OrbitResult>>(new Map());
  const [progress, setProgress] = useState<Map<string, number>>(new Map());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const inFlightRef = useRef(new Set<string>());

  useEffect(() => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    worker.onmessage = (ev: MessageEvent<WorkerMsg>) => {
      const msg = ev.data;
      const key = pendingRef.current.get(msg.id);
      if (!key) return;
      if (msg.progress !== undefined && msg.ok === undefined) {
        setProgress((old) => new Map(old).set(key, msg.progress!));
        return;
      }
      pendingRef.current.delete(msg.id);
      inFlightRef.current.delete(key);
      if (msg.ok) {
        const spec = specsRef.current.get(key);
        setResults((old) => {
          const next = new Map(old);
          // bound memory: each result holds ~1 MB of typed arrays; evict the
          // oldest entries beyond a small cache (Map preserves insert order)
          while (next.size >= 24) {
            const oldest = next.keys().next().value as string;
            next.delete(oldest);
          }
          next.set(key, {
            key,
            objectId: spec?.objectId ?? "",
            modelId: spec?.modelId ?? "",
            omega: spec?.omega ?? 0,
            positions: msg.positions!,
            velocities: msg.velocities!,
            phi: msg.phi!,
            summary: msg.summary!,
            elapsedMs: msg.elapsedMs ?? 0,
            nSteps: msg.nSteps ?? 0,
          });
          return next;
        });
        setProgress((old) => {
          const next = new Map(old);
          next.delete(key);
          return next;
        });
      } else {
        setErrors((old) => new Map(old).set(key, msg.error ?? "unknown error"));
      }
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
      pendingRef.current.clear();
      inFlightRef.current.clear();
    };
  }, []);

  // request whatever is missing
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;
    for (const spec of requests) {
      const key = orbitKey(spec.objectId, spec.modelId, spec.omega, spec.labSig);
      if (results.has(key) || inFlightRef.current.has(key)) continue;
      inFlightRef.current.add(key);
      specsRef.current.set(key, spec);
      const id = ++seqRef.current;
      pendingRef.current.set(id, key);
      worker.postMessage({
        id,
        modelId: spec.modelId,
        ic: spec.ic,
        omega: spec.omega,
        samples: spec.samples,
        tGyr: spec.tGyr,
        lab: spec.lab,
      });
    }
  }, [requests, results]);

  return useMemo(
    () => ({ results, progress, errors }),
    [results, progress, errors],
  );
}
