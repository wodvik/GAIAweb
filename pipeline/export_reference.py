"""Export reference objects for the orbit viewer:

* the Sun (from the release solar-frame conventions, all four solar variants)
* a synthetic LSR circular-orbit tracer at R0
* well-measured context stars (Barnard's Star, Kapteyn's Star, Arcturus,
  Groombridge 1830) with astrometry resolved live from SIMBAD / the Gaia DR3
  archive (never from memory), provenance recorded per star
* featured catalogue stars (top Tier A, deepest Sgr A* approach, the
  long-apocentre 'bridger' candidates)

plus AGAMA reference trajectories (static Hunter+2024 axi and barred default
Omega_p = 37.5) for every object, used both for instant display and for
point-wise validation of the browser integrator.

Run under WSL: python3 pipeline/export_reference.py
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request

import numpy as np
import pandas as pd
import astropy.coordinates as coord
import astropy.units as u

import agama

from common import (
    BAR_ANGLE_RAD,
    BAR_PATTERN_SPEEDS,
    CATALOGUES,
    GYR_PER_TIMEUNIT,
    POTENTIALS,
    RELEASE_TAG,
    SOLAR,
    ensure_outdir,
    write_json,
)

agama.setUnits(length=1, mass=1, velocity=1)

ORBITS_CSV = CATALOGUES / "catalogue_expanded_orbits_tierABC.csv"
TRAJ_POINTS = 2001
T_INT = 4.0 / GYR_PER_TIMEUNIT

SIMBAD_TAP = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync"
GAIA_TAP = "https://gea.esac.esa.int/tap-server/tap/sync"


def tap_query(url, adql):
    data = urllib.parse.urlencode({
        "REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "json", "QUERY": adql,
    }).encode()
    req = urllib.request.Request(url, data=data)
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read().decode())
    cols = [c["name"] for c in payload["metadata"]]
    return [dict(zip(cols, row)) for row in payload["data"]]


def adql_str(s):
    return s.replace("'", "''")


def resolve_gaia_dr3_id(simbad_name):
    q = ("SELECT i2.id FROM ident i1 JOIN ident i2 ON i1.oidref = i2.oidref "
         f"WHERE i1.id = '{adql_str(simbad_name)}' AND i2.id LIKE 'Gaia DR3%'")
    rows = tap_query(SIMBAD_TAP, q)
    if not rows:
        return None
    return rows[0]["id"].split()[-1]


def gaia_dr3_astrometry(source_id):
    q = ("SELECT source_id, ra, dec, parallax, parallax_error, pmra, pmdec, "
         "radial_velocity, radial_velocity_error, phot_g_mean_mag "
         f"FROM gaiadr3.gaia_source WHERE source_id = {source_id}")
    rows = tap_query(GAIA_TAP, q)
    return rows[0] if rows else None


def simbad_astrometry(simbad_name):
    q = ("SELECT b.main_id, b.ra, b.dec, b.plx_value, b.pmra, b.pmdec, "
         "b.rvz_radvel FROM ident i JOIN basic b ON i.oidref = b.oid "
         f"WHERE i.id = '{adql_str(simbad_name)}'")
    rows = tap_query(SIMBAD_TAP, q)
    return rows[0] if rows else None


def galcen_frame(variant):
    s = SOLAR[variant]
    return coord.Galactocentric(
        galcen_distance=s["R0_kpc"] * u.kpc,
        z_sun=s["z_sun_pc"] * u.pc,
        galcen_v_sun=coord.CartesianDifferential(
            s["U_kms"] * u.km / u.s,
            (s["Vc_kms"] + s["V_kms"]) * u.km / u.s,
            s["W_kms"] * u.km / u.s,
        ),
    )


def icrs_to_galcen(ra_deg, dec_deg, dist_pc, pmra, pmdec, rv, variant="default"):
    icrs = coord.SkyCoord(
        ra=ra_deg * u.deg, dec=dec_deg * u.deg, distance=dist_pc * u.pc,
        pm_ra_cosdec=pmra * u.mas / u.yr, pm_dec=pmdec * u.mas / u.yr,
        radial_velocity=rv * u.km / u.s, frame="icrs",
    )
    g = icrs.transform_to(galcen_frame(variant))
    return [g.x.to_value(u.kpc), g.y.to_value(u.kpc), g.z.to_value(u.kpc),
            g.v_x.to_value(u.km / u.s), g.v_y.to_value(u.km / u.s),
            g.v_z.to_value(u.km / u.s)]


def sun_ic(variant="default"):
    """Sun position/velocity per the astropy Galactocentric frame definition:
    the Sun sits at (-sqrt(d^2 - z_sun^2), 0, z_sun) and moves with
    galcen_v_sun (components already in Galactocentric axes)."""
    s = SOLAR[variant]
    d = s["R0_kpc"]
    zs = s["z_sun_pc"] / 1000.0
    return [-np.sqrt(d * d - zs * zs), 0.0, zs,
            s["U_kms"], s["Vc_kms"] + s["V_kms"], s["W_kms"]]


def rotz(v, angle):
    c, s = np.cos(angle), np.sin(angle)
    out = np.array(v, dtype=float)
    x, y = out[..., 0].copy(), out[..., 1].copy()
    out[..., 0] = c * x - s * y
    out[..., 1] = s * x + c * y
    return out


def integrate_reference(pot, ic, omega=0.0):
    kwargs = dict(potential=pot, ic=np.array([ic]), time=T_INT,
                  trajsize=TRAJ_POINTS)
    if omega != 0.0:
        kwargs["Omega"] = omega
    res = agama.orbit(**kwargs)
    traj = np.asarray(res[0, 1]) if res.ndim == 2 else np.asarray(res[1])
    return traj


def pmin(R):
    dR = np.diff(R)
    idx = np.where((dR[:-1] < 0) & (dR[1:] > 0))[0] + 1
    best = float(R.min())
    for k in idx:
        y0, y1, y2 = R[k - 1], R[k], R[k + 1]
        den = y0 - 2 * y1 + y2
        if den > 0:
            ym = y1 - (y0 - y2) ** 2 / (8.0 * den)
            if ym < best:
                best = ym
    return best


def traj_summary(traj):
    x, y, z = traj[:, 0], traj[:, 1], traj[:, 2]
    R = np.hypot(x, y)
    rp, ra = pmin(R), float(R.max())
    return {"R_peri_kpc": round(rp, 5), "R_apo_kpc": round(ra, 5),
            "z_max_kpc": round(float(np.abs(z).max()), 5),
            "ecc": round((ra - rp) / (ra + rp), 5)}


def pack_traj(traj):
    """Positions only, rounded to 0.1 pc, as flat [x0,y0,z0,x1,...]."""
    return [round(float(v), 4) for v in traj[:, :3].ravel()]


def build_context_objects():
    objects = []

    # --- the Sun -----------------------------------------------------------
    ic_by_variant = {v: [round(x, 6) for x in sun_ic(v)] for v in SOLAR}
    objects.append({
        "id": "sun",
        "label": "Sun",
        "category": "context",
        "provenance": ("frame origin of the release solar conventions "
                       "(astropy Galactocentric with config.yml solar_variants)"),
        "ic": ic_by_variant["default"],
        "icByVariant": ic_by_variant,
    })

    # --- synthetic LSR circular tracer --------------------------------------
    s = SOLAR["default"]
    r0 = s["R0_kpc"]
    objects.append({
        "id": "lsr",
        "label": "LSR circular tracer",
        "category": "context",
        "provenance": (f"synthetic: circular orbit at R0={r0} kpc, z=0, "
                       f"v_phi=Vc={s['Vc_kms']} km/s (release default variant)"),
        "ic": [-r0, 0.0, 0.0, 0.0, s["Vc_kms"], 0.0],
    })

    # --- real context stars --------------------------------------------------
    gaia_targets = [
        ("barnard", "NAME Barnard's star", "Barnard's Star",
         "nearest single star; very high proper motion; thick-disc-like orbit"),
        ("kapteyn", "NAME Kapteyn's star", "Kapteyn's Star",
         "retrograde halo archetype"),
        ("groombridge1830", "NAME Groombridge 1830", "Groombridge 1830",
         "classic high-velocity halo subdwarf"),
    ]
    for oid, simbad_name, label, why in gaia_targets:
        try:
            dr3 = resolve_gaia_dr3_id(simbad_name)
            row = gaia_dr3_astrometry(dr3) if dr3 else None
        except Exception as exc:
            print(f"WARN {label}: Gaia lookup failed ({exc})")
            row = None
        if row is None or row.get("radial_velocity") is None:
            print(f"WARN {label}: no usable Gaia DR3 6D row; falling back to SIMBAD")
            sb = simbad_astrometry(simbad_name)
            if sb is None or sb.get("plx_value") in (None, 0):
                print(f"SKIP {label}: no astrometry available")
                continue
            dist_pc = 1000.0 / sb["plx_value"]
            ic = icrs_to_galcen(sb["ra"], sb["dec"], dist_pc, sb["pmra"],
                                sb["pmdec"], sb["rvz_radvel"])
            prov = "SIMBAD basic astrometry (live query)"
            obs = sb
        else:
            dist_pc = 1000.0 / row["parallax"]
            ic = icrs_to_galcen(row["ra"], row["dec"], dist_pc, row["pmra"],
                                row["pmdec"], row["radial_velocity"])
            prov = f"Gaia DR3 {row['source_id']} (live archive query, 1/parallax distance)"
            obs = row
        objects.append({
            "id": oid, "label": label, "category": "context",
            "why": why, "provenance": prov,
            "observables": {k: (round(v, 6) if isinstance(v, float) else v)
                            for k, v in obs.items()},
            "ic": [round(x, 6) for x in ic],
        })

    # --- Arcturus (too bright for Gaia DR3) ---------------------------------
    sb = simbad_astrometry("* alf Boo")
    if sb and sb.get("plx_value"):
        dist_pc = 1000.0 / sb["plx_value"]
        ic = icrs_to_galcen(sb["ra"], sb["dec"], dist_pc, sb["pmra"],
                            sb["pmdec"], sb["rvz_radvel"])
        objects.append({
            "id": "arcturus", "label": "Arcturus", "category": "context",
            "why": "bright thick-disc giant; the classic 'high-velocity star'",
            "provenance": "SIMBAD basic astrometry (live query; Hipparcos-based)",
            "observables": {k: (round(v, 6) if isinstance(v, float) else v)
                            for k, v in sb.items()},
            "ic": [round(x, 6) for x in ic],
        })
    else:
        print("WARN Arcturus: SIMBAD lookup failed")

    return objects


def build_featured_stars():
    df = pd.read_csv(ORBITS_CSV, dtype={"source_id": "int64"})
    picks = {}

    tierA = df[(df["tier"] == "A") & df["rvs_quality_ok"]].sort_values(
        "P_vgrf_below_25", ascending=False)
    for _, r in tierA.head(4).iterrows():
        picks[r["source_id"]] = "among the highest-probability Tier A members (RVS ok)"

    deep = df.loc[df["static_min_r_sph_kpc"].idxmin()]
    picks[deep["source_id"]] = (
        "deepest point-estimate Sgr A* approach in the static model "
        f"({deep['static_min_r_sph_kpc']*1000:.1f} pc)")

    bridgers = df[(df["static_R_peri_kpc"] < 2.0) & (df["static_R_apo_kpc"] > 15.0)]
    for _, r in bridgers.iterrows():
        picks[r["source_id"]] = (
            "long-apocentre inner-reach candidate (static: "
            f"R_apo={r['static_R_apo_kpc']:.1f} kpc, R_peri={r['static_R_peri_kpc']*1000:.0f} pc)")

    objects = []
    for sid, why in picks.items():
        r = df[df["source_id"] == sid].iloc[0]
        objects.append({
            "id": str(sid),
            "label": f"Gaia DR3 {sid}",
            "category": "featured",
            "why": why,
            "tier": r["tier"],
            "P_vgrf_below_25": float(r["P_vgrf_below_25"]),
            "ic": [round(float(r[c]), 6) for c in
                   ("x_kpc", "y_kpc", "z_kpc", "vx_kms", "vy_kms", "vz_kms")],
        })
    return objects


def main():
    outdir = ensure_outdir("reference")

    objects = build_context_objects() + build_featured_stars()

    pot_axi = agama.Potential(file=str(POTENTIALS / "MWPotentialHunter24_axi.ini"))
    pot_full = agama.Potential(file=str(POTENTIALS / "MWPotentialHunter24_full.ini"))
    pot_bar = agama.Potential(potential=pot_full, rotation=BAR_ANGLE_RAD)
    omega_default = -float(BAR_PATTERN_SPEEDS["default"])

    for obj in objects:
        ic = obj["ic"]
        traj_s = integrate_reference(pot_axi, ic)
        obj["static"] = {"summary": traj_summary(traj_s),
                         "trajectory": pack_traj(traj_s)}
        traj_b = integrate_reference(pot_bar, ic, omega=omega_default)
        obj["barred"] = {"summary": traj_summary(traj_b),
                         "omega_p": -omega_default,
                         "frame": "corotating (release convention)",
                         "trajectory": pack_traj(traj_b)}
        print(f"{obj['label']}: static {obj['static']['summary']}")

    write_json(outdir / "objects.json", {
        "release": RELEASE_TAG,
        "trajPoints": TRAJ_POINTS,
        "tGyr": 4.0,
        "solarVariants": SOLAR,
        "barAngleRad": BAR_ANGLE_RAD,
        "objects": objects,
    })


if __name__ == "__main__":
    main()
