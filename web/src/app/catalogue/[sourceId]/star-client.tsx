"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ColumnFile,
  TIER_COLORS,
  findBySourceId,
  loadMaster,
  loadOrbits,
} from "@/lib/data/catalogue";

function useColumnRow(file: ColumnFile | null, sourceId: string) {
  return useMemo(() => {
    if (!file) return null;
    const i = findBySourceId(file, sourceId);
    if (i < 0) return null;
    const row: Record<string, number | string | boolean | null> = {};
    for (const [k, arr] of Object.entries(file.columns)) row[k] = arr[i];
    return row;
  }, [file, sourceId]);
}

type Row = Record<string, number | string | boolean | null>;

function n(row: Row | null, key: string, digits = 3, unit = ""): string {
  const v = row?.[key];
  if (typeof v !== "number" || Number.isNaN(v)) return "—";
  return `${v.toFixed(digits)}${unit}`;
}

function s(row: Row | null, key: string): string {
  const v = row?.[key];
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function pc(row: Row | null, key: string): string {
  const v = row?.[key];
  if (typeof v !== "number" || Number.isNaN(v)) return "—";
  if (Math.abs(v) < 1) return `${(v * 1000).toFixed(1)} pc`;
  return `${v.toFixed(3)} kpc`;
}

function Field({
  label,
  value,
  title,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  title?: string;
}) {
  return (
    <div title={title}>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="num text-sm">{value}</dd>
    </div>
  );
}

function Section({
  title,
  children,
  note,
}: {
  title: string;
  children: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <section className="panel p-4">
      <h2 className="text-sm font-medium text-accent">{title}</h2>
      {note && <p className="text-xs text-faint mt-0.5">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function StarDetailClient({ sourceId }: { sourceId: string }) {
  const [master, setMaster] = useState<ColumnFile | null>(null);
  const [orbits, setOrbits] = useState<ColumnFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMaster().then(setMaster, (e) => setError(String(e)));
    loadOrbits().then(setOrbits, () => {});
  }, []);

  const m = useColumnRow(master, sourceId);
  const o = useColumnRow(orbits, sourceId);

  if (error)
    return <div className="p-8 text-sm text-danger">failed to load: {error}</div>;
  if (!master)
    return <div className="p-8 text-sm text-muted">loading catalogue…</div>;
  if (!m)
    return (
      <div className="p-8 text-sm">
        <p className="text-danger">
          Gaia DR3 {sourceId} is not in the candidate pool.
        </p>
        <Link href="/catalogue" className="textlink text-xs">
          ← back to the catalogue
        </Link>
      </div>
    );

  const tier = String(m.tier);
  const inOrbits = o !== null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 w-full">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-xl font-semibold num">Gaia DR3 {sourceId}</h1>
        <span
          className="text-sm font-medium px-2 py-0.5 rounded bg-surface-2"
          style={{ color: TIER_COLORS[tier] }}
        >
          Tier {tier}
        </span>
        <span className="text-sm text-muted num">
          P(V<sub>GRF</sub>&lt;25 km/s) = {n(m, "P_vgrf_below_25", 4)}
        </span>
        <span className="ml-auto flex gap-3 text-xs">
          {inOrbits && (
            <Link href={`/viewer?star=${sourceId}`} className="textlink">
              open in 3D viewer →
            </Link>
          )}
          <a
            className="textlink"
            href={`https://vizier.cds.unistra.fr/viz-bin/VizieR-S?Gaia%20DR3%20${sourceId}`}
            target="_blank"
            rel="noreferrer"
          >
            VizieR
          </a>
          <a
            className="textlink"
            href={`https://simbad.cds.unistra.fr/simbad/sim-basic?Ident=Gaia+DR3+${sourceId}`}
            target="_blank"
            rel="noreferrer"
          >
            SIMBAD
          </a>
        </span>
      </div>

      <div className="mt-4 grid md:grid-cols-2 gap-4">
        <Section title="Gaia DR3 astrometry & photometry">
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
            <Field label="RA / Dec (deg)" value={`${n(m, "ra", 5)} / ${n(m, "dec", 5)}`} />
            <Field label="l / b (deg)" value={`${n(m, "l", 3)} / ${n(m, "b", 3)}`} />
            <Field
              label="parallax (mas)"
              value={`${n(m, "parallax", 4)} ± ${n(m, "parallax_error", 4)}`}
            />
            <Field label="parallax S/N" value={n(m, "parallax_over_error", 1)} />
            <Field
              label="ZP-corrected ϖ (mas)"
              value={n(m, "parallax_zpcorr", 4)}
              title="Lindegren et al. (2021) zero-point applied"
            />
            <Field
              label="pmRA (mas/yr)"
              value={`${n(m, "pmra", 3)} ± ${n(m, "pmra_error", 3)}`}
            />
            <Field
              label="pmDec (mas/yr)"
              value={`${n(m, "pmdec", 3)} ± ${n(m, "pmdec_error", 3)}`}
            />
            <Field
              label="radial velocity (km/s)"
              value={`${n(m, "radial_velocity", 2)} ± ${n(m, "radial_velocity_error", 2)}`}
            />
            <Field
              label="RVS quality"
              value={
                <span
                  className={
                    s(m, "rv_quality") === "ok" ? "text-foreground" : "text-danger"
                  }
                >
                  {s(m, "rv_quality")}
                </span>
              }
            />
            <Field label="G / BP−RP (mag)" value={`${n(m, "phot_g_mean_mag", 2)} / ${n(m, "bp_rp", 2)}`} />
            <Field label="G_RVS (mag)" value={n(m, "grvs_mag", 2)} />
            <Field label="RUWE" value={n(m, "ruwe", 3)} />
          </dl>
        </Section>

        <Section
          title="Distance & rest-frame speed"
          note="distance priority: Bailer-Jones (2021) photogeometric, else zero-point-corrected inverse parallax"
        >
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
            <Field
              label="adopted distance (pc)"
              value={`${n(m, "dist_pc", 0)}`}
            />
            <Field
              label="distance 16–84%"
              value={`${n(m, "dist_lo_pc", 0)} – ${n(m, "dist_hi_pc", 0)} pc`}
            />
            <Field label="distance source" value={s(m, "dist_source")} />
            <Field
              label="V_GRF adopted (km/s)"
              value={n(m, "vgrf_default", 2)}
              title="final adopted point-estimate Galactic rest-frame speed"
            />
            <Field
              label="MC realisations"
              value={n(m, "mc_realisations", 0)}
              title="adaptive: 500 / 5,000 / 10,000 near the threshold"
            />
            <Field
              label="P(V_GRF < 25 km/s)"
              value={n(m, "P_vgrf_below_25", 4)}
            />
          </dl>
        </Section>
      </div>

      {inOrbits ? (
        <div className="mt-4 space-y-4">
          <Section
            title="Point-estimate orbit summaries (4 Gyr)"
            note={
              <>
                model outputs, not observables — static = Hunter+2024
                axisymmetrised (adopted), barred = Hunter+2024 bar at Ω
                <sub>p</sub> = 37.5 km/s/kpc (corotating frame), McMillan
                (2017) = independent comparison
              </>
            }
          >
            <table className="w-full text-sm num max-w-xl">
              <thead>
                <tr className="text-faint text-xs font-sans">
                  <th className="text-left font-normal py-1"></th>
                  <th className="text-right font-normal">static</th>
                  <th className="text-right font-normal">barred</th>
                  <th className="text-right font-normal">McMillan17</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["R_peri", "R_peri_kpc", pc],
                    ["R_apo", "R_apo_kpc", pc],
                    ["z_max", "z_max_kpc", pc],
                    ["min r_sph", "min_r_sph_kpc", pc],
                    ["eccentricity", "ecc", (r: Row | null, k: string) => n(r, k, 4)],
                  ] as const
                ).map(([label, col, f]) => (
                  <tr key={col} className="border-t border-borderc/40">
                    <td className="text-left text-muted font-sans py-1">{label}</td>
                    <td className="text-right">{f(o, `static_${col}`)}</td>
                    <td className="text-right">{f(o, `barred_${col}`)}</td>
                    <td className="text-right">{f(o, `mcm_${col}`)}</td>
                  </tr>
                ))}
                <tr className="border-t border-borderc/40">
                  <td className="text-left text-muted font-sans py-1">
                    L<sub>z</sub> (kpc km/s)
                  </td>
                  <td className="text-right">{n(o, "static_Lz_kpc_kms", 1)}</td>
                  <td className="text-right">{n(o, "barred_Lz_kpc_kms", 1)}</td>
                  <td className="text-right">—</td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Section
            title="Monte Carlo orbit posteriors (static model, 5,000 realisations)"
            note="16th / 50th / 84th percentiles under the full astrometric covariance + distance posterior"
          >
            <table className="w-full text-sm num max-w-xl">
              <thead>
                <tr className="text-faint text-xs font-sans">
                  <th className="text-left font-normal py-1"></th>
                  <th className="text-right font-normal">p16</th>
                  <th className="text-right font-normal">p50</th>
                  <th className="text-right font-normal">p84</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["R_peri", "R_peri_kpc", pc],
                    ["R_apo", "R_apo_kpc", pc],
                    ["z_max", "z_max_kpc", pc],
                    ["eccentricity", "ecc", (r: Row | null, k: string) => n(r, k, 4)],
                  ] as const
                ).map(([label, col, f]) => (
                  <tr key={col} className="border-t border-borderc/40">
                    <td className="text-left text-muted font-sans py-1">{label}</td>
                    <td className="text-right">{f(o, `${col}_p16`)}</td>
                    <td className="text-right">{f(o, `${col}_p50`)}</td>
                    <td className="text-right">{f(o, `${col}_p84`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <div className="grid md:grid-cols-2 gap-4">
            <Section
              title="Actions & frequencies (AGAMA, static model)"
              note={
                <>
                  Stäckel-fudge estimates; J<sub>z</sub> is unreliable for this
                  radial population — check the reliability flag
                </>
              }
            >
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Field
                  label="J_R / J_z / J_φ (kpc km/s)"
                  value={`${n(o, "J_R", 1)} / ${n(o, "J_z", 1)} / ${n(o, "J_phi", 1)}`}
                />
                <Field
                  label="time-averaged J (reference)"
                  value={`${n(o, "J_R_timeavg", 1)} / ${n(o, "J_z_timeavg", 1)} / ${n(o, "J_phi_timeavg", 1)}`}
                />
                <Field
                  label="Ω_R / Ω_z / Ω_φ (km/s/kpc)"
                  value={`${n(o, "Omega_R", 1)} / ${n(o, "Omega_z", 1)} / ${n(o, "Omega_phi", 1)}`}
                />
                <Field
                  label="action reliability"
                  value={
                    <span
                      className={
                        s(o, "action_reliability_flag") === "sampled_ok"
                          ? "text-foreground"
                          : "text-tier-c"
                      }
                    >
                      {s(o, "action_reliability_flag")}
                    </span>
                  }
                  title="sampled_ok ≤15% | sampled_caution ≤50% | sampled_poor >50% max fractional J difference vs orbit-averaged"
                />
                <Field
                  label="max |ΔJ|/J vs time-avg"
                  value={n(o, "action_max_fracdiff", 3)}
                />
                <Field
                  label="resonance ratio Ω_R/(Ω_φ−Ω_p)"
                  value={n(o, "res_ratio_OmegaR_over_dPhi", 3)}
                />
              </dl>
            </Section>

            <Section title="Chemistry & multiplicity">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Field
                  label="[M/H] GSP-Phot (dex)"
                  value={n(m, "mh_gspphot", 2)}
                  title="photometric; biased toward solar for cool metal-poor giants — contextual only"
                />
                <Field
                  label="[Fe/H] spectroscopic (dex)"
                  value={
                    m.feh_spec !== null
                      ? `${n(m, "feh_spec", 2)} ± ${n(m, "feh_spec_err", 2)} (${s(m, "chem_survey")})`
                      : "—"
                  }
                />
                <Field label="α-abundance (dex)" value={n(m, "alpha_spec", 2)} />
                <Field
                  label="chemodynamic class"
                  value={s(m, "chem_population")}
                  title="Splash / GSE / Aurora / disk from [Fe/H]+α thresholds (117-star subset)"
                />
                <Field
                  label="Gaia NSS two-body"
                  value={
                    m.nss_two_body === true
                      ? `yes (${s(m, "nss_solution_type")})`
                      : "no"
                  }
                />
              </dl>
            </Section>
          </div>
        </div>
      ) : (
        <div className="panel p-4 mt-4 text-sm text-muted">
          This source is not in the Tier A+B+C orbit sample (P ≤ 0.5), so the
          release publishes no orbit summaries for it.
        </div>
      )}

      <div className="mt-4 text-xs text-faint">
        <Link href="/catalogue" className="textlink">
          ← back to the catalogue
        </Link>
      </div>
    </div>
  );
}
