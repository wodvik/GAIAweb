"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColumnFile,
  OrbitStar,
  ReferenceFile,
  ReferenceObject,
  TIER_COLORS,
  findBySourceId,
  loadOrbits,
  loadReference,
  orbitStarAt,
} from "@/lib/data/catalogue";
import { useOrbits, orbitKey, OrbitRequestSpec } from "@/lib/orbit/useOrbits";
import GalaxyScene, { SceneObject, ViewerClock } from "./GalaxyScene";

export const MODELS = [
  {
    id: "hunter24_axi",
    short: "Hunter+24 static",
    long: "Hunter et al. (2024), axisymmetrised — the paper's adopted model",
    barred: false,
    color: "#62d6e8",
    refCol: "static" as const,
  },
  {
    id: "mcmillan17",
    short: "McMillan 2017",
    long: "McMillan (2017) — independent axisymmetric comparison model",
    barred: false,
    color: "#9fe870",
    refCol: "mcmillan" as const,
  },
  {
    id: "hunter24_bar",
    short: "Hunter+24 barred",
    long: "Hunter et al. (2024) full barred model, rigidly rotating",
    barred: true,
    color: "#f0865c",
    refCol: "barred" as const,
  },
  {
    id: "portail17",
    short: "Portail+17 bar",
    long: "Portail et al. (2017) M2M bar — independent barred model",
    barred: true,
    color: "#e070c8",
    refCol: null,
  },
];

export const OMEGA_GRID = [24, 28, 33, 37.5, 41]; // paper sensitivity grid, km/s/kpc

const OBJECT_COLORS = [
  "#62d6e8",
  "#f0865c",
  "#9fe870",
  "#e070c8",
  "#8fa3f5",
  "#e8b46a",
  "#7fe0c3",
  "#f07178",
];

const CONTEXT_COLORS: Record<string, string> = {
  sun: "#ffd869",
  lsr: "#b8c4d4",
  barnard: "#d4a373",
  kapteyn: "#c77dff",
  arcturus: "#ff9770",
  groombridge1830: "#90e0ef",
};

function fmt(v: number | undefined, digits = 3): string {
  if (v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

function fmtPc(kpc: number | undefined): string {
  if (kpc === undefined || Number.isNaN(kpc)) return "—";
  if (Math.abs(kpc) < 1) return `${(kpc * 1000).toFixed(1)} pc`;
  return `${kpc.toFixed(3)} kpc`;
}

export default function OrbitViewer({
  initialStar,
}: {
  initialStar?: string;
}) {
  const [orbits, setOrbits] = useState<ColumnFile | null>(null);
  const [reference, setReference] = useState<ReferenceFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modelId, setModelId] = useState("hunter24_axi");
  const [omegaP, setOmegaP] = useState(37.5);
  const [frame, setFrame] = useState<"rotating" | "inertial">("rotating");
  const [selectedStars, setSelectedStars] = useState<string[]>(
    initialStar ? [initialStar] : [],
  );
  const [selectedContext, setSelectedContext] = useState<string[]>(["sun"]);
  const [search, setSearch] = useState("");
  // Playback state lives in a mutable clock consumed by the render loop.
  // React state here only mirrors it at low frequency for the controls —
  // never drive the animation through setState (see ViewerClock docs).
  const clockRef = useRef<ViewerClock>({ t: 0, playing: true, speed: 1 });
  const [playing, setPlayingState] = useState(true);
  const [speed, setSpeedState] = useState(1);
  const [tDisplay, setTDisplay] = useState(0);
  const [showDisc, setShowDisc] = useState(true);
  const [showAccel, setShowAccel] = useState(false);
  const [showPotential, setShowPotential] = useState(false);

  useEffect(() => {
    loadOrbits().then(setOrbits, (e) => setLoadError(String(e)));
    loadReference().then(setReference, (e) => setLoadError(String(e)));
  }, []);

  // default selection: the deepest Sgr A* approach featured star
  useEffect(() => {
    if (reference && selectedStars.length === 0) {
      const featured = reference.objects.filter((o) => o.category === "featured");
      if (featured.length > 0) {
        setSelectedStars([featured[0].id]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference]);

  const model = MODELS.find((m) => m.id === modelId)!;
  const omega = model.barred ? -omegaP : 0;

  const contextObjects = useMemo(
    () => reference?.objects.filter((o) => o.category === "context") ?? [],
    [reference],
  );
  const featuredObjects = useMemo(
    () => reference?.objects.filter((o) => o.category === "featured") ?? [],
    [reference],
  );

  const stars: OrbitStar[] = useMemo(() => {
    if (!orbits) return [];
    return selectedStars
      .map((sid) => {
        const idx = findBySourceId(orbits, sid);
        return idx >= 0 ? orbitStarAt(orbits, idx) : null;
      })
      .filter((s): s is OrbitStar => s !== null);
  }, [orbits, selectedStars]);

  // orbit integration requests: stars + selected context objects
  const requests: OrbitRequestSpec[] = useMemo(() => {
    const reqs: OrbitRequestSpec[] = [];
    for (const s of stars) {
      reqs.push({ objectId: s.source_id, ic: s.ic, modelId, omega });
    }
    for (const cid of selectedContext) {
      const obj = contextObjects.find((o) => o.id === cid);
      if (obj) reqs.push({ objectId: obj.id, ic: obj.ic, modelId, omega });
    }
    return reqs;
  }, [stars, selectedContext, contextObjects, modelId, omega]);

  const { results, progress, errors } = useOrbits(requests);

  // scene objects
  const sceneObjects: SceneObject[] = useMemo(() => {
    const objs: SceneObject[] = [];
    stars.forEach((s, i) => {
      const r = results.get(orbitKey(s.source_id, modelId, omega));
      if (r)
        objs.push({
          id: s.source_id,
          label: `DR3 …${s.source_id.slice(-6)}`,
          color: OBJECT_COLORS[i % OBJECT_COLORS.length],
          positions: r.positions,
          emphasis: i === 0,
        });
    });
    for (const cid of selectedContext) {
      const obj = contextObjects.find((o) => o.id === cid);
      if (!obj) continue;
      const r = results.get(orbitKey(obj.id, modelId, omega));
      if (r)
        objs.push({
          id: obj.id,
          label: obj.label,
          color: CONTEXT_COLORS[obj.id] ?? "#b8c4d4",
          positions: r.positions,
          emphasis: false,
        });
    }
    return objs;
  }, [stars, selectedContext, contextObjects, results, modelId, omega]);

  // low-frequency mirror of the clock for the slider/readout (4 Hz)
  useEffect(() => {
    const id = setInterval(() => setTDisplay(clockRef.current.t), 250);
    return () => clearInterval(id);
  }, []);

  const setPlaying = (updater: (p: boolean) => boolean) => {
    setPlayingState((p) => {
      const next = updater(p);
      clockRef.current.playing = next;
      return next;
    });
  };
  const setSpeed = (v: number) => {
    clockRef.current.speed = v;
    setSpeedState(v);
  };
  const seek = (t: number) => {
    clockRef.current.t = t;
    setTDisplay(t);
  };

  const primary = stars[0];
  const primaryResult = primary
    ? results.get(orbitKey(primary.source_id, modelId, omega))
    : undefined;

  const published = primary
    ? model.refCol === "static"
      ? primary.static
      : model.refCol === "barred" && omegaP === 37.5
        ? primary.barred
        : model.refCol === "mcmillan"
          ? primary.mcmillan
          : undefined
    : undefined;

  // star search
  const searchMatches = useMemo(() => {
    if (!orbits || search.length < 2) return [];
    const ids = orbits.columns.source_id as string[];
    const out: { sid: string; i: number }[] = [];
    for (let i = 0; i < ids.length && out.length < 8; i++) {
      if (ids[i].startsWith(search)) out.push({ sid: ids[i], i });
    }
    return out;
  }, [orbits, search]);

  const anyLoading = requests.some(
    (r) => !results.has(orbitKey(r.objectId, r.modelId, r.omega)),
  );

  return (
    <div className="flex flex-1 min-h-0">
      {/* 3D canvas */}
      <div className="flex-1 relative min-w-0">
        <GalaxyScene
          objects={sceneObjects}
          clock={clockRef.current}
          totalGyr={4}
          barred={model.barred}
          omega={omega}
          frame={frame}
          showDisc={showDisc}
          showAccel={showAccel}
          showPotential={showPotential}
          modelId={modelId}
        />
        {loadError && (
          <div className="absolute top-3 left-3 text-danger text-sm panel px-3 py-2">
            {loadError}
          </div>
        )}
        {anyLoading && (
          <div className="absolute top-3 left-3 text-xs text-muted panel px-3 py-2">
            integrating orbits…{" "}
            {[...progress.values()].length > 0 &&
              `${Math.round(
                (100 * [...progress.values()].reduce((a, b) => a + b, 0)) /
                  Math.max(1, [...progress.values()].length),
              )}%`}
          </div>
        )}
        {[...errors.values()].slice(0, 1).map((e) => (
          <div
            key={e}
            className="absolute bottom-3 left-3 text-danger text-xs panel px-3 py-2"
          >
            {e}
          </div>
        ))}

        {/* playback bar */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 panel px-3 py-2 flex items-center gap-3 text-xs">
          <button
            className="text-accent hover:text-foreground w-6"
            onClick={() => setPlaying((p) => !p)}
            title={playing ? "pause" : "play"}
          >
            {playing ? "⏸" : "▶"}
          </button>
          <input
            type="range"
            min={0}
            max={4}
            step={0.001}
            value={tDisplay}
            onChange={(e) => seek(parseFloat(e.target.value))}
            className="w-48 accent-[var(--accent)]"
          />
          <span className="num w-20">t = {tDisplay.toFixed(2)} Gyr</span>
          <select
            className="bg-surface-2 rounded px-1 py-0.5"
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            title="playback speed"
          >
            <option value={0.25}>0.25×</option>
            <option value={1}>1×</option>
            <option value={4}>4×</option>
            <option value={16}>16×</option>
          </select>
        </div>
      </div>

      {/* control panel */}
      <div className="w-80 shrink-0 border-l border-borderc overflow-y-auto p-3 space-y-3 text-sm">
        {/* model */}
        <section className="panel p-3">
          <h3 className="text-xs uppercase tracking-wide text-faint mb-2">
            Galactic potential model
          </h3>
          <div className="space-y-1">
            {MODELS.map((m) => (
              <label
                key={m.id}
                className="flex items-start gap-2 cursor-pointer group"
                title={m.long}
              >
                <input
                  type="radio"
                  name="model"
                  checked={modelId === m.id}
                  onChange={() => setModelId(m.id)}
                  className="mt-1 accent-[var(--accent)]"
                />
                <span>
                  <span
                    className="group-hover:text-foreground"
                    style={{ color: modelId === m.id ? m.color : undefined }}
                  >
                    {m.short}
                  </span>
                  <span className="block text-xs text-faint leading-tight">
                    {m.long}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {model.barred && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">
                  Ω<sub>p</sub> (km s⁻¹ kpc⁻¹)
                </span>
                <div className="flex gap-1">
                  {OMEGA_GRID.map((o) => (
                    <button
                      key={o}
                      onClick={() => setOmegaP(o)}
                      className={`px-1.5 py-0.5 rounded text-xs num ${
                        omegaP === o
                          ? "bg-accent/20 text-accent"
                          : "bg-surface-2 text-muted hover:text-foreground"
                      }`}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted">frame</span>
                {(["rotating", "inertial"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFrame(f)}
                    className={`px-1.5 py-0.5 rounded ${
                      frame === f
                        ? "bg-accent/20 text-accent"
                        : "bg-surface-2 text-muted hover:text-foreground"
                    }`}
                  >
                    {f === "rotating" ? "corotating (bar fixed)" : "inertial"}
                  </button>
                ))}
              </div>
              <p className="text-xs text-faint leading-tight">
                Bar angle −0.44 rad (≈25°), pattern speed negative = clockwise;
                paper default Ω<sub>p</sub> = 37.5, sensitivity grid 24–41.
                Published barred columns use Ω<sub>p</sub> = 37.5.
              </p>
            </div>
          )}
        </section>

        {/* objects */}
        <section className="panel p-3">
          <h3 className="text-xs uppercase tracking-wide text-faint mb-2">
            Objects
          </h3>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value.trim())}
            placeholder="search Gaia DR3 source_id…"
            className="w-full bg-surface-2 rounded px-2 py-1 text-xs num placeholder:font-sans"
          />
          {searchMatches.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {searchMatches.map((m) => (
                <button
                  key={m.sid}
                  className="block w-full text-left text-xs num text-muted hover:text-accent"
                  onClick={() => {
                    setSelectedStars((old) =>
                      old.includes(m.sid) ? old : [...old, m.sid],
                    );
                    setSearch("");
                  }}
                >
                  {m.sid}
                </button>
              ))}
            </div>
          )}

          <div className="mt-2">
            <span className="text-xs text-muted">featured stars</span>
            <select
              className="w-full bg-surface-2 rounded px-1 py-1 text-xs mt-1"
              value=""
              onChange={(e) => {
                const sid = e.target.value;
                if (sid)
                  setSelectedStars((old) =>
                    old.includes(sid) ? old : [...old, sid],
                  );
              }}
            >
              <option value="">add a featured star…</option>
              {featuredObjects.map((f: ReferenceObject) => (
                <option key={f.id} value={f.id} title={f.why}>
                  {f.label} — {f.why?.slice(0, 60)}
                </option>
              ))}
            </select>
          </div>

          {/* selected star chips */}
          <div className="mt-2 flex flex-wrap gap-1">
            {stars.map((s, i) => (
              <span
                key={s.source_id}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs bg-surface-2"
                style={{ color: OBJECT_COLORS[i % OBJECT_COLORS.length] }}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{
                    background: OBJECT_COLORS[i % OBJECT_COLORS.length],
                  }}
                />
                <span className="num">…{s.source_id.slice(-8)}</span>
                <span
                  className="rounded px-1"
                  style={{ color: TIER_COLORS[s.tier] }}
                  title={`Tier ${s.tier}, P=${fmt(s.P_vgrf_below_25, 3)}`}
                >
                  {s.tier}
                </span>
                <button
                  className="text-faint hover:text-danger"
                  onClick={() =>
                    setSelectedStars((old) =>
                      old.filter((x) => x !== s.source_id),
                    )
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          <div className="mt-3 space-y-1">
            <span className="text-xs text-muted">context objects</span>
            {contextObjects.map((o) => (
              <label
                key={o.id}
                className="flex items-center gap-2 text-xs cursor-pointer"
                title={o.provenance}
              >
                <input
                  type="checkbox"
                  className="accent-[var(--accent)]"
                  checked={selectedContext.includes(o.id)}
                  onChange={(e) =>
                    setSelectedContext((old) =>
                      e.target.checked
                        ? [...old, o.id]
                        : old.filter((x) => x !== o.id),
                    )
                  }
                />
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: CONTEXT_COLORS[o.id] ?? "#b8c4d4" }}
                />
                <span>{o.label}</span>
                {o.why && <span className="text-faint">· {o.why}</span>}
              </label>
            ))}
          </div>
        </section>

        {/* overlays */}
        <section className="panel p-3">
          <h3 className="text-xs uppercase tracking-wide text-faint mb-2">
            Show the model
          </h3>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              className="accent-[var(--accent)]"
              checked={showDisc}
              onChange={(e) => setShowDisc(e.target.checked)}
            />
            galaxy rendering (decorative; scaled to the model)
          </label>
          <label className="flex items-center gap-2 text-xs cursor-pointer mt-1">
            <input
              type="checkbox"
              className="accent-[var(--accent)]"
              checked={showPotential}
              onChange={(e) => setShowPotential(e.target.checked)}
            />
            equipotential contours (midplane)
          </label>
          <label className="flex items-center gap-2 text-xs cursor-pointer mt-1">
            <input
              type="checkbox"
              className="accent-[var(--accent)]"
              checked={showAccel}
              onChange={(e) => setShowAccel(e.target.checked)}
            />
            acceleration vector on the primary star
          </label>
        </section>

        {/* readout */}
        {primary && (
          <section className="panel p-3">
            <h3 className="text-xs uppercase tracking-wide text-faint mb-1">
              Gaia DR3 {primary.source_id}
            </h3>
            <div className="text-xs text-muted mb-2">
              Tier {primary.tier} · P(V<sub>GRF</sub>&lt;25) ={" "}
              <span className="num">{fmt(primary.P_vgrf_below_25, 3)}</span> · V
              <sub>GRF</sub> ={" "}
              <span className="num">
                {fmt(primary.vgrf_default_exact, 1)} km s⁻¹
              </span>
            </div>
            {primaryResult ? (
              <table className="w-full text-xs num">
                <thead>
                  <tr className="text-faint font-sans">
                    <th className="text-left font-normal">4 Gyr orbit</th>
                    <th className="text-right font-normal">browser</th>
                    <th className="text-right font-normal">published</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="text-muted font-sans">R_peri</td>
                    <td className="text-right">
                      {fmtPc(primaryResult.summary.R_peri_kpc)}
                    </td>
                    <td className="text-right text-muted">
                      {published ? fmtPc(published.R_peri_kpc) : "—"}
                    </td>
                  </tr>
                  <tr>
                    <td className="text-muted font-sans">R_apo</td>
                    <td className="text-right">
                      {fmt(primaryResult.summary.R_apo_kpc, 3)} kpc
                    </td>
                    <td className="text-right text-muted">
                      {published ? `${fmt(published.R_apo_kpc, 3)} kpc` : "—"}
                    </td>
                  </tr>
                  <tr>
                    <td className="text-muted font-sans">z_max</td>
                    <td className="text-right">
                      {fmt(primaryResult.summary.z_max_kpc, 3)} kpc
                    </td>
                    <td className="text-right text-muted">
                      {published ? `${fmt(published.z_max_kpc, 3)} kpc` : "—"}
                    </td>
                  </tr>
                  <tr>
                    <td className="text-muted font-sans">eccentricity</td>
                    <td className="text-right">
                      {fmt(primaryResult.summary.ecc, 4)}
                    </td>
                    <td className="text-right text-muted">
                      {published ? fmt(published.ecc, 4) : "—"}
                    </td>
                  </tr>
                  <tr>
                    <td className="text-muted font-sans">
                      {omega !== 0 ? "E_J drift" : "E drift"}
                    </td>
                    <td className="text-right" colSpan={2}>
                      {(omega !== 0
                        ? primaryResult.summary.EJ_drift_rel
                        : primaryResult.summary.E_drift_rel
                      ).toExponential(1)}{" "}
                      <span className="text-faint font-sans">(relative)</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <div className="text-xs text-muted">integrating…</div>
            )}
            <p className="text-xs text-faint mt-2 leading-tight">
              Browser values: live integration on the exported model grids
              (DP5(4), sample-aligned steps). Published: release point-estimate
              columns (AGAMA DOP853{model.refCol === "barred" ? ", Ωp=37.5" : ""}
              ). Orbit quantities are model outputs, not observables.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
