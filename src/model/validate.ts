import type { ChartDocument } from "./types";

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function hasNegatives(doc: ChartDocument): boolean {
  return doc.data.series.some((s) => s.values.some((v) => v !== null && v < 0));
}

export function seriesLengthsMatch(doc: ChartDocument): boolean {
  const n = doc.data.labels.length;
  return doc.data.series.every((s) => s.values.length === n && s.provenance.length === n);
}
