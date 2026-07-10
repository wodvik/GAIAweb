"""Diagnose where the exported hunter24_axi grid's force error concentrates."""
import numpy as np
import agama

from common import POTENTIALS
from export_potentials import (GridModel, StackedGrid, sph_to_cart,
                               pole_parity, sample_field, U_GRID, TH_GRID)

agama.setUnits(length=1, mass=1, velocity=1)
pot = agama.Potential(file=str(POTENTIALS / "MWPotentialHunter24_axi.ini"))

f = sample_field(pot, np.array([0.0]))
names = ["Phi", "ar", "ath"]
arrays = [f[k][:, :, 0] for k in names]
model = GridModel(StackedGrid(names, arrays, [pole_parity(k, 0) for k in names]))

rng = np.random.default_rng(42)
n = 40000
u = rng.uniform(-3.5, 1.6, n)
th = np.arccos(rng.uniform(-1, 1, n))
ph = rng.uniform(0, 2 * np.pi, n)
pts = sph_to_cart(10.0 ** u, th, ph)
a_true = pot.force(pts)
a_grid, _ = model.accel_phi(pts)
rel = np.linalg.norm(a_grid - a_true, axis=1) / np.linalg.norm(a_true, axis=1)

R = np.hypot(pts[:, 0], pts[:, 1])
z = pts[:, 2]
print("overall: p50=%.2e p99=%.2e max=%.2e" % (np.percentile(rel, 50),
      np.percentile(rel, 99), rel.max()))
worst = np.argsort(rel)[-15:][::-1]
print("worst points (rel_err, r_kpc, R_kpc, z_kpc, theta_deg):")
for i in worst:
    r = 10.0 ** u[i]
    print(f"  {rel[i]:.2e}  r={r:9.4f}  R={R[i]:9.4f}  z={z[i]:+9.4f}  "
          f"th={np.degrees(th[i]):7.2f}")

# error binned by |theta - 90 deg| and by radius
for lo, hi in [(0, 2), (2, 5), (5, 10), (10, 30), (30, 90)]:
    m = (np.abs(np.degrees(th) - 90) >= lo) & (np.abs(np.degrees(th) - 90) < hi)
    if m.sum():
        print(f"|th-90| in [{lo},{hi}) deg: n={m.sum():6d} p50={np.percentile(rel[m],50):.2e} "
              f"p99={np.percentile(rel[m],99):.2e} max={rel[m].max():.2e}")
for lo, hi in [(-3.5, -2), (-2, -1), (-1, 0), (0, 0.7), (0.7, 1.6)]:
    m = (u >= lo) & (u < hi)
    if m.sum():
        print(f"log10 r in [{lo},{hi}): n={m.sum():6d} p50={np.percentile(rel[m],50):.2e} "
              f"p99={np.percentile(rel[m],99):.2e} max={rel[m].max():.2e}")
