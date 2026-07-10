"""Export the catalogue as column-oriented JSON for the website.

Products (web/public/data/catalogue/):
  master.json   - browse columns for all 20,829 candidate-pool sources
  orbits.json   - full per-star record for the 1,952 Tier A+B+C stars:
                  orbit initial conditions, static/barred point-estimate
                  summaries, MC orbit posteriors (p16/p50/p84), actions +
                  reliability, chemistry, McMillan17 comparison columns
  summary.json  - headline counts for the UI (copied from release summaries)

source_id is emitted as a STRING: Gaia DR3 identifiers exceed 2^53 and must
never pass through a float (COLUMNS.md warning).

Run under WSL: python3 pipeline/export_catalogue.py
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
from astropy.table import Table

from common import (
    BUNDLE,
    CATALOGUES,
    PHASE14,
    RELEASE_TAG,
    ensure_outdir,
    nan_to_none,
    write_json,
)

MASTER_FITS = CATALOGUES / "catalogue_expanded_master.fits"
ORBITS_CSV = CATALOGUES / "catalogue_expanded_orbits_tierABC.csv"
MC_ORBITS_CSV = PHASE14 / "expanded_orbit_mc" / "expanded_catalogue_mc_orbits.csv"
MCMILLAN_CSV = PHASE14 / "expanded_mcmillan_per_star.csv"

MASTER_COLS_NUM = [
    "ra", "dec", "l", "b",
    "parallax", "parallax_error", "parallax_over_error", "parallax_zpcorr",
    "dist_pc", "dist_lo_pc", "dist_hi_pc",
    "pmra", "pmra_error", "pmdec", "pmdec_error",
    "radial_velocity", "radial_velocity_error",
    "phot_g_mean_mag", "bp_rp", "grvs_mag", "ruwe",
    "vgrf_default", "P_vgrf_below_25", "mc_realisations",
    "mh_gspphot", "feh_spec", "feh_spec_err", "alpha_spec",
]
MASTER_COLS_STR = ["tier", "rv_quality", "dist_source", "chem_survey",
                   "chem_population", "nss_solution_type"]
MASTER_COLS_BOOL = ["rvs_quality_ok", "nss_two_body", "zpcorr_valid",
                    "source_in_old_preselection"]


def col_to_list(values, kind):
    if kind == "num":
        arr = pd.to_numeric(pd.Series(values), errors="coerce").astype(float)
        return nan_to_none([round(v, 6) if v is not None and np.isfinite(v) else v
                            for v in arr])
    if kind == "bool":
        return [bool(v) if v == v and v is not None else None for v in values]
    out = []
    for v in values:
        if v is None or (isinstance(v, float) and np.isnan(v)):
            out.append("")
        else:
            s = str(v).strip()
            out.append("" if s.lower() in ("nan", "none", "<na>") else s)
    return out


def fits_to_df(path):
    t = Table.read(path)
    # decode bytes columns
    for c in t.colnames:
        if t[c].dtype.kind == "S":
            t[c] = np.char.decode(t[c].astype(bytes), "utf-8")
    return t.to_pandas()


def export_master(outdir):
    df = fits_to_df(MASTER_FITS)
    print(f"master: {len(df)} rows, {len(df.columns)} cols")
    assert df["source_id"].dtype.kind in "iu", "source_id must be integer"
    data = {"source_id": [str(s) for s in df["source_id"].tolist()]}
    for c in MASTER_COLS_NUM:
        data[c] = col_to_list(df[c], "num")
    for c in MASTER_COLS_STR:
        data[c] = col_to_list(df[c], "str")
    for c in MASTER_COLS_BOOL:
        data[c] = col_to_list(df[c], "bool")
    write_json(outdir / "master.json", {
        "release": RELEASE_TAG, "n": len(df), "columns": data,
    })


def export_orbits(outdir):
    df = pd.read_csv(ORBITS_CSV, dtype={"source_id": "int64"})
    mc = pd.read_csv(MC_ORBITS_CSV, dtype={"source_id": "int64"})
    print(f"orbits: {len(df)} rows; mc: {len(mc)} rows")
    mc_cols = [c for c in mc.columns
               if c.endswith(("_p16", "_p50", "_p84")) or c == "orbit_mc_realisations"]
    merged = df.merge(mc[["source_id"] + mc_cols], on="source_id", how="left")
    if MCMILLAN_CSV.exists():
        # phase14ah reads the orbits CSV top-to-bottom and appends results in
        # order, so this file is positionally aligned with `df` (verified in
        # the script source; it carries no source_id column).
        mcm = pd.read_csv(MCMILLAN_CSV)
        assert len(mcm) == len(df), "McMillan per-star CSV row count mismatch"
        keep = [c for c in mcm.columns if c != "variant"]
        for c in keep:
            merged[f"mcm_{c}"] = mcm[c].to_numpy()
        print(f"merged McMillan17 per-star columns (positional): {keep}")

    data = {"source_id": [str(s) for s in merged["source_id"].tolist()]}
    str_cols = {"tier", "rv_quality", "dist_source_final_screen", "chem_survey",
                "chem_population", "nss_solution_type", "action_reliability_flag"}
    bool_cols = {"rvs_quality_ok", "nss_two_body", "action_accuracy_sampled",
                 "source_in_old_preselection"}
    for c in merged.columns:
        if c == "source_id":
            continue
        if c in str_cols:
            data[c] = col_to_list(merged[c], "str")
        elif c in bool_cols:
            data[c] = col_to_list(merged[c], "bool")
        elif merged[c].dtype.kind in "ifu":
            vals = pd.to_numeric(merged[c], errors="coerce").astype(float)
            data[c] = nan_to_none([None if not np.isfinite(v) else float(f"{v:.8g}")
                                   for v in vals])
        else:
            data[c] = col_to_list(merged[c], "str")
    write_json(outdir / "orbits.json", {
        "release": RELEASE_TAG, "n": len(merged), "columns": data,
    })


def export_summary(outdir):
    cat_sum = json.loads((CATALOGUES / "expanded_catalogue_summary.json").read_text())
    orb_sum = json.loads((CATALOGUES / "expanded_orbit_summary.json").read_text())
    for k in ("input_csv", "master_fits", "tierA_fits", "tierAB_fits",
              "tierABC_fits", "output_fits", "output_csv"):
        cat_sum.pop(k, None)
        orb_sum.pop(k, None)
    write_json(outdir / "summary.json", {
        "release": RELEASE_TAG,
        "catalogue": cat_sum,
        "orbits": orb_sum,
    })


def main():
    outdir = ensure_outdir("catalogue")
    export_summary(outdir)
    export_orbits(outdir)
    export_master(outdir)


if __name__ == "__main__":
    main()
