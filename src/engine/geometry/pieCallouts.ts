import type { Rect } from "../types";

/** Slices below this share of the whole get an outside callout instead of a label inside the wedge. */
export const CALLOUT_SHARE = 0.08;

export interface SliceGeom {
  /** Radians, clockwise from 12 o'clock (d3 pie convention). */
  start: number;
  end: number;
  /** Share of the total, 0..1. */
  frac: number;
}

export interface Callout {
  index: number;
  side: 1 | -1;
  /** Point on the outer edge of the wedge, where the leader starts. */
  edge: [number, number];
  /** End of the radial tick / start of the horizontal shelf. */
  elbow: [number, number];
  /** End of the shelf; the label sits just past it. */
  shelfEnd: [number, number];
  textX: number;
  /** Text baseline. */
  textY: number;
  anchor: "start" | "end";
}

export interface CalloutPlan {
  /** Outer radius to draw with (inset from the requested radius when callouts are active). */
  r: number;
  callouts: Callout[];
}

/**
 * Spread label centres on one side of the pie so neighbours keep `gap` between them, within [lo, hi].
 * Input must be sorted ascending; order is preserved (so leaders never cross).
 */
export function spreadY(ys: number[], gap: number, lo: number, hi: number): number[] {
  const n = ys.length;
  if (n === 0) return [];
  const out = ys.map((y) => Math.min(hi, Math.max(lo, y)));
  for (let i = 1; i < n; i++) out[i] = Math.max(out[i]!, out[i - 1]! + gap);
  if (out[n - 1]! > hi) {
    out[n - 1] = hi;
    for (let i = n - 2; i >= 0; i--) out[i] = Math.min(out[i]!, out[i + 1]! - gap);
  }
  if (out[0]! < lo) {
    // Not enough room for the full gap: share what there is evenly.
    const step = n > 1 ? (hi - lo) / (n - 1) : 0;
    return out.map((_, i) => lo + i * step);
  }
  return out;
}

interface PlanInput {
  geom: SliceGeom[];
  cx: number;
  cy: number;
  /** Requested outer radius (no callouts). */
  r: number;
  /** donutInnerRatio for donuts, 0 for pies. */
  innerRatio: number;
  plot: Rect;
  fontSize: number;
  u: number;
  /** Rendered width of each slice's label. */
  textW: number[];
}

/**
 * Decide which slices get outside callouts and where they go. Pure and deterministic: positions come from the final
 * (fully open) angles only, so the live canvas, SVG and every animated frame agree.
 *
 * A slice gets a callout when its share is under CALLOUT_SHARE, when its arc is too narrow for the label, or when a
 * donut ring is too thin to hold text. Callouts need room, so the outer radius is inset until the longest label fits
 * inside the plot box; insetting narrows arcs, which can promote more slices, so this repeats until stable.
 */
export function planCallouts(o: PlanInput): CalloutPlan {
  const tick = 12 * o.u;
  const shelf = 14 * o.u;
  const pad = 6 * o.u;
  const gap = o.fontSize * 1.3;
  const needs = (i: number, r: number): boolean => {
    const g = o.geom[i]!;
    const inner = r * o.innerRatio;
    const labelR = (inner + r) / 2;
    return g.frac < CALLOUT_SHARE || (g.end - g.start) * labelR < o.textW[i]! + 8 * o.u || r - inner < o.fontSize * 1.4;
  };

  let r = o.r;
  let set: number[] = [];
  for (let pass = 0; pass < 6; pass++) {
    const next = o.geom.map((_, i) => i).filter((i) => needs(i, r));
    if (next.length === 0) return { r: o.r, callouts: [] };
    const maxW = Math.max(...next.map((i) => o.textW[i]!));
    const fit = Math.min(o.plot.width / 2 - tick - shelf - maxW - pad, o.plot.height / 2 - tick - o.fontSize * 0.7);
    const nr = Math.min(r, Math.max(o.r * 0.5, fit));
    const stable = next.length === set.length && nr === r;
    set = next;
    r = nr;
    if (stable) break;
  }

  const lo = o.plot.y + o.fontSize * 0.7;
  const hi = o.plot.y + o.plot.height - o.fontSize * 0.7;
  const bySide: Record<1 | -1, { i: number; mid: number; ey: number }[]> = { 1: [], [-1]: [] };
  for (const i of set) {
    const mid = (o.geom[i]!.start + o.geom[i]!.end) / 2;
    bySide[Math.sin(mid) >= 0 ? 1 : -1].push({ i, mid, ey: o.cy - Math.cos(mid) * (r + tick) });
  }

  const callouts: Callout[] = [];
  for (const side of [1, -1] as const) {
    const items = bySide[side].sort((a, b) => a.ey - b.ey);
    const ys = spreadY(items.map((s) => s.ey), gap, lo, hi);
    items.forEach((s, k) => {
      const y = ys[k]!;
      // The elbow lies on the circle of radius r + tick at the label's height, so the tick stays outside the pie
      // even after collision spacing moved the label (unmoved, it is exactly radial).
      const dy = Math.max(-(r + tick), Math.min(r + tick, y - o.cy));
      const elbowX = o.cx + side * Math.sqrt(Math.max(0, (r + tick) ** 2 - dy ** 2));
      const shelfX = elbowX + side * shelf;
      callouts.push({
        index: s.i,
        side,
        edge: [o.cx + Math.sin(s.mid) * r, o.cy - Math.cos(s.mid) * r],
        elbow: [elbowX, o.cy + dy],
        shelfEnd: [shelfX, o.cy + dy],
        textX: shelfX + side * 4 * o.u,
        textY: y + o.fontSize * 0.35,
        anchor: side === 1 ? "start" : "end",
      });
    });
  }
  return { r, callouts: callouts.sort((a, b) => a.index - b.index) };
}
