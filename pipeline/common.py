"""Shared paths, constants and helpers for the GAIAWeb data pipeline.

Every script in this folder runs under WSL (where AGAMA is installed) and
reads exclusively from the frozen v1.0.8-review release bundle, so all web
data products are traceable to the published catalogue.

Units follow the release pipeline: length = 1 kpc, velocity = 1 km/s,
time unit = kpc/(km/s) = 0.9778 Gyr (agama.setUnits(length=1, mass=1,
velocity=1)).
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import yaml

# --- locations ------------------------------------------------------------
PIPELINE_DIR = Path(__file__).resolve().parent
REPO = PIPELINE_DIR.parent
WEB_DATA = REPO / "web" / "public" / "data"

BUNDLE = Path("/mnt/c/Users/humbl/GAIA2026/release/gaia_slow_vgrf_catalogue_v1.0.8_review")
if not BUNDLE.exists():  # allow running from Windows python for dry checks
    BUNDLE = Path(r"C:\Users\humbl\GAIA2026\release\gaia_slow_vgrf_catalogue_v1.0.8_review")

POTENTIALS = BUNDLE / "potentials"
CATALOGUES = BUNDLE / "catalogues"
PHASE14 = BUNDLE / "phase14"

CONFIG = yaml.safe_load((BUNDLE / "config.yml").read_text())

# --- physical conventions (must match phase0g_expanded_orbits.py) ----------
SOLAR = CONFIG["solar_variants"]  # default / grav22 / lsr6 / rb20
DEFAULT_SOLAR = SOLAR["default"]
BAR_ANGLE_RAD = -0.44  # present-day bar angle used by the release pipeline
BAR_PATTERN_SPEEDS = CONFIG["bar_pattern_speeds_kms_kpc"]  # default 37.5 etc.
GYR_PER_TIMEUNIT = 0.9778
T_INTEGRATE_GYR = 4.0
VGRF_CUTOFF_KMS = float(CONFIG["vgrf_cutoff_kms"])
TIERS = CONFIG["tiers"]

RELEASE_TAG = CONFIG["release"]["tag"]


def ensure_outdir(*parts: str) -> Path:
    out = WEB_DATA.joinpath(*parts)
    out.mkdir(parents=True, exist_ok=True)
    return out


def write_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, separators=(",", ":"), allow_nan=False))
    print(f"wrote {path} ({path.stat().st_size/1024:.1f} kB)")


def nan_to_none(values):
    """JSON cannot carry NaN; encode missing values as null."""
    out = []
    for v in values:
        if v is None or (isinstance(v, float) and not np.isfinite(v)):
            out.append(None)
        else:
            out.append(v)
    return out
