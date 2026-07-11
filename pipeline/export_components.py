"""Export the Hunter+2024 potential COMPONENT-WISE for the viewer's Model Lab.

The release potentials are pre-summed (Multipole + CylSpline), but the
original construction script shipped in the release workdir
(example_mw_potential_hunter24.py, Sormani/Vasiliev/Hunter) defines every
physical component analytically. We rebuild each component as its own AGAMA
potential and export a separate interpolation grid per component:

    halo       Einasto dark halo                       (Spheroid)
    disc_thin  thin stellar disc                       (Disk)
    disc_thick thick stellar disc                      (Disk)
    gas_hi     HI gas disc                             (Disk)
    gas_mol    molecular gas disc                      (Disk)
    nsd        nuclear stellar disc (2 spheroids)      (Sormani+2020)
    nsc        nuclear star cluster                    (Chatzopoulos+2015)
    bar_axi    Sormani+2022 bar, axisymmetrised (m=0)  (CylSpline)
    bar_full   Sormani+2022 bar, m<=8, bar frame       (CylSpline, fourier3d)

Sgr A* is an analytic Plummer (M=4.1e6 Msun, a=1 pc) evaluated exactly in the
browser — no grid. Because gravity is linear, the browser reconstructs
    Phi_total = sum_i k_i * Phi_i  (+ k_bh * Phi_plummer)
EXACTLY for any set of mass multipliers k_i. k=1 must reproduce the paper's
model: this script validates the k=1 sum against the release grids
(force level) and against the published static/barred orbit columns
(orbit level) before writing anything.

Run under WSL:  python3 pipeline/export_components.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

import agama

from common import (
    BAR_ANGLE_RAD,
    CATALOGUES,
    GYR_PER_TIMEUNIT,
    POTENTIALS,
    RELEASE_TAG,
    ensure_outdir,
    write_json,
)
from export_potentials import (
    NU,
    NTH,
    NPHI,
    GridModel,
    StackedGrid,
    catalogue_test_stars,
    compare_orbit_sets,
    integrate_grid,
    pole_parity,
    rotz,
    sample_field,
    sph_to_cart,
    summarize,
)

agama.setUnits(length=1, mass=1, velocity=1)
T0 = time.time()

WORKDIR = Path("/mnt/c/Users/humbl/GAIA2026/release/_iterations/v2/phase3_agama/_hunter24_workdir")
sys.path.insert(0, str(WORKDIR))
from example_mw_bar_potential import makeBarDensity  # noqa: E402  (release workdir)

G_KPC = 4.300917270e-6  # G in kpc (km/s)^2 / Msun
MMAX_BAR = 8
MOMENT_KEEP_REL = 3e-4


def log(msg):
    print(f"[export_components t={time.time()-T0:6.1f}s] {msg}", flush=True)


# --- component definitions, verbatim from example_mw_potential_hunter24.py ---

PLUMMER_BH = {"mass": 4.1e6, "scaleRadius": 1e-3}

PARAMS_NSC = dict(type="Spheroid", mass=6.1e7, gamma=0.71, beta=4, alpha=1,
                  axisRatioZ=0.73, scaleRadius=0.0059, outerCutoffRadius=0.1)
PARAMS_NSD = [
    dict(type="Spheroid", densityNorm=2.00583e12, gamma=0, beta=0, alpha=1,
         axisRatioZ=0.37, outerCutoffRadius=0.00506, cutoffStrength=0.72),
    dict(type="Spheroid", densityNorm=1.53e12, gamma=0, beta=0, alpha=1,
         axisRatioZ=0.37, outerCutoffRadius=0.0246, cutoffStrength=0.79),
]
PARAMS_DISC_THIN = dict(type="Disk", surfaceDensity=1.332e9, scaleRadius=2.0,
                        scaleHeight=0.3, innerCutoffRadius=2.7, sersicIndex=1)
PARAMS_DISC_THICK = dict(type="Disk", surfaceDensity=8.97e8, scaleRadius=2.8,
                         scaleHeight=0.9, innerCutoffRadius=2.7, sersicIndex=1)
PARAMS_GAS_HI = dict(type="Disk", surfaceDensity=5.81e7, scaleRadius=7,
                     scaleHeight=-0.085, innerCutoffRadius=4, sersicIndex=1)
PARAMS_GAS_MOL = dict(type="Disk", surfaceDensity=2.68e9, scaleRadius=1.5,
                      scaleHeight=-0.045, innerCutoffRadius=12, sersicIndex=1)
PARAMS_DARK = dict(type="Spheroid", densitynorm=2.774e11, gamma=0, beta=0,
                   alpha=1, outerCutoffRadius=8.682e-6, cutoffStrength=0.1704)

MULTIPOLE_OPTS = dict(lmax=12, gridSizeR=36, rmin=1e-4, rmax=1000)
CYLSPLINE_OPTS = dict(gridSizeR=30, gridSizez=32, Rmin=0.1, Rmax=200,
                      zmin=0.05, zmax=200)

COMPONENTS = [
    # (id, label, group, builder)
    ("halo", "dark halo (Einasto)", "halo",
     lambda: agama.Potential(type="Multipole",
                             density=agama.Density(PARAMS_DARK), **MULTIPOLE_OPTS)),
    ("disc_thin", "thin stellar disc", "disc",
     lambda: agama.Potential(type="CylSpline", mmax=0,
                             density=agama.Density(PARAMS_DISC_THIN), **CYLSPLINE_OPTS)),
    ("disc_thick", "thick stellar disc", "disc",
     lambda: agama.Potential(type="CylSpline", mmax=0,
                             density=agama.Density(PARAMS_DISC_THICK), **CYLSPLINE_OPTS)),
    ("gas_hi", "HI gas disc", "gas",
     lambda: agama.Potential(type="CylSpline", mmax=0,
                             density=agama.Density(PARAMS_GAS_HI), **CYLSPLINE_OPTS)),
    ("gas_mol", "molecular gas disc", "gas",
     lambda: agama.Potential(type="CylSpline", mmax=0,
                             density=agama.Density(PARAMS_GAS_MOL), **CYLSPLINE_OPTS)),
    ("nsd", "nuclear stellar disc (Sormani+20)", "nsd",
     lambda: agama.Potential(type="Multipole",
                             density=agama.Density(*PARAMS_NSD), **MULTIPOLE_OPTS)),
    ("nsc", "nuclear star cluster (Chatzopoulos+15)", "nsc",
     lambda: agama.Potential(type="Multipole",
                             density=agama.Density(PARAMS_NSC), **MULTIPOLE_OPTS)),
    ("bar_axi", "bar, axisymmetrised (Sormani+22)", "bar",
     lambda: agama.Potential(type="CylSpline", mmax=0,
                             density=makeBarDensity(), **CYLSPLINE_OPTS)),
]


def plummer_accel_phi(pts, mass=PLUMMER_BH["mass"], a=PLUMMER_BH["scaleRadius"]):
    r2 = np.sum(pts * pts, axis=1)
    s = np.sqrt(r2 + a * a)
    phi = -G_KPC * mass / s
    f = -G_KPC * mass / s ** 3
    return pts * f[:, None], phi


def export_axi_component(cid, label, group, pot, outdir):
    f = sample_field(pot, np.array([0.0]))
    names = ["Phi", "ar", "ath"]
    arrays = [f[k][:, :, 0] for k in names]
    parities = [pole_parity(k, 0) for k in names]
    buf = b"".join(a.astype("<f4").tobytes() for a in arrays)
    (outdir / f"{cid}.f32").write_bytes(buf)
    # rotation curve of this component (vc^2 contribution, may be negative
    # for none here; clip at 0)
    R = np.logspace(-3, 2, 200)
    pts = np.column_stack([R, np.zeros_like(R), np.zeros_like(R)])
    aR = pot.force(pts)[:, 0]
    vc2 = -R * aR
    log(f"  [{cid}] grid written ({len(buf)//1024} kB), M~{pot.totalMass():.3e} Msun")
    model = GridModel(StackedGrid(names, arrays, parities))
    return model, {
        "id": cid, "label": label, "group": group,
        "kind": "axisymmetric",
        "file": f"{cid}.f32",
        "arrays": names, "poleParity": parities,
        "totalMass_Msun": float(pot.totalMass()),
        "vc2_R_kpc": np.round(R, 5).tolist(),
        "vc2_kms2": np.round(vc2, 4).tolist(),
    }


def export_bar_full(outdir):
    log("[bar_full] building CylSpline mmax=8 of the bar density (slow) ...")
    pot = agama.Potential(type="CylSpline", mmax=MMAX_BAR,
                          density=makeBarDensity(), **CYLSPLINE_OPTS)
    phis = np.arange(NPHI) * (2 * np.pi / NPHI)
    f = sample_field(pot, phis)
    F = np.fft.rfft(np.stack([f[q] for q in ("Phi", "ar", "ath", "aphi")]),
                    axis=-1) / NPHI
    names, arrays, parities = [], [], []
    kept_m = set()
    qnames = ("Phi", "ar", "ath", "aphi")
    scale_phi = np.abs(F[0, :, :, 0].real).max(axis=1) + 1e-30
    scale_force = np.abs(F[1, :, :, 0].real).max(axis=1) + 1e-30
    for i, q in enumerate(qnames):
        scale = scale_phi if q == "Phi" else scale_force
        for m in range(0, MMAX_BAR + 3):
            fac = 1.0 if m == 0 else 2.0
            C = fac * F[i, :, :, m].real
            S = -fac * F[i, :, :, m].imag
            rel_c = (np.abs(C).max(axis=1) / scale).max()
            rel_s = (np.abs(S).max(axis=1) / scale).max()
            if m == 0 or rel_c > MOMENT_KEEP_REL:
                names.append(f"{q}_C{m}")
                arrays.append(C)
                parities.append(pole_parity(q, m))
                kept_m.add(m)
            if m > 0 and rel_s > MOMENT_KEEP_REL:
                names.append(f"{q}_S{m}")
                arrays.append(S)
                parities.append(pole_parity(q, m))
                kept_m.add(m)
    kept_m = sorted(kept_m)
    buf = b"".join(a.astype("<f4").tobytes() for a in arrays)
    (outdir / "bar_full.f32").write_bytes(buf)
    log(f"  [bar_full] retained m={kept_m}, {len(names)} arrays, {len(buf)//1024} kB")
    model = GridModel(StackedGrid(names, arrays, parities), moments=kept_m)
    meta = {
        "id": "bar_full", "label": "bar, full m<=8 (Sormani+22)", "group": "bar",
        "kind": "fourier3d", "file": "bar_full.f32",
        "arrays": names, "poleParity": parities, "moments": kept_m,
        "totalMass_Msun": float(pot.totalMass()),
    }
    return model, meta, pot


class CompositeChecker:
    """k=1 composite evaluation for validation (mirrors the TS CompositeModel)."""

    def __init__(self, models, bar_model=None):
        self.models = models          # list of axisymmetric GridModel
        self.bar_model = bar_model    # optional fourier3d GridModel (replaces bar_axi)

    def accel_phi(self, pts):
        a = np.zeros_like(pts)
        phi = np.zeros(len(pts))
        for m in self.models:
            ai, pi = m.accel_phi(pts)
            a += ai
            phi += pi
        if self.bar_model is not None:
            ai, pi = self.bar_model.accel_phi(pts)
            a += ai
            phi += pi
        ab, pb = plummer_accel_phi(pts)
        return a + ab, phi + pb


def validate_static(models, outdir_meta):
    comp = CompositeChecker(models)
    pot_ref = agama.Potential(file=str(POTENTIALS / "MWPotentialHunter24_axi.ini"))
    rng = np.random.default_rng(11)
    u = rng.uniform(-3.5, 1.6, 4000)
    th = np.arccos(rng.uniform(-1, 1, 4000))
    ph = rng.uniform(0, 2 * np.pi, 4000)
    pts = sph_to_cart(10.0 ** u, th, ph)
    a_ref = pot_ref.force(pts)
    a_sum, _ = comp.accel_phi(pts)
    rel = np.linalg.norm(a_sum - a_ref, axis=1) / np.linalg.norm(a_ref, axis=1)
    stats = {
        "force_rel_p50": float(np.percentile(rel, 50)),
        "force_rel_p99": float(np.percentile(rel, 99)),
        "force_rel_max": float(rel.max()),
    }
    log(f"[k=1 static sum vs release axi] p50={stats['force_rel_p50']:.2e} "
        f"p99={stats['force_rel_p99']:.2e} max={stats['force_rel_max']:.2e}")

    sub, ic = catalogue_test_stars(8)
    got = []
    for row in ic:

        class _M:
            accel_phi = staticmethod(comp.accel_phi)

        got.append(summarize(integrate_grid(_M, row)))
    ref = [{"R_peri": r, "R_apo": a, "z_max": z, "ecc": e}
           for r, a, z, e in sub[["static_R_peri_kpc", "static_R_apo_kpc",
                                  "static_z_max_kpc", "static_ecc"]].to_numpy()]
    ostats = compare_orbit_sets(got, ref, "component-sum vs published static_*")
    outdir_meta["validationStatic"] = {"forces": stats, "orbits": ostats}


def validate_barred(models_axi_no_bar, bar_model, outdir_meta):
    comp = CompositeChecker(models_axi_no_bar, bar_model=bar_model)
    pot_full = agama.Potential(file=str(POTENTIALS / "MWPotentialHunter24_full.ini"))
    rng = np.random.default_rng(13)
    u = rng.uniform(-3.5, 1.6, 3000)
    th = np.arccos(rng.uniform(-1, 1, 3000))
    ph = rng.uniform(0, 2 * np.pi, 3000)
    pts = sph_to_cart(10.0 ** u, th, ph)
    a_ref = pot_full.force(pts)
    a_sum, _ = comp.accel_phi(pts)
    rel = np.linalg.norm(a_sum - a_ref, axis=1) / np.linalg.norm(a_ref, axis=1)
    stats = {
        "force_rel_p50": float(np.percentile(rel, 50)),
        "force_rel_p99": float(np.percentile(rel, 99)),
        "force_rel_max": float(rel.max()),
    }
    log(f"[k=1 barred sum vs release full] p50={stats['force_rel_p50']:.2e} "
        f"p99={stats['force_rel_p99']:.2e} max={stats['force_rel_max']:.2e}")

    omega = -37.5
    sub, ic_gal = catalogue_test_stars(6)
    ic_bar = ic_gal.copy()
    ic_bar[:, :3] = rotz(ic_gal[:, :3], -BAR_ANGLE_RAD)
    ic_bar[:, 3:] = rotz(ic_gal[:, 3:], -BAR_ANGLE_RAD)
    got = []
    for row in ic_bar:

        class _M:
            accel_phi = staticmethod(comp.accel_phi)

        got.append(summarize(integrate_grid(_M, row, omega=omega)))
    ref = [{"R_peri": r, "R_apo": a, "z_max": z, "ecc": e}
           for r, a, z, e in sub[["barred_R_peri_kpc", "barred_R_apo_kpc",
                                  "barred_z_max_kpc", "barred_ecc"]].to_numpy()]
    ostats = compare_orbit_sets(got, ref, "component-sum vs published barred_*")
    outdir_meta["validationBarred"] = {"forces": stats, "orbits": ostats}


def main():
    outdir = ensure_outdir("lab")
    metas = []
    models = {}
    for cid, label, group, build in COMPONENTS:
        log(f"[{cid}] building potential ...")
        pot = build()
        model, meta = export_axi_component(cid, label, group, pot, outdir)
        metas.append(meta)
        models[cid] = model

    bar_model, bar_meta, _ = export_bar_full(outdir)
    metas.append(bar_meta)

    index = {
        "release": RELEASE_TAG,
        "source": "release/_iterations/v2/phase3_agama/_hunter24_workdir/"
                  "example_mw_potential_hunter24.py (Sormani/Vasiliev/Hunter)",
        "grid": {"nu": NU, "nth": NTH, "u0": -4.5, "u1": 2.6,
                 "thetaMax": float(np.pi),
                 "thetaMap": {"type": "s_plus_lambda_sin_2s", "lambda": 0.40}},
        "timeUnitGyr": GYR_PER_TIMEUNIT,
        "blackHole": {"type": "Plummer", **PLUMMER_BH,
                      "note": "evaluated analytically in the browser"},
        "barAngleRad": BAR_ANGLE_RAD,
        "barRotationSign": -1,
        "components": metas,
    }

    axi_ids = [c[0] for c in COMPONENTS]
    validate_static([models[c] for c in axi_ids], index)
    validate_barred([models[c] for c in axi_ids if c != "bar_axi"], bar_model, index)

    write_json(outdir / "index.json", index)


if __name__ == "__main__":
    main()
