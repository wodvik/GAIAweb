"""Export the paper's galactic potential models as web-ready interpolation grids.

For each model we sample AGAMA's potential and acceleration on a dense grid in
(u, theta), u = log10(r_sph/kpc), theta in [0, pi], and store float32 arrays
that the browser interpolates with bicubic Catmull-Rom (uniform grid, pole
reflection with per-array parity).

* axisymmetric models (Hunter+2024 axisymmetrised, McMillan 2017):
    arrays Phi, ar, ath  (a_phi = 0)

* barred models (Hunter+2024 full, Portail+2017), sampled in the BAR frame
  (native ini orientation, no rotation applied) so odd/sine moments vanish
  where the model is symmetric:
    azimuthal Fourier moments {q}_C{m} / {q}_S{m} for q in Phi, ar, ath, aphi:
    q(u,th,phi_bar) = sum_m C_m(u,th) cos(m phi_bar) + S_m(u,th) sin(m phi_bar)
  The release convention (phase0g/phase14v) is
    pot_bar = agama.Potential(potential=full, rotation=-0.44)   # bar angle
    agama.orbit(potential=pot_bar, Omega=-Omega_p, ...)         # rotating frame
  The browser reproduces this by rotating coordinates between the galactocentric
  frame and the bar frame (sign convention verified numerically below and
  recorded in metadata), integrating in the corotating frame with
  centrifugal + Coriolis terms for the selected pattern speed
  (paper grid 24/28/33/37.5/41 km/s/kpc, default 37.5, negative = clockwise).

Self-validation before anything is written:
1. interpolated force/potential vs direct AGAMA at random points;
2. 4-Gyr orbits integrated on the interpolated field (scipy DOP853) vs the
   published static_*/barred_* columns of catalogue_expanded_orbits_tierABC.csv
   (Hunter models) and vs direct agama.orbit runs (all models).

Run under WSL:  python3 pipeline/export_potentials.py [model_name]
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
    BAR_PATTERN_SPEEDS,
    CATALOGUES,
    GYR_PER_TIMEUNIT,
    POTENTIALS,
    RELEASE_TAG,
    ensure_outdir,
    write_json,
)

agama.setUnits(length=1, mass=1, velocity=1)

U0, U1 = -4.5, 2.6            # log10(r/kpc): 0.03 pc .. 400 kpc
NU = 356
NTH = 193                     # pseudo-angle s in [0, pi]
NPHI = 128
MMAX = 14
MOMENT_KEEP_REL = 3e-4

# theta is sampled through a stretched coordinate s: theta = s + LAM*sin(2s),
# which concentrates resolution near the disc plane (theta = pi/2) where the
# thin disc makes the field vary fastest (dtheta/ds = 1 - 2*LAM there).
# The map is symmetric: theta(pi - s) = pi - theta(s), so pole/equator
# reflection logic is unchanged in s-space.
LAM = 0.40

def theta_of_s(s):
    return s + LAM * np.sin(2.0 * s)

def s_of_theta(th):
    """Invert theta(s) by Newton iteration (matches the TS implementation)."""
    s = np.asarray(th, dtype=float).copy()
    for _ in range(4):
        f = s + LAM * np.sin(2.0 * s) - th
        fp = 1.0 + 2.0 * LAM * np.cos(2.0 * s)
        s -= f / fp
    return s

U_GRID = np.linspace(U0, U1, NU)
S_GRID = np.linspace(0.0, np.pi, NTH)
TH_GRID = theta_of_s(S_GRID)
DU = (U1 - U0) / (NU - 1)
DS = np.pi / (NTH - 1)

ORBITS_CSV = CATALOGUES / "catalogue_expanded_orbits_tierABC.csv"
T0 = time.time()


def log(msg):
    print(f"[export_potentials t={time.time()-T0:6.1f}s] {msg}", flush=True)


# ---------------------------------------------------------------------------
# sampling
# ---------------------------------------------------------------------------

def sph_to_cart(r, th, ph):
    st, ct = np.sin(th), np.cos(th)
    return np.column_stack([r * st * np.cos(ph), r * st * np.sin(ph), r * ct])


def sample_field(pot, phi_values):
    """Return dict of arrays (NU, NTH, nphi): Phi and spherical accel comps."""
    uu, tt, pp = np.meshgrid(U_GRID, TH_GRID, phi_values, indexing="ij")
    u, th, ph = uu.ravel(), tt.ravel(), pp.ravel()
    pts = sph_to_cart(10.0 ** u, th, ph)
    phi_val = pot.potential(pts)
    acc = pot.force(pts)
    st, ct = np.sin(th), np.cos(th)
    sp, cp = np.sin(ph), np.cos(ph)
    ax, ay, az = acc[:, 0], acc[:, 1], acc[:, 2]
    a_r = ax * st * cp + ay * st * sp + az * ct
    a_th = ax * ct * cp + ay * ct * sp - az * st
    a_ph = -ax * sp + ay * cp
    shape = (NU, NTH, len(phi_values))
    return {
        "Phi": phi_val.reshape(shape),
        "ar": a_r.reshape(shape),
        "ath": a_th.reshape(shape),
        "aphi": a_ph.reshape(shape),
    }


# ---------------------------------------------------------------------------
# stacked bicubic Catmull-Rom interpolator (numpy mirror of the TS code)
# ---------------------------------------------------------------------------

def cr_weights(t):
    t2, t3 = t * t, t * t * t
    return np.stack([
        -0.5 * t3 + t2 - 0.5 * t,
        1.5 * t3 - 2.5 * t2 + 1.0,
        -1.5 * t3 + 2.0 * t2 + 0.5 * t,
        0.5 * t3 - 0.5 * t2,
    ], axis=-1)


class StackedGrid:
    """K arrays of shape (NU, NTH) interpolated together.

    theta ghost indices reflect across the poles with per-array parity
    (crossing a pole maps phi -> phi + pi, i.e. a factor (-1)^m for moment m,
    times -1 for vector components ath/aphi whose unit vectors flip)."""

    def __init__(self, names, arrays, parities):
        self.names = list(names)
        self.A = np.ascontiguousarray(np.stack(arrays))     # (K, NU, NTH)
        self.parity = np.asarray(parities, dtype=float)     # (K,)
        self.index = {n: k for k, n in enumerate(self.names)}

    def eval(self, u, th):
        """u, th: (N,) -> values (K, N)."""
        u = np.atleast_1d(np.asarray(u, dtype=float))
        th = np.atleast_1d(np.asarray(th, dtype=float))
        fu = np.clip((u - U0) / DU, 0.0, NU - 1.000001)
        ft = s_of_theta(th) / DS
        iu = np.floor(fu).astype(int)
        it = np.floor(ft).astype(int)
        wu = cr_weights(fu - iu)   # (N,4)
        wt = cr_weights(ft - it)
        K = self.A.shape[0]
        out = np.zeros((K, len(u)))
        for a in range(4):
            ia = np.clip(iu + a - 1, 0, NU - 1)
            acc = np.zeros((K, len(u)))
            for b in range(4):
                jb = it + b - 1
                sign = np.ones(len(u))
                j = jb.copy()
                neg = j < 0
                j = np.where(neg, -j, j)
                over = j > NTH - 1
                j = np.where(over, 2 * (NTH - 1) - j, j)
                flip = neg | over
                vals = self.A[:, ia, j]                     # (K, N)
                if flip.any():
                    vals = np.where(flip[None, :],
                                    vals * self.parity[:, None], vals)
                acc += wt[:, b][None, :] * vals
            out += wu[:, a][None, :] * acc
        return out


class GridModel:
    """Force/potential evaluation exactly as the browser will do it."""

    def __init__(self, stacked: StackedGrid, moments=None):
        self.g = stacked
        self.moments = moments  # None => axisymmetric

    def _sph(self, xyz):
        x, y, z = xyz[:, 0], xyz[:, 1], xyz[:, 2]
        r = np.sqrt(x * x + y * y + z * z)
        r = np.maximum(r, 10.0 ** U0)
        u = np.log10(r)
        th = np.arccos(np.clip(z / r, -1.0, 1.0))
        ph = np.arctan2(y, x)
        return u, th, ph

    def accel_phi(self, xyz):
        """Return (accel (N,3), Phi (N,))."""
        u, th, ph = self._sph(xyz)
        vals = self.g.eval(u, th)                            # (K, N)
        if self.moments is None:
            Phi = vals[self.g.index["Phi"]]
            ar = vals[self.g.index["ar"]]
            ath = vals[self.g.index["ath"]]
            aph = np.zeros_like(ar)
        else:
            Phi = np.zeros(len(u))
            ar = np.zeros(len(u))
            ath = np.zeros(len(u))
            aph = np.zeros(len(u))
            for m in self.moments:
                cm, sm = np.cos(m * ph), np.sin(m * ph)
                for qname, target in (("Phi", Phi), ("ar", ar),
                                      ("ath", ath), ("aphi", aph)):
                    kc = self.g.index.get(f"{qname}_C{m}")
                    ks = self.g.index.get(f"{qname}_S{m}")
                    if kc is not None:
                        target += cm * vals[kc]
                    if ks is not None:
                        target += sm * vals[ks]
        st, ct = np.sin(th), np.cos(th)
        sp, cp = np.sin(ph), np.cos(ph)
        ax = ar * st * cp + ath * ct * cp - aph * sp
        ay = ar * st * sp + ath * ct * sp + aph * cp
        az = ar * ct - ath * st
        return np.column_stack([ax, ay, az]), Phi


def pole_parity(qname: str, m: int) -> float:
    base = -1.0 if qname in ("ath", "aphi") else 1.0
    return base * ((-1.0) ** m)


# ---------------------------------------------------------------------------
# validation
# ---------------------------------------------------------------------------

def validate_forces(pot, model: GridModel, n=4000, seed=42):
    rng = np.random.default_rng(seed)
    u = rng.uniform(-3.5, 1.6, n)
    th = np.arccos(rng.uniform(-1, 1, n))
    ph = rng.uniform(0, 2 * np.pi, n)
    pts = sph_to_cart(10.0 ** u, th, ph)
    a_true = pot.force(pts)
    phi_true = pot.potential(pts)
    a_grid, phi_grid = model.accel_phi(pts)
    rel = np.linalg.norm(a_grid - a_true, axis=1) / np.linalg.norm(a_true, axis=1)
    prel = np.abs(phi_grid - phi_true) / np.abs(phi_true)
    stats = {
        "n_points": n,
        "force_rel_p50": float(np.percentile(rel, 50)),
        "force_rel_p95": float(np.percentile(rel, 95)),
        "force_rel_p99": float(np.percentile(rel, 99)),
        "force_rel_max": float(rel.max()),
        "phi_rel_p99": float(np.percentile(prel, 99)),
    }
    log(f"  force check: p50={stats['force_rel_p50']:.2e} p95={stats['force_rel_p95']:.2e} "
        f"p99={stats['force_rel_p99']:.2e} max={stats['force_rel_max']:.2e} "
        f"| Phi p99={stats['phi_rel_p99']:.2e}")
    return stats


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


def summarize(xyz):
    R = np.hypot(xyz[:, 0], xyz[:, 1])
    rp, ra = pmin(R), float(R.max())
    return {
        "R_peri": rp,
        "R_apo": ra,
        "z_max": float(np.abs(xyz[:, 2]).max()),
        "ecc": (ra - rp) / (ra + rp),
    }


def integrate_grid(model: GridModel, ic_row, omega=0.0, t_gyr=4.0, nsample=40001):
    from scipy.integrate import solve_ivp

    tmax = t_gyr / GYR_PER_TIMEUNIT
    om2 = omega * omega

    # Rotating-frame state: position in rotating axes, velocity u = dx_rot/dt.
    # Catalogue ICs carry INERTIAL velocities (agama.orbit(Omega=...) likewise
    # takes/returns velocities as inertial vectors projected on rotating axes,
    # which is what makes the release's E_J = E - Omega*Lz conserved), so
    # convert on the way in: u = v - Omega x r.
    ic_row = np.asarray(ic_row, dtype=float).copy()
    if omega != 0.0:
        ic_row[3] += omega * ic_row[1]  # ux = vx + Omega*y
        ic_row[4] -= omega * ic_row[0]  # uy = vy - Omega*x

    def rhs(t, w):
        a, _ = model.accel_phi(w[None, :3])
        ax, ay, az = a[0]
        if omega != 0.0:
            ax += 2.0 * omega * w[4] + om2 * w[0]
            ay += -2.0 * omega * w[3] + om2 * w[1]
        return (w[3], w[4], w[5], ax, ay, az)

    sol = solve_ivp(rhs, (0.0, tmax), ic_row, method="DOP853",
                    rtol=1e-8, atol=1e-11,
                    t_eval=np.linspace(0, tmax, nsample))
    return sol.y[:3].T


def catalogue_test_stars(n_stars, seed=7):
    df = pd.read_csv(ORBITS_CSV)
    rng = np.random.default_rng(seed)
    idx = rng.choice(len(df), size=n_stars, replace=False)
    sub = df.iloc[idx]
    ic = sub[["x_kpc", "y_kpc", "z_kpc", "vx_kms", "vy_kms", "vz_kms"]].to_numpy()
    return sub, ic


def compare_orbit_sets(got, ref, label):
    got = pd.DataFrame(got)
    ref = pd.DataFrame(ref)
    stats = {"n_stars": len(got)}
    for col, scale, unit in (("R_peri", 1000, "pc"), ("R_apo", 1000, "pc"),
                             ("z_max", 1000, "pc"), ("ecc", 1, "")):
        d = np.abs(got[col].to_numpy() - ref[col].to_numpy()) * scale
        stats[f"{col}_absdiff_{unit or 'abs'}_p50"] = float(np.percentile(d, 50))
        stats[f"{col}_absdiff_{unit or 'abs'}_max"] = float(d.max())
    log(f"  orbit check [{label}]: "
        f"dR_peri p50={stats['R_peri_absdiff_pc_p50']:.2f}/max={stats['R_peri_absdiff_pc_max']:.2f} pc, "
        f"dR_apo p50={stats['R_apo_absdiff_pc_p50']:.2f} pc, "
        f"decc p50={stats['ecc_absdiff_abs_p50']:.2e}")
    return stats


def rotz(pts, angle):
    c, s = np.cos(angle), np.sin(angle)
    out = pts.copy()
    out[..., 0] = c * pts[..., 0] - s * pts[..., 1]
    out[..., 1] = s * pts[..., 0] + c * pts[..., 1]
    return out


def find_bar_rotation_sign(pot_native, pot_rotated):
    """Determine s such that pot_rotated(x) == pot_native(rotz(x, s*BAR_ANGLE_RAD))."""
    rng = np.random.default_rng(3)
    pts = sph_to_cart(10 ** rng.uniform(-1, 1, 64),
                      np.arccos(rng.uniform(-1, 1, 64)),
                      rng.uniform(0, 2 * np.pi, 64))
    target = pot_rotated.potential(pts)
    for s in (+1.0, -1.0):
        trial = pot_native.potential(rotz(pts, s * BAR_ANGLE_RAD))
        if np.allclose(trial, target, rtol=1e-8, atol=1e-3):
            return s
    raise RuntimeError("could not establish bar rotation sign convention")


# ---------------------------------------------------------------------------
# model builders
# ---------------------------------------------------------------------------

def rotation_curve(pot, phi_fixed=0.0):
    R = np.logspace(-3, 2, 240)
    pts = np.column_stack([R * np.cos(phi_fixed), R * np.sin(phi_fixed),
                           np.zeros_like(R)])
    acc = pot.force(pts)
    aR = acc[:, 0] * np.cos(phi_fixed) + acc[:, 1] * np.sin(phi_fixed)
    vc = np.sqrt(np.clip(-R * aR, 0, None))
    return R, vc


def grid_meta(name, kind, arrays, parities, extra):
    return {
        "name": name,
        "kind": kind,
        "release": RELEASE_TAG,
        "grid": {"nu": NU, "nth": NTH, "u0": U0, "u1": U1, "thetaMax": np.pi,
                 "thetaMap": {"type": "s_plus_lambda_sin_2s", "lambda": LAM,
                              "note": "grid uniform in s; theta = s + lambda*sin(2s)"}},
        "arrays": arrays,
        "poleParity": parities,
        "units": {"length": "kpc", "velocity": "km/s", "phi": "(km/s)^2",
                  "accel": "(km/s)^2/kpc"},
        "timeUnitGyr": GYR_PER_TIMEUNIT,
        **extra,
    }


def write_axi_model(name, pot, meta_extra, outdir, n_orbit_check=10):
    log(f"[{name}] sampling {NU}x{NTH} grid ...")
    f = sample_field(pot, np.array([0.0]))
    probe = sample_field(pot, np.array([1.234]))
    assert np.allclose(probe["Phi"], f["Phi"], rtol=1e-10, atol=1e-6), \
        f"{name} is not axisymmetric"
    names = ["Phi", "ar", "ath"]
    arrays = [f[k][:, :, 0] for k in names]
    parities = [pole_parity(k, 0) for k in names]
    model = GridModel(StackedGrid(names, arrays, parities))

    fstats = validate_forces(pot, model)

    sub, ic = catalogue_test_stars(n_orbit_check)
    log(f"[{name}] integrating {len(ic)} validation orbits on the grid ...")
    got = [summarize(integrate_grid(model, row)) for row in ic]
    # direct agama for the same ICs (ground truth independent of the catalogue)
    res = agama.orbit(potential=pot, ic=ic, time=4.0 / GYR_PER_TIMEUNIT,
                      trajsize=40001)
    ref_agama = [summarize(np.asarray(res[i, 1])[:, :3]) for i in range(len(ic))]
    ostats = {"vs_agama": compare_orbit_sets(got, ref_agama, f"{name} vs agama")}
    if meta_extra.get("paperRole") == "default":
        ref_cat = [{"R_peri": r, "R_apo": a, "z_max": z, "ecc": e}
                   for r, a, z, e in sub[["static_R_peri_kpc", "static_R_apo_kpc",
                                          "static_z_max_kpc", "static_ecc"]].to_numpy()]
        ostats["vs_catalogue"] = compare_orbit_sets(got, ref_cat,
                                                    f"{name} vs published static_*")

    buf = b"".join(a.astype("<f4").tobytes() for a in arrays)
    (outdir / f"{name}.f32").write_bytes(buf)
    R, vc = rotation_curve(pot)
    meta = grid_meta(name, "axisymmetric", names, parities, {
        "rotationCurve": {"R_kpc": np.round(R, 6).tolist(),
                          "vc_kms": np.round(vc, 4).tolist()},
        "validation": {"forces": fstats, "orbits": ostats},
        **meta_extra,
    })
    write_json(outdir / f"{name}.meta.json", meta)
    log(f"[{name}] wrote {len(buf)/1024:.0f} kB grid")


def write_fourier_model(name, ini_path, meta_extra, outdir,
                        n_orbit_check=6, check_vs_catalogue=False):
    pot_native = agama.Potential(file=str(ini_path))
    pot_rotated = agama.Potential(potential=pot_native, rotation=BAR_ANGLE_RAD)
    rot_sign = find_bar_rotation_sign(pot_native, pot_rotated)
    log(f"[{name}] rotation convention: pot_rotated(x) = pot_native(rotz(x, {rot_sign:+.0f}*barAngle))")

    log(f"[{name}] sampling {NU}x{NTH}x{NPHI} grid (bar frame) ...")
    phis = np.arange(NPHI) * (2 * np.pi / NPHI)
    f = sample_field(pot_native, phis)

    F = np.fft.rfft(np.stack([f[q] for q in ("Phi", "ar", "ath", "aphi")]), axis=-1) / NPHI
    names, arrays, parities = [], [], []
    kept_m = set()
    qnames = ("Phi", "ar", "ath", "aphi")
    # Pruning must be RADIUS-LOCAL: amplitudes span many decades in radius
    # (the NSC makes the central radial force enormous), so a global-max
    # reference would either keep noise or, worse, prune the bar moments that
    # dominate at 1-4 kpc. Compare each moment's per-radius amplitude against
    # the local scale: |C0(Phi)|(u) for Phi, max_theta|C0(ar)|(u) for forces.
    scale_phi = np.abs(F[0, :, :, 0].real).max(axis=1) + 1e-30   # (NU,)
    scale_force = np.abs(F[1, :, :, 0].real).max(axis=1) + 1e-30
    for i, q in enumerate(qnames):
        scale = scale_phi if q == "Phi" else scale_force
        for m in range(0, MMAX + 1):
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
    log(f"[{name}] retained m={kept_m}, {len(names)} arrays "
        f"({sum(a.nbytes for a in arrays)/2/1024/1024:.1f} MB as f32)")

    model = GridModel(StackedGrid(names, arrays, parities), moments=kept_m)
    fstats = validate_forces(pot_native, model)

    omega = -float(BAR_PATTERN_SPEEDS["default"])
    sub, ic_gal = catalogue_test_stars(n_orbit_check)
    # transform galactocentric ICs into the bar frame: x_bar = rotz(x_gal, s*barAngle)
    ic_bar = ic_gal.copy()
    ic_bar[:, :3] = rotz(ic_gal[:, :3], rot_sign * BAR_ANGLE_RAD)
    ic_bar[:, 3:] = rotz(ic_gal[:, 3:], rot_sign * BAR_ANGLE_RAD)
    log(f"[{name}] integrating {len(ic_bar)} validation orbits (Omega={omega}) ...")
    got = [summarize(integrate_grid(model, row, omega=omega)) for row in ic_bar]
    res = agama.orbit(potential=pot_rotated, ic=ic_gal,
                      time=4.0 / GYR_PER_TIMEUNIT, trajsize=40001, Omega=omega)
    ref_agama = [summarize(np.asarray(res[i, 1])[:, :3]) for i in range(len(ic_gal))]
    ostats = {"vs_agama": compare_orbit_sets(got, ref_agama, f"{name} vs agama")}
    if check_vs_catalogue:
        ref_cat = [{"R_peri": r, "R_apo": a, "z_max": z, "ecc": e}
                   for r, a, z, e in sub[["barred_R_peri_kpc", "barred_R_apo_kpc",
                                          "barred_z_max_kpc", "barred_ecc"]].to_numpy()]
        ostats["vs_catalogue"] = compare_orbit_sets(got, ref_cat,
                                                    f"{name} vs published barred_*")

    buf = b"".join(a.astype("<f4").tobytes() for a in arrays)
    (outdir / f"{name}.f32").write_bytes(buf)
    R, vc = rotation_curve(pot_native, phi_fixed=np.pi / 4)
    meta = grid_meta(name, "fourier3d", names, parities, {
        "moments": kept_m,
        "rotatingFrame": True,
        "barAngleRad": BAR_ANGLE_RAD,
        "barRotationSign": rot_sign,
        "frameNote": ("grid is in the bar frame; galactocentric->bar frame is "
                      "x_bar = rotz(x_gal, barRotationSign*barAngleRad); orbits are "
                      "integrated in the corotating frame (Omega, negative=CW) and "
                      "match the release convention agama.orbit(Omega=...)"),
        "patternSpeeds": BAR_PATTERN_SPEEDS,
        "rotationCurve": {"R_kpc": np.round(R, 6).tolist(),
                          "vc_kms": np.round(vc, 4).tolist(),
                          "note": "sampled at phi=45deg in the bar frame"},
        "validation": {"forces": fstats, "orbits": ostats},
        **meta_extra,
    })
    write_json(outdir / f"{name}.meta.json", meta)
    log(f"[{name}] wrote {len(buf)/1024/1024:.1f} MB grid")


def main():
    outdir = ensure_outdir("potentials")
    only = sys.argv[1] if len(sys.argv) > 1 else None

    if only in (None, "hunter24_axi"):
        pot = agama.Potential(file=str(POTENTIALS / "MWPotentialHunter24_axi.ini"))
        write_axi_model("hunter24_axi", pot, {
            "label": "Hunter+2024 axisymmetrised (adopted static model)",
            "paperRole": "default",
            "source": "potentials/MWPotentialHunter24_axi.ini",
        }, outdir)

    if only in (None, "mcmillan17"):
        mcm_ini = Path(agama.__file__).parent / "data" / "McMillan17.ini"
        pot = agama.Potential(file=str(mcm_ini))
        write_axi_model("mcmillan17", pot, {
            "label": "McMillan (2017) axisymmetric comparison model",
            "paperRole": "comparison",
            "source": "agama bundled McMillan17.ini (phase14ah)",
        }, outdir)

    if only in (None, "hunter24_bar"):
        write_fourier_model("hunter24_bar",
                            POTENTIALS / "MWPotentialHunter24_full.ini", {
            "label": "Hunter+2024 full barred model (sensitivity variant)",
            "paperRole": "barred",
            "source": "potentials/MWPotentialHunter24_full.ini",
        }, outdir, check_vs_catalogue=True)

    if only in (None, "portail17"):
        write_fourier_model("portail17", POTENTIALS / "Portail17_wp6.ini", {
            "label": "Portail+2017 M2M barred model (independent bar)",
            "paperRole": "barred_independent",
            "source": "potentials/Portail17_wp6.ini",
        }, outdir, check_vs_catalogue=False)

    write_json(outdir / "index.json", {
        "release": RELEASE_TAG,
        "models": ["hunter24_axi", "mcmillan17", "hunter24_bar", "portail17"],
    })


if __name__ == "__main__":
    main()
