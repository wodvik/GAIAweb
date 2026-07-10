import type { Metadata } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const metadata: Metadata = {
  title: "About & caveats — slow-VGRF explorer",
  description:
    "Provenance, validation, licensing and honest caveats for the slow-VGRF catalogue explorer.",
};

interface ValidationReport {
  generated: string;
  reports: {
    model: string;
    referenceColumns: string;
    omega: number;
    nStars: number;
    R_peri_absdiff_pc: { p50: number; p95: number; p99: number; max: number };
    R_apo_absdiff_pc: { p50: number; p99: number; max: number };
    ecc_absdiff: { p50: number; p99: number };
    energy_drift_rel: { p50: number; p99: number };
  }[];
}

function loadValidation(): ValidationReport | null {
  try {
    return JSON.parse(
      readFileSync(
        join(process.cwd(), "public", "data", "validation.json"),
        "utf8",
      ),
    ) as ValidationReport;
  } catch {
    return null;
  }
}

function Sec({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-5">
      <h2 className="font-medium text-accent">{title}</h2>
      <div className="mt-2 text-sm text-muted leading-relaxed space-y-2">
        {children}
      </div>
    </section>
  );
}

export default function AboutPage() {
  const val = loadValidation();
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 w-full space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">About this site</h1>
        <p className="text-sm text-muted mt-2 leading-relaxed">
          An interactive companion to{" "}
          <em>
            A Probabilistic Gaia DR3 Catalogue of Stars with Very Low Galactic
            Rest-Frame Speeds
          </em>{" "}
          (Humble 2026). Everything shown here derives from the frozen release
          bundle <span className="num">v1.0.8-review</span>; this site adds
          visualisation and computation, never new science claims.
        </p>
      </div>

      <Sec title="Data & code provenance">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Catalogue release:{" "}
            <a
              className="textlink"
              href="https://github.com/wodvik/gaia-slow-vgrf-catalogue"
            >
              wodvik/gaia-slow-vgrf-catalogue
            </a>{" "}
            · concept DOI{" "}
            <a className="textlink" href="https://doi.org/10.5281/zenodo.20116134">
              10.5281/zenodo.20116134
            </a>
          </li>
          <li>
            Catalogue tables served here are converted 1:1 from the release
            FITS/CSV products (
            <span className="num">catalogue_expanded_master.fits</span>,{" "}
            <span className="num">catalogue_expanded_orbits_tierABC.csv</span>,
            orbit Monte Carlo percentiles, McMillan-2017 comparison table).
            Gaia <span className="num">source_id</span>s are handled as
            strings throughout — they exceed 2⁵³.
          </li>
          <li>
            Potential models are the release&apos;s own AGAMA files
            (Hunter+2024 axisymmetrised and full barred, Portail+2017;
            McMillan 2017 from AGAMA&apos;s distribution), exported as dense
            force/potential grids by this repository&apos;s pipeline.
          </li>
          <li>
            Context-star astrometry (Barnard&apos;s Star, Kapteyn&apos;s Star,
            Arcturus) is fetched live from the Gaia archive / SIMBAD at build
            time, with per-object provenance stored in the data files.
          </li>
          <li>
            Underlying survey data: ESA Gaia DR3; distances from Bailer-Jones
            et al. (2021); parallax zero-points from Lindegren et al. (2021);
            chemistry cross-matches from APOGEE DR17 and GALAH DR3.
          </li>
        </ul>
      </Sec>

      <Sec title="How the in-browser orbit engine is validated">
        <p>
          The 3D viewer does not play back pre-rendered orbits — it integrates
          them in your browser, on interpolation grids sampled from the exact
          release potentials. Three validation gates run before any data ships:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            interpolated forces vs direct AGAMA evaluation at random points
            (typical relative error ~10⁻⁶, worst ~3×10⁻⁴);
          </li>
          <li>
            grid-integrated 4-Gyr test orbits vs AGAMA DOP853 in the pipeline
            (pericentre agreement ≲0.2 pc for the axisymmetric models);
          </li>
          <li>
            the browser engine itself, re-integrating the full Tier A+B+C
            sample and comparing against the published orbit columns:
          </li>
        </ul>
        {val ? (
          <table className="w-full text-xs num mt-2">
            <thead>
              <tr className="text-faint font-sans text-left">
                <th className="font-normal py-1">model vs columns</th>
                <th className="font-normal text-right">n</th>
                <th className="font-normal text-right">|ΔR_peri| p50</th>
                <th className="font-normal text-right">p99</th>
                <th className="font-normal text-right">max</th>
                <th className="font-normal text-right">|Δe| p50</th>
                <th className="font-normal text-right">E drift p50</th>
              </tr>
            </thead>
            <tbody>
              {val.reports.map((r) => (
                <tr key={r.model} className="border-t border-borderc/40">
                  <td className="py-1 font-sans text-muted">
                    {r.model} vs {r.referenceColumns}
                  </td>
                  <td className="text-right">{r.nStars}</td>
                  <td className="text-right">
                    {r.R_peri_absdiff_pc.p50.toFixed(3)} pc
                  </td>
                  <td className="text-right">
                    {r.R_peri_absdiff_pc.p99.toFixed(2)} pc
                  </td>
                  <td className="text-right">
                    {r.R_peri_absdiff_pc.max.toFixed(1)} pc
                  </td>
                  <td className="text-right">
                    {r.ecc_absdiff.p50.toExponential(1)}
                  </td>
                  <td className="text-right">
                    {r.energy_drift_rel.p50.toExponential(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-faint text-xs">
            validation report not yet generated
          </p>
        )}
        <p>
          The ICRS→Galactocentric transform used on the Methods page
          reproduces the release&apos;s astropy implementation to &lt;1
          milliparsec and &lt;4 cm s⁻¹ over all 1,952 orbit-sample stars.
        </p>
      </Sec>

      <Sec title="Caveats — read before quoting numbers">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <b className="text-foreground">
              Orbit quantities are model outputs, not observables.
            </b>{" "}
            R_peri, R_apo, eccentricity, z_max and actions all depend on the
            assumed potential, the solar frame, and the 4-Gyr static-model
            idealisation.
          </li>
          <li>
            <b className="text-foreground">Point estimate ≠ posterior.</b> The
            paper&apos;s headline Tier A+B+C medians are{" "}
            <i>Monte Carlo posterior medians</i> (e = 0.949, R_peri = 154 pc,
            R_apo = 7.35 kpc); the point-estimate medians (e = 0.964, R_peri ≈
            116 pc) are different numbers. Star pages show both.
          </li>
          <li>
            <b className="text-foreground">R_peri is cylindrical.</b> It is
            the closest approach to the rotation <i>axis</i>; closest approach
            to Sgr A* itself is the separate spherical{" "}
            <span className="num">min_r_sph</span> column. The paper finds{" "}
            <i>zero</i> stars with P(r&lt;10 pc) &gt; 0.5.
          </li>
          <li>
            <b className="text-foreground">
              Vertical actions are unreliable here.
            </b>{" "}
            The Stäckel fudge degrades for near-radial orbits: J_z has a
            median fractional error of ~62% in this sample (1,164 of 1,952
            stars flagged <span className="num">sampled_poor</span>). Treat
            J_z as qualitative.
          </li>
          <li>
            <b className="text-foreground">Selection is severe.</b> The Gaia
            RVS selection function is sparse exactly where these stars
            concentrate (83.2% of Tier A+B in prior-dominated cells);
            end-to-end injection recovery is 60.4%. Counts are lower limits on
            the underlying population, not measurements of it.
          </li>
          <li>
            <b className="text-foreground">Tiers are probabilities.</b> Tier
            A+B is expected to contain ~31 false positives (score-implied
            purity 94%). A Tier C star is a coin-flip-to-5:1 candidate, not a
            confirmed slow star.
          </li>
          <li>
            <b className="text-foreground">
              The barred results are frame-dependent.
            </b>{" "}
            Published barred columns use Ω_p = 37.5 km s⁻¹ kpc⁻¹ and a bar
            angle of −0.44 rad; the paper&apos;s inner-reach counts vary from
            3 (static) to 7–31 across the Ω_p grid. The viewer&apos;s other
            Ω_p choices are sensitivity explorations, not published values.
          </li>
          <li>
            <b className="text-foreground">This site&apos;s live integrations</b>{" "}
            reproduce the published columns to the tolerances in the table
            above — for anything requiring exact release values, use the
            release files themselves.
          </li>
        </ul>
      </Sec>

      <Sec title="Citation & licence">
        <p>
          If you use the catalogue, cite Humble (2026) and the Zenodo DOI
          above. Catalogue data: CC BY 4.0. Release code: MIT. This website is
          a visualisation layer; when numbers here and the paper disagree, the
          paper and release files win.
        </p>
        <p>
          Built with Next.js, react-three-fiber and AGAMA-derived data
          products. Site source:{" "}
          <a className="textlink" href="https://github.com/wodvik/GAIAweb">
            wodvik/GAIAweb
          </a>
          .
        </p>
      </Sec>
    </div>
  );
}
