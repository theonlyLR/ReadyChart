import type { ChartDocument } from "../model/types";
import { clamp } from "../model/validate";
import type { LayoutResult } from "./layout";
import type { Rect } from "./types";
import { valueScale } from "./scales";
import { pieGuard } from "./guards";
import { GROUP_GAP } from "./geometry/bar";

/** Which screen axis a drag moves along: "y" for vertical bars / lines, "x" for horizontal bars. */
export type SculptAxis = "x" | "y";

export interface Handle {
  key: string;
  seriesIndex: number;
  index: number;
  axis: SculptAxis;
  /** Handle centre in document pixels (sits on the bar end / line point). */
  x: number;
  y: number;
  value: number;
}

/** Charts whose pointer position maps cleanly onto a single value axis. Stacked bars and pie/donut stay table-edit. */
export function isSculptable(doc: ChartDocument): boolean {
  const t = doc.geometry.type;
  return (t === "bar" || t === "horizontal-bar" || t === "line" || t === "area") && !pieGuard(doc).blocked;
}

/**
 * Pure: one handle per non-empty cell, placed with the same scale and band maths as the bar/line geometry
 * (parity is pinned by tests). Empty cells get no handle: drag can't invent a value for missing data.
 */
export function computeHandles(doc: ChartDocument, L: LayoutResult): Handle[] {
  if (!isSculptable(doc)) return [];
  const { plot } = L;
  const g = doc.geometry;
  const n = doc.data.labels.length;
  const k = Math.max(1, doc.data.series.length);
  const out: Handle[] = [];

  if (g.type === "horizontal-bar") {
    const sx = valueScale(L.domain, [plot.x, plot.x + plot.width]);
    const step = plot.height / Math.max(1, n);
    const catGap = g.barGapRatio * step;
    const bandH = Math.max(1, step - catGap);
    const barH = bandH / (k + (k - 1) * GROUP_GAP);
    doc.data.series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        if (v === null) return;
        const yy = plot.y + i * step + catGap / 2 + si * (barH + barH * GROUP_GAP);
        out.push({ key: `${si}:${i}`, seriesIndex: si, index: i, axis: "x", x: clamp(sx(v), plot.x, plot.x + plot.width), y: yy + barH / 2, value: v });
      });
    });
    return out;
  }

  const sy = valueScale(L.domain, [plot.y + plot.height, plot.y]);
  const step = plot.width / Math.max(1, n);
  if (g.type === "bar") {
    const catGap = g.barGapRatio * step;
    const bandW = Math.max(1, step - catGap);
    const barW = bandW / (k + (k - 1) * GROUP_GAP);
    doc.data.series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        if (v === null) return;
        const x = plot.x + i * step + catGap / 2 + si * (barW + barW * GROUP_GAP);
        out.push({ key: `${si}:${i}`, seriesIndex: si, index: i, axis: "y", x: x + barW / 2, y: clamp(sy(v), plot.y, plot.y + plot.height), value: v });
      });
    });
    return out;
  }

  // line / area
  doc.data.series.forEach((s, si) => {
    s.values.forEach((v, i) => {
      if (v === null) return;
      out.push({ key: `${si}:${i}`, seriesIndex: si, index: i, axis: "y", x: plot.x + (i + 0.5) * step, y: clamp(sy(v), plot.y, plot.y + plot.height), value: v });
    });
  });
  return out;
}

/** Round to the value of ~one screen pixel (a power of ten), so drags land on tidy numbers instead of 42.31847. */
export function roundToPixelStep(v: number, perPixel: number): number {
  if (!(perPixel > 0) || !Number.isFinite(v)) return v;
  const exp = Math.floor(Math.log10(perPixel));
  const step = 10 ** exp;
  return Number((Math.round(v / step) * step).toFixed(Math.max(0, -exp)));
}

/**
 * Inverse of the geometry's value scale. `domain` is the axis the drag started with (frozen by the caller).
 * Past the plot edge the value keeps extrapolating linearly (up to one extra axis span), so a bar already at the
 * top of the axis can still be pulled taller; the axis rescales to fit when the drag ends.
 */
export function valueFromPointer(axis: SculptAxis, domain: [number, number], plot: Rect, px: number, py: number): number {
  const [lo, hi] = domain;
  const span = hi - lo;
  const range: [number, number] = axis === "y" ? [plot.y + plot.height, plot.y] : [plot.x, plot.x + plot.width];
  const raw = valueScale(domain, range).invert(axis === "y" ? py : px);
  const perPixel = span / Math.max(1, Math.abs(range[1] - range[0]));
  return roundToPixelStep(clamp(raw, lo - span, hi + span), perPixel);
}
