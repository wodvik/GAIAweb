"""Export 'show the model' overlays for the 3D viewer:

* midplane equipotential contours Phi(x, y, z=0) for each model
* for barred models additionally EFFECTIVE-potential contours
  Phi_eff = Phi - 1/2 Omega_p^2 R^2 for each paper pattern speed
  (these show the Lagrange-point saddle structure at corotation)
* meridional-plane contours Phi(R, z) for the axisymmetric models

Contours are matplotlib-extracted polylines, decimated and rounded, written
to web/public/data/overlays/<model>.json. Barred contours are in the BAR
frame (same convention as the force grids).

Run under WSL: python3 pipeline/export_overlays.py
"""

from __future__ import annotations

import numpy as np

import agama
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from common import (
    BAR_PATTERN_SPEEDS,
    POTENTIALS,
    RELEASE_TAG,
    ensure_outdir,
    write_json,
)
from pathlib import Path

agama.setUnits(length=1, mass=1, velocity=1)

EXTENT = 14.0  # kpc, half-width of the contour box
NGRID = 361


def contour_polylines(X, Y, Z, levels, max_pts=260):
    fig, ax = plt.subplots()
    cs = ax.contour(X, Y, Z, levels=levels)
    out = []
    # matplotlib >=3.8: use cs.allsegs
    for li, segs in enumerate(cs.allsegs):
        for seg in segs:
            if len(seg) < 6:
                continue
            step = max(1, len(seg) // max_pts)
            pts = seg[::step]
            out.append({
                "level": float(levels[li]),
                "xy": [[round(float(x), 3), round(float(y), 3)] for x, y in pts],
            })
    plt.close(fig)
    return out


def midplane_grid(pot, extent=EXTENT, n=NGRID):
    xs = np.linspace(-extent, extent, n)
    X, Y = np.meshgrid(xs, xs)
    pts = np.column_stack([X.ravel(), Y.ravel(), np.zeros(X.size)])
    Phi = pot.potential(pts).reshape(X.shape)
    return X, Y, Phi


def meridional_grid(pot, rext=EXTENT, zext=8.0, n=NGRID):
    Rs = np.linspace(0.02, rext, n)
    zs = np.linspace(-zext, zext, n)
    R, Z = np.meshgrid(Rs, zs)
    pts = np.column_stack([R.ravel(), np.zeros(R.size), Z.ravel()])
    Phi = pot.potential(pts).reshape(R.shape)
    return R, Z, Phi


def phi_levels(pot, radii=(0.5, 1, 2, 3, 4, 6, 8, 10, 13)):
    pts = np.column_stack([np.array(radii), np.zeros(len(radii)), np.zeros(len(radii))])
    return sorted(pot.potential(pts).tolist())


def export_model(name, pot, outdir, barred=False):
    print(f"[{name}] contours ...")
    X, Y, Phi = midplane_grid(pot)
    levels = phi_levels(pot)
    data = {
        "release": RELEASE_TAG,
        "name": name,
        "frame": "bar" if barred else "galactocentric",
        "extent_kpc": EXTENT,
        "midplanePhi": contour_polylines(X, Y, Phi, levels),
    }
    if not barred:
        R, Z, PhiRZ = meridional_grid(pot)
        data["meridionalPhi"] = contour_polylines(R, Z, PhiRZ, levels)
    else:
        R2 = X * X + Y * Y
        data["effective"] = {}
        speeds = {str(v): float(v) for v in
                  BAR_PATTERN_SPEEDS["sensitivity_grid_kms_kpc"]}
        for label, op in speeds.items():
            Phi_eff = Phi - 0.5 * op * op * R2
            # levels: bracket the corotation saddle — use values at radii
            # around R_CR plus inner disc levels
            probe_r = np.array([2, 3, 4, 4.5, 5, 5.5, 6, 6.5, 7, 8, 9, 10])
            pr = np.column_stack([probe_r, np.zeros(len(probe_r)), np.zeros(len(probe_r))])
            lv = sorted(set((pot.potential(pr) - 0.5 * op * op * probe_r ** 2).tolist()))
            data["effective"][label] = contour_polylines(X, Y, Phi_eff, lv)
    write_json(outdir / f"{name}.json", data)


def main():
    outdir = ensure_outdir("overlays")

    pot_axi = agama.Potential(file=str(POTENTIALS / "MWPotentialHunter24_axi.ini"))
    export_model("hunter24_axi", pot_axi, outdir)

    mcm_ini = Path(agama.__file__).parent / "data" / "McMillan17.ini"
    export_model("mcmillan17", agama.Potential(file=str(mcm_ini)), outdir)

    pot_full = agama.Potential(file=str(POTENTIALS / "MWPotentialHunter24_full.ini"))
    export_model("hunter24_bar", pot_full, outdir, barred=True)

    pot_por = agama.Potential(file=str(POTENTIALS / "Portail17_wp6.ini"))
    export_model("portail17", pot_por, outdir, barred=True)


if __name__ == "__main__":
    main()
