"use client";

import "katex/dist/katex.min.css";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TeX } from "@/components/Math";
import {
  ColumnFile,
  TIER_COLORS,
  findBySourceId,
  loadMaster,
  loadOrbits,
} from "@/lib/data/catalogue";
import {
  ICRSKinematics,
  SOLAR_VARIANTS,
  icrsToGalactocentric,
} from "@/lib/astro/galactocentric";

type Row = Record<string, number | string | boolean | null>;

function rowAt(f: ColumnFile, i: number): Row {
  const row: Row = {};
  for (const [k, arr] of Object.entries(f.columns)) row[k] = arr[i];
  return row;
}

function num(r: Row | null, k: string): number {
  const v = r?.[k];
  return typeof v === "number" ? v : NaN;
}

function fmt(v: number, d = 3): string {
  return Number.isFinite(v) ? v.toFixed(d) : "—";
}

/** deterministic RNG so the illustrative MC is reproducible */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-5">
      <h2 className="font-medium">
        <span className="text-accent num mr-2">{n}.</span>
        {title}
      </h2>
      <div className="mt-3 text-sm text-muted leading-relaxed space-y-3">
        {children}
      </div>
    </section>
  );
}

function Value({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface-2 rounded px-3 py-2">
      <div className="text-xs text-faint">{label}</div>
      <div className="num text-sm text-foreground">{children}</div>
    </div>
  );
}

export default function MethodsClient() {
  const [master, setMaster] = useState<ColumnFile | null>(null);
  const [orbits, setOrbits] = useState<ColumnFile | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [variant, setVariant] = useState<keyof typeof SOLAR_VARIANTS>("default");
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadMaster().then(setMaster, () => {});
    loadOrbits().then(setOrbits, () => {});
  }, []);

  // default: highest-P Tier A star with RVS ok
  useEffect(() => {
    if (master && !sourceId) {
      const c = master.columns;
      let best = -1;
      let bestP = -1;
      for (let i = 0; i < master.n; i++) {
        if (c.tier[i] === "A" && c.rvs_quality_ok[i] === true) {
          const p = c.P_vgrf_below_25[i] as number;
          if (p > bestP) {
            bestP = p;
            best = i;
          }
        }
      }
      if (best >= 0) setSourceId(String(c.source_id[best]));
    }
  }, [master, sourceId]);

  const mi = useMemo(
    () => (master && sourceId ? findBySourceId(master, sourceId) : -1),
    [master, sourceId],
  );
  const m = master && mi >= 0 ? rowAt(master, mi) : null;
  const oi = useMemo(
    () => (orbits && sourceId ? findBySourceId(orbits, sourceId) : -1),
    [orbits, sourceId],
  );
  const o = orbits && oi >= 0 ? rowAt(orbits, oi) : null;

  const sv = SOLAR_VARIANTS[variant];

  const obs: ICRSKinematics | null = m
    ? {
        ra_deg: num(m, "ra"),
        dec_deg: num(m, "dec"),
        dist_pc: num(m, "dist_pc"),
        pmra_masyr: num(m, "pmra"),
        pmdec_masyr: num(m, "pmdec"),
        rv_kms: num(m, "radial_velocity"),
      }
    : null;

  const g = obs ? icrsToGalactocentric(obs, sv) : null;

  // illustrative Monte Carlo (no covariances, split-normal distance)
  const mc = useMemo(() => {
    if (!m || !obs) return null;
    const rng = mulberry32(20260502);
    const N = 2000;
    const dLo = num(m, "dist_lo_pc");
    const dHi = num(m, "dist_hi_pc");
    const d0 = num(m, "dist_pc");
    const sLo = Math.max(1, d0 - dLo);
    const sHi = Math.max(1, dHi - d0);
    const pLeft = sLo / (sLo + sHi);
    const sPmra = num(m, "pmra_error");
    const sPmdec = num(m, "pmdec_error");
    const sRv = num(m, "radial_velocity_error");
    const vals: number[] = [];
    let below = 0;
    for (let i = 0; i < N; i++) {
      const gdraw = Math.abs(gauss(rng));
      const dist =
        rng() < pLeft ? d0 - gdraw * sLo : d0 + gdraw * sHi;
      const draw: ICRSKinematics = {
        ra_deg: obs.ra_deg,
        dec_deg: obs.dec_deg,
        dist_pc: Math.max(10, dist),
        pmra_masyr: obs.pmra_masyr + gauss(rng) * sPmra,
        pmdec_masyr: obs.pmdec_masyr + gauss(rng) * sPmdec,
        rv_kms: obs.rv_kms + gauss(rng) * sRv,
      };
      const gg = icrsToGalactocentric(draw, SOLAR_VARIANTS.default);
      vals.push(gg.vgrf);
      if (gg.vgrf < 25) below++;
    }
    vals.sort((a, b) => a - b);
    return { vals, pHat: below / N, N };
  }, [m, obs]);

  const tier = m ? String(m.tier) : "";

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 w-full">
      <h1 className="text-2xl font-semibold">The math, step by step</h1>
      <p className="text-sm text-muted mt-2 leading-relaxed">
        Every number below is computed live in your browser from the released
        catalogue data, following the pipeline of the paper (v1.0.8-review).
        The coordinate transform used here reproduces the release&apos;s
        astropy implementation to &lt; 1 milliparsec and &lt; 4 cm s⁻¹ across
        all 1,952 orbit-sample stars.
      </p>

      {/* star picker */}
      <div className="panel p-3 mt-4 flex flex-wrap items-center gap-3 text-sm sticky top-12 z-30 bg-surface/95 backdrop-blur">
        <span className="text-xs text-faint uppercase tracking-wide">
          worked example
        </span>
        {m ? (
          <>
            <span className="num">Gaia DR3 {sourceId}</span>
            <span
              className="text-xs px-1.5 rounded bg-surface-2"
              style={{ color: TIER_COLORS[tier] }}
            >
              Tier {tier}
            </span>
            <Link
              href={`/catalogue/${sourceId}`}
              className="textlink text-xs"
            >
              full record →
            </Link>
          </>
        ) : (
          <span className="text-muted">loading…</span>
        )}
        <input
          value={search}
          onChange={(e) => {
            const v = e.target.value.trim();
            setSearch(v);
            if (master && v.length > 8 && findBySourceId(master, v) >= 0) {
              setSourceId(v);
              setSearch("");
            }
          }}
          placeholder="paste another source_id…"
          className="ml-auto bg-surface-2 rounded px-2 py-1 text-xs num w-52 placeholder:font-sans"
        />
      </div>

      <div className="mt-4 space-y-4">
        <Step n={1} title="Six numbers from Gaia DR3">
          <p>
            Everything starts from the 6-dimensional Gaia solution: position,
            parallax, proper motion, and the RVS line-of-sight velocity. The
            parent selection (ADQL on <span className="num">gaiadr3.gaia_source</span>)
            requires a measured radial velocity,{" "}
            <TeX>{String.raw`\varpi > 0`}</TeX>,{" "}
            <TeX>{String.raw`\varpi/\sigma_\varpi > 5`}</TeX> and finite proper
            motions — about 33.8 million stars.
          </p>
          {m && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Value label="α (deg)">{fmt(num(m, "ra"), 5)}</Value>
              <Value label="δ (deg)">{fmt(num(m, "dec"), 5)}</Value>
              <Value label="ϖ (mas)">
                {fmt(num(m, "parallax"), 4)} ± {fmt(num(m, "parallax_error"), 4)}
              </Value>
              <Value label="μα* (mas/yr)">
                {fmt(num(m, "pmra"), 3)} ± {fmt(num(m, "pmra_error"), 3)}
              </Value>
              <Value label="μδ (mas/yr)">
                {fmt(num(m, "pmdec"), 3)} ± {fmt(num(m, "pmdec_error"), 3)}
              </Value>
              <Value label="v_r (km/s)">
                {fmt(num(m, "radial_velocity"), 2)} ±{" "}
                {fmt(num(m, "radial_velocity_error"), 2)}
              </Value>
            </div>
          )}
        </Step>

        <Step n={2} title="Parallax zero-point (Lindegren et al. 2021)">
          <p>
            Gaia parallaxes carry a small colour-, magnitude- and
            position-dependent bias. The release applies the Lindegren et al.
            (2021) per-star correction{" "}
            <TeX>{String.raw`\varpi_{\rm corr} = \varpi - z_5(G,\ \nu_{\rm eff},\ \beta)`}</TeX>{" "}
            inside its validity window (6 &lt; G &lt; 21).
          </p>
          {m && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Value label="z₅ applied (μas)">
                {fmt(num(m, "zpcorr_value_uas"), 1)}
              </Value>
              <Value label="ϖ corrected (mas)">
                {fmt(num(m, "parallax_zpcorr"), 4)}
              </Value>
              <Value label="inside validity window">
                {m.zpcorr_valid === true ? "yes" : "no"}
              </Value>
            </div>
          )}
        </Step>

        <Step n={3} title="Distance (Bailer-Jones et al. 2021)">
          <p>
            Inverting a noisy parallax biases distances, so the release adopts
            the Bailer-Jones et al. (2021) <em>photogeometric</em> posterior
            where available (zero-point-corrected inverse parallax otherwise,
            and only as a sensitivity check). The stored 16th/84th percentiles
            drive asymmetric (split-normal) draws in the Monte Carlo.
          </p>
          {m && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Value label="adopted d (pc)">{fmt(num(m, "dist_pc"), 0)}</Value>
              <Value label="16% – 84% (pc)">
                {fmt(num(m, "dist_lo_pc"), 0)} – {fmt(num(m, "dist_hi_pc"), 0)}
              </Value>
              <Value label="source">{String(m.dist_source ?? "—")}</Value>
              <Value label="naive 1/ϖ_corr (pc)">
                {fmt(1000 / num(m, "parallax_zpcorr"), 0)}
              </Value>
            </div>
          )}
        </Step>

        <Step n={4} title="Into the Galactic rest frame">
          <p>
            The observables become a Cartesian position and velocity in the
            Galactocentric frame (astropy conventions):
          </p>
          <TeX block>
            {String.raw`\mathbf{r}_{\rm GC} = \mathbf{H}\left[\mathbf{R}\,\mathbf{r}_{\rm ICRS}(\alpha,\delta,d) - d_\odot\,\hat{\mathbf{x}}\right],\qquad
\mathbf{v}_{\rm GC} = \mathbf{H}\,\mathbf{R}\,\mathbf{v}_{\rm ICRS}(\mu_{\alpha*},\mu_\delta,v_r) + \mathbf{v}_\odot`}
          </TeX>
          <p>
            where <TeX>{String.raw`\mathbf{R}`}</TeX> rotates the galactic
            centre to <TeX>{String.raw`+\hat{\mathbf{x}}`}</TeX>,{" "}
            <TeX>{String.raw`\mathbf{H}`}</TeX> tilts for the Sun&apos;s height{" "}
            <TeX>{String.raw`z_\odot`}</TeX>, and{" "}
            <TeX>{String.raw`\mathbf{v}_\odot = (U,\ V_c + V,\ W)`}</TeX>. The
            release&apos;s default frame:{" "}
            <TeX>{String.raw`R_0 = 8.178\ {\rm kpc}`}</TeX> (GRAVITY 2019),{" "}
            <TeX>{String.raw`z_\odot = 25\ {\rm pc}`}</TeX>,{" "}
            <TeX>{String.raw`V_c = 229\ {\rm km\,s^{-1}}`}</TeX> (Eilers 2019,
            consistent with the adopted potential), Schönrich (2010) solar
            motion. Try the paper&apos;s sensitivity variants:
          </p>
          <div className="flex gap-1 flex-wrap">
            {Object.keys(SOLAR_VARIANTS).map((k) => (
              <button
                key={k}
                onClick={() => setVariant(k as keyof typeof SOLAR_VARIANTS)}
                className={`px-2 py-1 rounded text-xs ${
                  variant === k
                    ? "bg-accent/20 text-accent"
                    : "bg-surface-2 text-muted hover:text-foreground"
                }`}
                title={JSON.stringify(SOLAR_VARIANTS[k])}
              >
                {k}
              </button>
            ))}
            <span className="text-xs text-faint self-center ml-2 num">
              R₀={sv.R0_kpc} kpc · V_c={sv.Vc_kms} · (U,V,W)=({sv.U_kms},{" "}
              {sv.V_kms}, {sv.W_kms}) km/s
            </span>
          </div>
          {g && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Value label="x, y, z (kpc)">
                {fmt(g.x, 3)}, {fmt(g.y, 3)}, {fmt(g.z, 3)}
              </Value>
              <Value label="vx, vy, vz (km/s)">
                {fmt(g.vx, 2)}, {fmt(g.vy, 2)}, {fmt(g.vz, 2)}
              </Value>
              {o && variant === "default" && (
                <Value label="release IC agrees to">
                  {fmt(
                    Math.hypot(
                      g.x - num(o, "x_kpc"),
                      g.y - num(o, "y_kpc"),
                      g.z - num(o, "z_kpc"),
                    ) * 1e6,
                    2,
                  )}{" "}
                  mpc
                </Value>
              )}
            </div>
          )}
          {o && variant === "default" && (
            <p className="text-xs text-faint">
              (the release integrates orbits from the slightly different{" "}
              <span className="num">dist_pc_final_screen</span> distance; the
              residual above uses the master-catalogue distance, so a few mpc
              is expected)
            </p>
          )}
        </Step>

        <Step n={5} title="The Galactic rest-frame speed">
          <TeX block>
            {String.raw`V_{\rm GRF} = |\mathbf{v}_{\rm GC}| = \sqrt{v_x^2 + v_y^2 + v_z^2}`}
          </TeX>
          <p>
            This is a <em>total</em> speed — not the azimuthal velocity used by
            low-<TeX>{String.raw`v_\phi`}</TeX> selections (the paper finds
            zero overlap with Filion et al. 2025). A typical disc star near the
            Sun has <TeX>{String.raw`V_{\rm GRF} \approx 240`}</TeX> km s⁻¹;
            the catalogue threshold of 25 km s⁻¹ is about 10% of the local
            circular speed.
          </p>
          {g && m && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Value label={`V_GRF here (${variant})`}>
                {fmt(g.vgrf, 2)} km/s
              </Value>
              <Value label="release adopted value">
                {fmt(num(m, "vgrf_default"), 2)} km/s
              </Value>
            </div>
          )}
        </Step>

        <Step n={6} title="Monte Carlo membership probability & tiers">
          <p>
            A point estimate is not enough near a threshold. The release draws{" "}
            (ϖ, μα*, μδ) from the full Gaia covariance (Cholesky of the 3×3
            submatrix), v_r from its Gaussian error, and distance from the
            asymmetric Bailer-Jones posterior — adaptively 500 / 5,000 / 10,000
            realisations per star (seed 20260502) — and defines
          </p>
          <TeX block>
            {String.raw`P \equiv P(V_{\rm GRF} < 25\ {\rm km\,s^{-1}}) = \frac{\#\{{\rm draws\ below\ threshold}\}}{N_{\rm draws}}`}
          </TeX>
          <p>
            Tiers: <b style={{ color: TIER_COLORS.A }}>A</b> P&gt;0.95 ·{" "}
            <b style={{ color: TIER_COLORS.B }}>B</b> 0.84&lt;P≤0.95 ·{" "}
            <b style={{ color: TIER_COLORS.C }}>C</b> 0.5&lt;P≤0.84 ·{" "}
            <b style={{ color: TIER_COLORS.D }}>D</b> point-estimate &lt; 25 but
            P≤0.5. The sum of (1−P) over a tier estimates its contamination:
            30.8 ± 5.3 expected false positives among the 541 Tier A+B stars.
          </p>
          {mc && m && (
            <>
              <p>
                Below: an <em>illustrative</em> re-run in your browser —{" "}
                {mc.N.toLocaleString()} draws, but without the astrometric
                correlations (not shipped in the web export) and with the
                split-normal distance approximation. The release value is the
                authoritative one.
              </p>
              <VgrfHistogram
                vals={mc.vals}
                pHat={mc.pHat}
                pRelease={num(m, "P_vgrf_below_25")}
              />
            </>
          )}
        </Step>

        <Step n={7} title="Why 'slow' means 'plunging'">
          <p>
            Energy conservation along an orbit in a static potential reads{" "}
            <TeX>{String.raw`E = \tfrac{1}{2}v^2 + \Phi(\mathbf{r})`}</TeX>.
            Catching a star with <TeX>{String.raw`v \approx 0`}</TeX> means
            catching it at a turning point with specific angular momentum{" "}
            <TeX>{String.raw`L_z = x v_y - y v_x \approx 0`}</TeX>. In any
            centrally concentrated potential such a star must fall nearly
            radially toward the inner Galaxy: eccentricity{" "}
            <TeX>{String.raw`e = (R_{\rm apo}-R_{\rm peri})/(R_{\rm apo}+R_{\rm peri}) \to 1`}</TeX>
            . The paper is explicit that this is largely a kinematic corollary
            of the selection — the catalogue&apos;s value is <em>which</em>{" "}
            stars are in this state, with calibrated probabilities.
          </p>
          <p>
            <Link
              className="textlink"
              href={sourceId ? `/viewer?star=${sourceId}` : "/viewer"}
            >
              Watch this star&apos;s orbit in the 3D viewer →
            </Link>
          </p>
        </Step>
      </div>
    </div>
  );
}

function VgrfHistogram({
  vals,
  pHat,
  pRelease,
}: {
  vals: number[];
  pHat: number;
  pRelease: number;
}) {
  const W = 640;
  const H = 160;
  const max = Math.min(80, vals[vals.length - 1] * 1.05);
  const nBins = 48;
  const bins = new Array(nBins).fill(0);
  for (const v of vals) {
    const b = Math.floor((v / max) * nBins);
    if (b >= 0 && b < nBins) bins[b]++;
  }
  const peak = Math.max(...bins, 1);
  const x25 = (25 / max) * W;
  return (
    <div className="bg-surface-2 rounded p-3">
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="w-full">
        {bins.map((c, i) => {
          const h = (c / peak) * H;
          const x0 = (i / nBins) * W;
          const below = ((i + 0.5) / nBins) * max < 25;
          return (
            <rect
              key={i}
              x={x0 + 0.5}
              y={H - h}
              width={W / nBins - 1}
              height={h}
              fill={below ? "var(--tier-a)" : "#39465e"}
              opacity={below ? 0.8 : 0.6}
            />
          );
        })}
        <line x1={x25} x2={x25} y1={0} y2={H} stroke="var(--tier-c)" strokeDasharray="4 3" />
        <text x={x25 + 5} y={12} fill="var(--tier-c)" fontSize={11}>
          25 km/s
        </text>
        <text x={0} y={H + 16} fill="var(--faint)" fontSize={10}>
          0
        </text>
        <text x={W - 4} y={H + 16} fill="var(--faint)" fontSize={10} textAnchor="end">
          {max.toFixed(0)} km/s
        </text>
      </svg>
      <div className="text-xs num text-muted mt-1">
        illustrative P̂ = {pHat.toFixed(3)} · release P = {pRelease.toFixed(3)}{" "}
        <span className="font-sans text-faint">
          (differences reflect the missing covariances/exact posteriors)
        </span>
      </div>
    </div>
  );
}
