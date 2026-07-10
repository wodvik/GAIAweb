import Link from "next/link";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Summary {
  catalogue: {
    tier_counts: Record<string, number>;
    headline_tier_A_plus_B: number;
    orbit_summary_tier_A_plus_B_plus_C: number;
    n_processed: number;
    point_estimate_vgrf_lt25: number;
  };
  orbits: {
    static_ecc_tierABC: { p50: number };
    static_R_peri_kpc_tierABC: { p50: number };
    static_R_apo_kpc_tierABC: { p50: number };
    n_static_R_peri_lt_100pc_tierABC: number;
    n_barred_R_peri_lt_100pc_tierABC: number;
  };
}

function loadSummary(): Summary {
  const p = join(process.cwd(), "public", "data", "catalogue", "summary.json");
  return JSON.parse(readFileSync(p, "utf8")) as Summary;
}

function Stat({
  value,
  label,
  sub,
}: {
  value: string;
  label: string;
  sub?: string;
}) {
  return (
    <div className="panel px-4 py-3">
      <div className="num text-2xl text-accent">{value}</div>
      <div className="text-sm text-foreground mt-0.5">{label}</div>
      {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function Card({
  href,
  title,
  children,
}: {
  href: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="panel p-5 hover:border-accent/50 transition-colors block"
    >
      <h3 className="font-medium text-accent">{title} →</h3>
      <p className="text-sm text-muted mt-2 leading-relaxed">{children}</p>
    </Link>
  );
}

export default function Home() {
  const s = loadSummary();
  const c = s.catalogue;
  const o = s.orbits;
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 w-full">
      <section className="max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight leading-tight">
          Stars that have almost stopped moving{" "}
          <span className="text-muted">— in the frame of the Galaxy.</span>
        </h1>
        <p className="mt-4 text-muted leading-relaxed">
          The instantaneous Galactic rest-frame speed{" "}
          <span className="num">
            V<sub>GRF</sub> = |<b>v</b>
            <sub>galactocentric</sub>|
          </span>{" "}
          of a typical disc star is a few hundred km s⁻¹. This site is the
          interactive companion to{" "}
          <em>
            A Probabilistic Gaia DR3 Catalogue of Stars with Very Low Galactic
            Rest-Frame Speeds
          </em>{" "}
          (Humble 2026): a probability-scored sample of stars with{" "}
          <span className="num">
            P(V<sub>GRF</sub> &lt; 25 km s⁻¹)
          </span>{" "}
          — stars caught near an orbital turning point with almost no angular
          momentum. In any centrally concentrated potential they must fall back
          toward the inner Galaxy: their orbits are nearly radial plunges. Here
          you can browse every candidate, follow each step of the math, and
          integrate the orbits yourself — in the paper&apos;s own galactic
          potential models, live in your browser.
        </p>
      </section>

      <section className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          value={String(c.headline_tier_A_plus_B)}
          label="Tier A+B stars"
          sub="P(V_GRF < 25 km/s) > 0.84 — the primary catalogue"
        />
        <Stat
          value={String(c.orbit_summary_tier_A_plus_B_plus_C)}
          label="Tier A+B+C with orbits"
          sub="P > 0.50, integrated 4 Gyr in each model"
        />
        <Stat
          value={o.static_ecc_tierABC.p50.toFixed(3)}
          label="median eccentricity"
          sub="point-estimate, adopted static model"
        />
        <Stat
          value={`${Math.round(o.static_R_peri_kpc_tierABC.p50 * 1000)} pc`}
          label="median pericentre"
          sub={`${o.n_static_R_peri_lt_100pc_tierABC} stars reach R < 100 pc (static); ${o.n_barred_R_peri_lt_100pc_tierABC} with the bar`}
        />
      </section>

      <section className="mt-10 grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card href="/viewer" title="3D orbit viewer">
          Pick any of the {c.orbit_summary_tier_A_plus_B_plus_C} Tier A+B+C
          stars, choose a galactic potential model (static Hunter+2024,
          McMillan 2017, or the barred models across the paper&apos;s Ω
          <sub>p</sub> grid) and watch its 4-Gyr orbit integrate live — with
          the Sun and well-measured context stars for scale, and overlays that
          show the model itself at work.
        </Card>
        <Card href="/catalogue" title="Catalogue browser">
          Filter and search all {c.n_processed.toLocaleString()} candidate
          sources by tier, membership probability, quality flags and
          chemistry; every star has a full detail page with Monte Carlo orbit
          posteriors and both-model orbit summaries.
        </Card>
        <Card href="/methods" title="The math, step by step">
          From five Gaia numbers to a catalogue probability: parallax
          zero-point, Bailer-Jones distance, the exact Galactocentric
          transform (all four solar-frame variants), V<sub>GRF</sub>, and the
          Monte Carlo tiering — with live numbers for real stars.
        </Card>
        <Card href="/figures" title="Ensemble figures">
          Interactive versions of the paper&apos;s key figures: pericentre vs
          apocentre, E–L<sub>z</sub>, the Toomre diagram, the sky map, and the
          smooth-continuation excess.
        </Card>
        <Card href="/about" title="Provenance & caveats">
          Release v1.0.8-review, DOIs, licensing — and the honest fine print:
          which numbers are model outputs, where actions are unreliable, and
          how the in-browser engine is validated against the published
          catalogue.
        </Card>
      </section>
    </div>
  );
}
