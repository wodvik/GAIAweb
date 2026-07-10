"use client";

/**
 * Lightweight canvas scatter plot with log/linear axes, hover tooltip and
 * click-through, for the ensemble figures. Data sizes here are small
 * (2k-21k points), so a full redraw per interaction is fine.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface ScatterPoint {
  x: number;
  y: number;
  color: string;
  id?: string; // click-through target (source_id)
  label?: string;
  size?: number;
}

export interface ScatterProps {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  xLog?: boolean;
  yLog?: boolean;
  xDomain?: [number, number];
  yDomain?: [number, number];
  height?: number;
  onClickPoint?: (id: string) => void;
  /** extra draw pass on top (axes in data coords) */
  annotate?: (
    ctx: CanvasRenderingContext2D,
    toPx: (x: number, y: number) => [number, number],
    size: { w: number; h: number },
  ) => void;
}

const MARGIN = { l: 54, r: 12, t: 10, b: 36 };

export default function Scatter({
  points,
  xLabel,
  yLabel,
  xLog,
  yLog,
  xDomain,
  yDomain,
  height = 420,
  onClickPoint,
  annotate,
}: ScatterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{
    px: number;
    py: number;
    p: ScatterPoint;
  } | null>(null);
  const [w, setW] = useState(640);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setW(el.clientWidth));
    obs.observe(el);
    setW(el.clientWidth);
    return () => obs.disconnect();
  }, []);

  const domain = useMemo(() => {
    const xs = points.map((p) => p.x).filter((v) => Number.isFinite(v) && (!xLog || v > 0));
    const ys = points.map((p) => p.y).filter((v) => Number.isFinite(v) && (!yLog || v > 0));
    const xd = xDomain ?? [Math.min(...xs), Math.max(...xs)];
    const yd = yDomain ?? [Math.min(...ys), Math.max(...ys)];
    return { xd, yd };
  }, [points, xDomain, yDomain, xLog, yLog]);

  const toPx = useCallback(
    (x: number, y: number): [number, number] => {
      const { xd, yd } = domain;
      const tx = xLog
        ? (Math.log10(x) - Math.log10(xd[0])) /
          (Math.log10(xd[1]) - Math.log10(xd[0]))
        : (x - xd[0]) / (xd[1] - xd[0]);
      const ty = yLog
        ? (Math.log10(y) - Math.log10(yd[0])) /
          (Math.log10(yd[1]) - Math.log10(yd[0]))
        : (y - yd[0]) / (yd[1] - yd[0]);
      return [
        MARGIN.l + tx * (w - MARGIN.l - MARGIN.r),
        height - MARGIN.b - ty * (height - MARGIN.t - MARGIN.b),
      ];
    },
    [domain, xLog, yLog, w, height],
  );

  // ticks
  const ticks = useCallback(
    (d: [number, number], log: boolean | undefined): number[] => {
      if (log) {
        const lo = Math.ceil(Math.log10(d[0]));
        const hi = Math.floor(Math.log10(d[1]));
        const out: number[] = [];
        for (let e = lo; e <= hi; e++) out.push(10 ** e);
        if (out.length < 2) {
          return [d[0], Math.sqrt(d[0] * d[1]), d[1]];
        }
        return out;
      }
      const span = d[1] - d[0];
      const step = 10 ** Math.floor(Math.log10(span / 4));
      const mult = span / step > 8 ? 2.5 : span / step > 4 ? 2 : 1;
      const s = step * mult;
      const out: number[] = [];
      for (let v = Math.ceil(d[0] / s) * s; v <= d[1] + 1e-9; v += s)
        out.push(v);
      return out;
    },
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);

    const style = getComputedStyle(document.documentElement);
    const faint = style.getPropertyValue("--faint").trim() || "#55637a";
    const border = style.getPropertyValue("--border").trim() || "#1c2739";

    // grid + ticks
    ctx.strokeStyle = border;
    ctx.fillStyle = faint;
    ctx.font = "10px var(--font-geist-mono), monospace";
    ctx.lineWidth = 1;
    for (const tx of ticks(domain.xd, xLog)) {
      const [px] = toPx(tx, domain.yd[0]);
      if (px < MARGIN.l - 1 || px > w - MARGIN.r + 1) continue;
      ctx.beginPath();
      ctx.moveTo(px, MARGIN.t);
      ctx.lineTo(px, height - MARGIN.b);
      ctx.globalAlpha = 0.35;
      ctx.stroke();
      ctx.globalAlpha = 1;
      const label = xLog
        ? tx >= 1
          ? tx.toFixed(0)
          : tx.toPrecision(1)
        : `${Number(tx.toPrecision(4))}`;
      ctx.textAlign = "center";
      ctx.fillText(label, px, height - MARGIN.b + 14);
    }
    for (const ty of ticks(domain.yd, yLog)) {
      const [, py] = toPx(domain.xd[0], ty);
      if (py < MARGIN.t - 1 || py > height - MARGIN.b + 1) continue;
      ctx.beginPath();
      ctx.moveTo(MARGIN.l, py);
      ctx.lineTo(w - MARGIN.r, py);
      ctx.globalAlpha = 0.35;
      ctx.stroke();
      ctx.globalAlpha = 1;
      const label = yLog
        ? ty >= 1
          ? ty.toFixed(0)
          : ty.toPrecision(1)
        : `${Number(ty.toPrecision(4))}`;
      ctx.textAlign = "right";
      ctx.fillText(label, MARGIN.l - 6, py + 3);
    }
    // axis labels
    ctx.textAlign = "center";
    ctx.fillText(xLabel, MARGIN.l + (w - MARGIN.l - MARGIN.r) / 2, height - 6);
    ctx.save();
    ctx.translate(12, MARGIN.t + (height - MARGIN.t - MARGIN.b) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();

    // points
    for (const p of points) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (xLog && p.x <= 0) continue;
      if (yLog && p.y <= 0) continue;
      const [px, py] = toPx(p.x, p.y);
      if (px < MARGIN.l || px > w - MARGIN.r || py < MARGIN.t || py > height - MARGIN.b)
        continue;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(px, py, p.size ?? 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (annotate) annotate(ctx, toPx, { w, h: height });
  }, [points, w, height, domain, toPx, ticks, xLog, yLog, xLabel, yLabel, annotate]);

  const findNearest = (evX: number, evY: number) => {
    let best: ScatterPoint | null = null;
    let bestD = 12 * 12;
    for (const p of points) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if ((xLog && p.x <= 0) || (yLog && p.y <= 0)) continue;
      const [px, py] = toPx(p.x, p.y);
      const d = (px - evX) ** 2 + (py - evY) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  };

  return (
    <div ref={wrapRef} className="relative w-full">
      <canvas
        ref={canvasRef}
        style={{ width: w, height }}
        className={onClickPoint ? "cursor-pointer" : ""}
        onMouseMove={(e) => {
          const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
          const p = findNearest(e.clientX - rect.left, e.clientY - rect.top);
          if (p) {
            const [px, py] = toPx(p.x, p.y);
            setHover({ px, py, p });
          } else setHover(null);
        }}
        onMouseLeave={() => setHover(null)}
        onClick={() => {
          if (hover?.p.id && onClickPoint) onClickPoint(hover.p.id);
        }}
      />
      {hover && (
        <div
          className="absolute panel px-2 py-1 text-xs pointer-events-none z-10 whitespace-nowrap"
          style={{ left: hover.px + 10, top: hover.py - 10 }}
        >
          {hover.p.label ?? hover.p.id}
        </div>
      )}
    </div>
  );
}
