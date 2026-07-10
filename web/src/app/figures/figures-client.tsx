"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Scatter, { ScatterPoint } from "@/components/figures/Scatter";
import {
  ColumnFile,
  TIER_COLORS,
  loadMaster,
  loadOrbits,
} from "@/lib/data/catalogue";

type OrbitModel = "static" | "barred" | "mcm";

/** viridis-ish 5-stop ramp for eccentricity coloring */
function eccColor(e: number): string {
  const stops: [number, string][] = [
    [0.86, "#3b4cc0"],
    [0.92, "#6f8fd8"],
    [0.95, "#b8b8b8"],
    [0.975, "#e8946a"],
    [1.0, "#d0344a"],
  ];
  for (const [v, c] of stops) if (e <= v) return c;
  return "#d0344a";
}

function vgrfColor(v: number): string {
  if (v < 15) return "#62d6e8";
  if (v < 25) return "#8fa3f5";
  if (v < 35) return "#e8b46a";
  return "#55637a";
}

function Fig({
  title,
  paperRef,
  children,
  caption,
}: {
  title: string;
  paperRef: string;
  children: React.ReactNode;
  caption: React.ReactNode;
}) {
  return (
    <section className="panel p-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="font-medium">{title}</h2>
        <span className="text-xs text-faint">{paperRef}</span>
      </div>
      <div className="mt-3">{children}</div>
      <p className="text-xs text-muted mt-2 leading-relaxed">{caption}</p>
    </section>
  );
}

export default function FiguresClient() {
  const router = useRouter();
  const [orbits, setOrbits] = useState<ColumnFile | null>(null);
  const [master, setMaster] = useState<ColumnFile | null>(null);
  const [orbitModel, setOrbitModel] = useState<OrbitModel>("static");

  useEffect(() => {
    loadOrbits().then(setOrbits, () => {});
    loadMaster().then(setMaster, () => {});
  }, []);

  const go = (id: string) => router.push(`/catalogue/${id}`);

  // ---- fig: R_peri vs R_apo ----
  const periApo = useMemo<ScatterPoint[]>(() => {
    if (!orbits) return [];
    const c = orbits.columns;
    const pre = orbitModel === "mcm" ? "mcm_" : `${orbitModel}_`;
    const out: ScatterPoint[] = [];
    for (let i = 0; i < orbits.n; i++) {
      const rp = c[`${pre}R_peri_kpc`]?.[i] as number;
      const ra = c[`${pre}R_apo_kpc`]?.[i] as number;
      const e = c[`${pre}ecc`]?.[i] as number;
      if (typeof rp !== "number" || typeof ra !== "number") continue;
      out.push({
        x: rp * 1000,
        y: ra,
        color: eccColor(e ?? 0.95),
        id: String(c.source_id[i]),
        label: `${c.source_id[i]} · e=${(e ?? NaN).toFixed(3)}`,
      });
    }
    return out;
  }, [orbits, orbitModel]);

  // ---- fig: Toomre ----
  const toomre = useMemo<ScatterPoint[]>(() => {
    if (!orbits) return [];
    const c = orbits.columns;
    const out: ScatterPoint[] = [];
    for (let i = 0; i < orbits.n; i++) {
      const x = c.x_kpc[i] as number;
      const y = c.y_kpc[i] as number;
      const vx = c.vx_kms[i] as number;
      const vy = c.vy_kms[i] as number;
      const vz = c.vz_kms[i] as number;
      const R = Math.hypot(x, y);
      const vphi = (x * vy - y * vx) / R; // sign: prograde positive in this convention?
      const vR = (x * vx + y * vy) / R;
      out.push({
        x: vphi,
        y: Math.hypot(vR, vz),
        color: TIER_COLORS[String(c.tier[i])] ?? "#4a5568",
        id: String(c.source_id[i]),
        label: `${c.source_id[i]} · tier ${c.tier[i]}`,
      });
    }
    return out;
  }, [orbits]);

  // ---- fig: P vs vgrf ----
  const pVgrf = useMemo<ScatterPoint[]>(() => {
    if (!master) return [];
    const c = master.columns;
    const out: ScatterPoint[] = [];
    for (let i = 0; i < master.n; i++) {
      const v = c.vgrf_default[i] as number;
      const p = c.P_vgrf_below_25[i] as number;
      if (typeof v !== "number" || typeof p !== "number" || v > 60) continue;
      out.push({
        x: v,
        y: p,
        color: TIER_COLORS[String(c.tier[i])] ?? "#4a5568",
        id: String(c.source_id[i]),
        label: `${c.source_id[i]} · tier ${c.tier[i]} · P=${p.toFixed(3)}`,
        size: 1.7,
      });
    }
    return out;
  }, [master]);

  // ---- fig: sky map (aitoff) ----
  const sky = useMemo<ScatterPoint[]>(() => {
    if (!master) return [];
    const c = master.columns;
    const out: ScatterPoint[] = [];
    for (let i = 0; i < master.n; i++) {
      const tier = String(c.tier[i]);
      if (tier === "X") continue; // keep the map readable: candidates only
      let l = c.l[i] as number;
      const b = c.b[i] as number;
      const v = c.vgrf_default[i] as number;
      if (typeof l !== "number" || typeof b !== "number") continue;
      if (l > 180) l -= 360; // centre on l=0
      // Aitoff projection
      const lr = (-l * Math.PI) / 180; // astro convention: l increases leftward
      const br = (b * Math.PI) / 180;
      const alpha = Math.acos(Math.cos(br) * Math.cos(lr / 2));
      const sinc = alpha === 0 ? 1 : Math.sin(alpha) / alpha;
      out.push({
        x: (2 * Math.cos(br) * Math.sin(lr / 2)) / sinc,
        y: Math.sin(br) / sinc,
        color: vgrfColor(v),
        id: String(c.source_id[i]),
        label: `${c.source_id[i]} · l=${(l < 0 ? l + 360 : l).toFixed(1)}° b=${b.toFixed(1)}° · ${v?.toFixed(0)} km/s`,
        size: 2,
      });
    }
    return out;
  }, [master]);

  const modelButtons = (
    <div className="flex gap-1 text-xs">
      {(
        [
          ["static", "Hunter+24 static"],
          ["barred", "Hunter+24 barred (Ωp=37.5)"],
          ["mcm", "McMillan 2017"],
        ] as const
      ).map(([k, label]) => (
        <button
          key={k}
          onClick={() => setOrbitModel(k)}
          className={`px-2 py-1 rounded ${
            orbitModel === k
              ? "bg-accent/20 text-accent"
              : "bg-surface-2 text-muted hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 w-full space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Ensemble figures</h1>
        <p className="text-sm text-muted mt-1">
          Interactive versions of the paper&apos;s key ensemble figures,
          computed from the released catalogue files. Hover for the star,
          click to open its record. All orbit quantities are point-estimate
          model outputs.
        </p>
      </div>

      <Fig
        title="Pericentre vs apocentre — the plunge diagram"
        paperRef="cf. paper Fig. 7 / Fig. 12"
        caption={
          <>
            Every Tier A+B+C star, coloured by eccentricity (blue e≈0.88 → red
            e≈1). The entire sample sits far below the R_peri = R_apo line:
            these are radial plunges. Switching the potential model shifts
            pericentres (medians ~115 pc static → ~14 pc barred) but the
            radial character survives — the paper&apos;s central robustness
            claim, which you can check here model by model.
          </>
        }
      >
        {modelButtons}
        <Scatter
          points={periApo}
          xLabel="R_peri (pc)"
          yLabel="R_apo (kpc)"
          xLog
          yLog
          xDomain={[0.2, 1000]}
          yDomain={[1, 25]}
          onClickPoint={go}
        />
      </Fig>

      <Fig
        title="Toomre diagram"
        paperRef="cf. paper Fig. 8"
        caption={
          <>
            Azimuthal velocity against the perpendicular velocity component at
            the observed epoch, coloured by tier. Disc stars cluster near v_φ ≈
            ±229 km s⁻¹; the slow-V<sub>GRF</sub> sample hugs the origin by
            construction — the interesting content is its spread and the tier
            structure near the 25 km s⁻¹ boundary.
          </>
        }
      >
        <Scatter
          points={toomre}
          xLabel="v_φ (km/s)"
          yLabel="√(v_R² + v_z²) (km/s)"
          xDomain={[-60, 60]}
          yDomain={[0, 60]}
          onClickPoint={go}
        />
      </Fig>

      <Fig
        title="Membership probability vs point-estimate speed"
        paperRef="cf. fig_phase14_pvgrf_vs_vgrf"
        caption={
          <>
            How the tiers are defined: P(V<sub>GRF</sub>&lt;25 km/s) from the
            adaptive Monte Carlo against the point-estimate speed, for the full
            candidate pool below 60 km s⁻¹. The vertical spread at fixed speed
            is measurement quality: a star at 20 km s⁻¹ with large distance
            uncertainty can have P ≈ 0.5, while a precise one is a secure
            member. Colours are tiers (A cyan → X grey).
          </>
        }
      >
        <Scatter
          points={pVgrf}
          xLabel="V_GRF point estimate (km/s)"
          yLabel="P(V_GRF < 25 km/s)"
          xDomain={[0, 60]}
          yDomain={[0, 1.02]}
          onClickPoint={go}
          annotate={(ctx, toPx) => {
            const style = getComputedStyle(document.documentElement);
            for (const [p, name] of [
              [0.95, "A"],
              [0.84, "B"],
              [0.5, "C"],
            ] as const) {
              const [x0, y] = toPx(0, p);
              const [x1] = toPx(60, p);
              ctx.strokeStyle =
                style.getPropertyValue(`--tier-${name.toLowerCase()}`).trim();
              ctx.setLineDash([5, 4]);
              ctx.beginPath();
              ctx.moveTo(x0, y);
              ctx.lineTo(x1, y);
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.fillStyle = ctx.strokeStyle;
              ctx.font = "10px monospace";
              ctx.fillText(`${name}: P>${p}`, x1 - 64, y - 4);
            }
            const [xv, yTop] = toPx(25, 1.02);
            const [, yBot] = toPx(25, 0);
            ctx.strokeStyle = "#55637a";
            ctx.setLineDash([3, 4]);
            ctx.beginPath();
            ctx.moveTo(xv, yTop);
            ctx.lineTo(xv, yBot);
            ctx.stroke();
            ctx.setLineDash([]);
          }}
        />
      </Fig>

      <Fig
        title="Sky distribution (galactic Aitoff)"
        paperRef="cf. paper Fig. 5"
        caption={
          <>
            Tier A–D candidates in galactic coordinates (Aitoff projection,
            centre l = 0 toward the Galactic centre, l increasing leftward),
            coloured by point-estimate speed (cyan &lt;15, blue &lt;25, amber
            &lt;35 km/s). The concentration toward the inner Galaxy —
            39.7% of Tier A+B+C within |l| ≤ 30° vs 6.2% toward the anticentre
            — is expected for stars near apocentre of inward-plunging orbits,
            modulated by the sparse RVS selection function.
          </>
        }
      >
        <Scatter
          points={sky}
          xLabel="Aitoff x (l, centre l=0, l increases ←)"
          yLabel="Aitoff y (b)"
          xDomain={[-2.3, 2.3]}
          yDomain={[-1.6, 1.6]}
          height={360}
          onClickPoint={go}
        />
      </Fig>
    </div>
  );
}
