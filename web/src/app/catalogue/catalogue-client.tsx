"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ColumnFile, TIER_COLORS, loadMaster } from "@/lib/data/catalogue";

type SortKey =
  | "source_id"
  | "tier"
  | "P_vgrf_below_25"
  | "vgrf_default"
  | "dist_pc"
  | "phot_g_mean_mag"
  | "ruwe"
  | "feh_spec";

const TIER_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, X: 4 };

interface Filters {
  tiers: Set<string>;
  pMin: number;
  vgrfMax: number;
  rvsOk: boolean;
  ruweLt14: boolean;
  hasChem: boolean;
  search: string;
}

const DEFAULT_FILTERS: Filters = {
  tiers: new Set(["A", "B", "C"]),
  pMin: 0,
  vgrfMax: 1000,
  rvsOk: false,
  ruweLt14: false,
  hasChem: false,
  search: "",
};

export default function CatalogueClient() {
  const [data, setData] = useState<ColumnFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>("P_vgrf_below_25");
  const [sortDesc, setSortDesc] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadMaster().then(setData, (e) => setError(String(e)));
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const c = data.columns;
    const ids = c.source_id as string[];
    const tier = c.tier as string[];
    const P = c.P_vgrf_below_25 as (number | null)[];
    const vgrf = c.vgrf_default as (number | null)[];
    const rvsOk = c.rvs_quality_ok as (boolean | null)[];
    const ruwe = c.ruwe as (number | null)[];
    const feh = c.feh_spec as (number | null)[];
    const out: number[] = [];
    const f = filters;
    for (let i = 0; i < data.n; i++) {
      if (!f.tiers.has(tier[i])) continue;
      if (f.pMin > 0 && (P[i] ?? 0) < f.pMin) continue;
      if (f.vgrfMax < 1000 && (vgrf[i] ?? Infinity) > f.vgrfMax) continue;
      if (f.rvsOk && rvsOk[i] !== true) continue;
      if (f.ruweLt14 && !((ruwe[i] ?? Infinity) < 1.4)) continue;
      if (f.hasChem && feh[i] === null) continue;
      if (f.search && !ids[i].startsWith(f.search)) continue;
      out.push(i);
    }
    // sort
    const key = sortKey;
    const dir = sortDesc ? -1 : 1;
    const getNum = (col: string, i: number): number => {
      const v = data.columns[col]?.[i];
      return typeof v === "number" ? v : NaN;
    };
    out.sort((a, b) => {
      let va: number;
      let vb: number;
      if (key === "source_id") {
        return dir * ids[a].localeCompare(ids[b]);
      } else if (key === "tier") {
        va = TIER_ORDER[tier[a]] ?? 9;
        vb = TIER_ORDER[tier[b]] ?? 9;
        return dir * (va - vb);
      } else {
        va = getNum(key, a);
        vb = getNum(key, b);
      }
      const na = Number.isNaN(va);
      const nb = Number.isNaN(vb);
      if (na && nb) return 0;
      if (na) return 1;
      if (nb) return -1;
      return dir * (va - vb);
    });
    return out;
  }, [data, filters, sortKey, sortDesc]);

  const ROW_H = 28;
  const viewH = 560;
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 5);
  const visible = Math.ceil(viewH / ROW_H) + 10;
  const slice = rows.slice(first, first + visible);

  const header = (label: string, key: SortKey, cls = "") => (
    <th
      className={`px-2 py-1.5 text-left font-normal text-faint cursor-pointer hover:text-foreground select-none whitespace-nowrap ${cls}`}
      onClick={() => {
        if (sortKey === key) setSortDesc((d) => !d);
        else {
          setSortKey(key);
          setSortDesc(true);
        }
      }}
    >
      {label}
      {sortKey === key && <span className="text-accent"> {sortDesc ? "↓" : "↑"}</span>}
    </th>
  );

  const setF = (patch: Partial<Filters>) =>
    setFilters((old) => ({ ...old, ...patch }));

  if (error)
    return <div className="p-8 text-danger text-sm">failed to load: {error}</div>;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 w-full">
      <h1 className="text-xl font-semibold">Catalogue browser</h1>
      <p className="text-sm text-muted mt-1">
        The full propagated candidate pool ({data ? data.n.toLocaleString() : "…"}{" "}
        sources, release v1.0.8-review). Tier A+B (P &gt; 0.84) is the primary
        catalogue; Tier X sources fell below P = 0.5 and the point-estimate cut
        but are retained for completeness. Click a row for the full record.
      </p>

      {/* filters */}
      <div className="panel mt-4 p-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-muted mr-1">tier</span>
          {["A", "B", "C", "D", "X"].map((t) => (
            <button
              key={t}
              onClick={() => {
                const next = new Set(filters.tiers);
                if (next.has(t)) next.delete(t);
                else next.add(t);
                setF({ tiers: next });
              }}
              className={`w-6 h-6 rounded font-medium ${
                filters.tiers.has(t) ? "bg-surface-2" : "opacity-30 bg-surface-2"
              }`}
              style={{ color: TIER_COLORS[t] }}
            >
              {t}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5">
          <span className="text-muted">P ≥</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={filters.pMin}
            onChange={(e) => setF({ pMin: parseFloat(e.target.value) || 0 })}
            className="w-16 bg-surface-2 rounded px-1.5 py-1 num"
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted">
            V<sub>GRF</sub> ≤
          </span>
          <input
            type="number"
            min={0}
            step={5}
            value={filters.vgrfMax === 1000 ? "" : filters.vgrfMax}
            placeholder="any"
            onChange={(e) =>
              setF({ vgrfMax: e.target.value === "" ? 1000 : parseFloat(e.target.value) })
            }
            className="w-16 bg-surface-2 rounded px-1.5 py-1 num"
          />
          <span className="text-faint">km/s</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            className="accent-[var(--accent)]"
            checked={filters.rvsOk}
            onChange={(e) => setF({ rvsOk: e.target.checked })}
          />
          RVS ok
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            className="accent-[var(--accent)]"
            checked={filters.ruweLt14}
            onChange={(e) => setF({ ruweLt14: e.target.checked })}
          />
          RUWE &lt; 1.4
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            className="accent-[var(--accent)]"
            checked={filters.hasChem}
            onChange={(e) => setF({ hasChem: e.target.checked })}
          />
          has spectroscopic [Fe/H]
        </label>
        <input
          value={filters.search}
          onChange={(e) => setF({ search: e.target.value.trim() })}
          placeholder="source_id starts with…"
          className="bg-surface-2 rounded px-2 py-1 num w-48 placeholder:font-sans"
        />
        <span className="text-muted ml-auto num">
          {rows.length.toLocaleString()} match{rows.length === 1 ? "" : "es"}
        </span>
      </div>

      {/* table */}
      <div className="panel mt-3 overflow-hidden">
        <table className="w-full text-xs table-fixed">
          <colgroup>
            <col className="w-44" />
            <col className="w-12" />
            <col className="w-20" />
            <col className="w-20" />
            <col className="w-20" />
            <col className="w-16" />
            <col className="w-16" />
            <col className="w-20" />
            <col />
          </colgroup>
          <thead className="border-b border-borderc">
            <tr>
              {header("source_id", "source_id")}
              {header("tier", "tier")}
              {header("P(V<25)", "P_vgrf_below_25")}
              {header("V_GRF km/s", "vgrf_default")}
              {header("dist pc", "dist_pc")}
              {header("G", "phot_g_mean_mag")}
              {header("RUWE", "ruwe")}
              {header("[Fe/H]", "feh_spec")}
              <th className="px-2 py-1.5 text-left font-normal text-faint">
                chem. population
              </th>
            </tr>
          </thead>
        </table>
        <div
          ref={scrollRef}
          className="overflow-y-auto"
          style={{ height: viewH }}
          onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        >
          <div style={{ height: rows.length * ROW_H, position: "relative" }}>
            <table
              className="w-full text-xs table-fixed absolute"
              style={{ top: first * ROW_H }}
            >
              <colgroup>
                <col className="w-44" />
                <col className="w-12" />
                <col className="w-20" />
                <col className="w-20" />
                <col className="w-20" />
                <col className="w-16" />
                <col className="w-16" />
                <col className="w-20" />
                <col />
              </colgroup>
              <tbody>
                {data &&
                  slice.map((i) => {
                    const c = data.columns;
                    const num = (col: string, digits: number) => {
                      const v = c[col][i];
                      return typeof v === "number" ? v.toFixed(digits) : "—";
                    };
                    const tier = String(c.tier[i]);
                    return (
                      <tr
                        key={String(c.source_id[i])}
                        className="hover:bg-surface-2 border-b border-borderc/40"
                        style={{ height: ROW_H }}
                      >
                        <td className="px-2 num truncate">
                          <Link
                            className="text-accent hover:underline"
                            href={`/catalogue/${c.source_id[i]}`}
                          >
                            {String(c.source_id[i])}
                          </Link>
                        </td>
                        <td
                          className="px-2 font-medium"
                          style={{ color: TIER_COLORS[tier] }}
                        >
                          {tier}
                        </td>
                        <td className="px-2 num">{num("P_vgrf_below_25", 3)}</td>
                        <td className="px-2 num">{num("vgrf_default", 1)}</td>
                        <td className="px-2 num">{num("dist_pc", 0)}</td>
                        <td className="px-2 num">{num("phot_g_mean_mag", 2)}</td>
                        <td className="px-2 num">{num("ruwe", 2)}</td>
                        <td className="px-2 num">{num("feh_spec", 2)}</td>
                        <td className="px-2 text-muted truncate">
                          {String(c.chem_population[i] ?? "")}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {!data && (
        <div className="text-sm text-muted mt-4">loading catalogue…</div>
      )}
    </div>
  );
}
