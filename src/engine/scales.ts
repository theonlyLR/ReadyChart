import { scaleLinear } from "d3-scale";
import type { ChartDocument } from "../model/types";

/** Resolved value-axis domain. Bars/areas always include zero; explicit yMin/yMax win over auto. */
export function resolveDomain(doc: ChartDocument): [number, number] {
  const g = doc.geometry;
  const { series, labels } = doc.data;
  let lo = Infinity;
  let hi = -Infinity;

  if (g.type === "stacked-bar") {
    for (let i = 0; i < labels.length; i++) {
      let pos = 0;
      let neg = 0;
      for (const s of series) {
        const v = s.values[i];
        if (v == null) continue;
        if (v >= 0) pos += v;
        else neg += v;
      }
      lo = Math.min(lo, neg);
      hi = Math.max(hi, pos);
    }
  } else {
    for (const s of series) {
      for (const v of s.values) {
        if (v == null) continue;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
  }

  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0;
    hi = 1;
  }
  if (g.type !== "line") {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (hi <= lo) hi = lo + 1;

  let [nlo, nhi] = scaleLinear().domain([lo, hi]).nice(5).domain() as [number, number];
  if (g.yMin !== "auto") nlo = g.yMin;
  if (g.yMax !== "auto") nhi = g.yMax;
  if (nhi <= nlo) nhi = nlo + 1;
  return [nlo, nhi];
}

export function valueScale(domain: [number, number], range: [number, number]) {
  return scaleLinear().domain(domain).range(range);
}

export function resolveTicks(domain: [number, number], count = 5): number[] {
  return scaleLinear().domain(domain).ticks(count);
}
