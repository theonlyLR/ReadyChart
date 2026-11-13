import type { ChartDocument } from "./types";
import { SERIES_PALETTE } from "./defaults";

type Data = ChartDocument["data"];

/**
 * Parse a pasted/typed cell. Returns null for empty (missing), undefined for unparseable (caller should revert).
 * Handles currency symbols, %, thousands separators, decimal commas and (accounting) negatives.
 */
export function parseCellNumber(text: string): number | null | undefined {
  let t = text.trim();
  if (t === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  t = t.replace(/[\s$€£¥₦%]/g, "").replace(/^[−–]/, "-");
  if (t.startsWith("-")) {
    negative = !negative;
    t = t.slice(1);
  }
  const lastComma = t.lastIndexOf(",");
  const lastDot = t.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    t = lastComma > lastDot ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (lastComma >= 0) {
    t = /^\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  }
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return negative ? -n : n;
}

export function setLabel(data: Data, i: number, text: string): void {
  if (i >= 0 && i < data.labels.length) data.labels[i] = text;
}

export function setCell(data: Data, seriesIndex: number, i: number, value: number | null): void {
  const s = data.series[seriesIndex];
  if (!s || i < 0 || i >= data.labels.length) return;
  s.values[i] = value;
  s.provenance[i] = value === null ? "MISSING" : "USER_INPUT";
}

/** Provenance values that still need a human look. USER_INPUT (typed or confirmed) is verified; MISSING is just empty. */
const UNVERIFIED: ReadonlySet<string> = new Set(["PARSED", "OCR_EXACT", "AXIS_MEASURED", "LOW_CONFIDENCE"]);

export function isUnverified(p: string | undefined): boolean {
  return p !== undefined && UNVERIFIED.has(p);
}

/** Mark one cell as checked by the user. No-op for empty or already-verified cells. */
export function confirmCell(data: Data, seriesIndex: number, i: number): void {
  const s = data.series[seriesIndex];
  if (s && isUnverified(s.provenance[i])) s.provenance[i] = "USER_INPUT";
}

/** Confirm every unverified cell in one series, or in all series when seriesIndex is omitted. */
export function confirmAll(data: Data, seriesIndex?: number): void {
  data.series.forEach((s, si) => {
    if (seriesIndex !== undefined && si !== seriesIndex) return;
    for (let i = 0; i < s.provenance.length; i++) if (isUnverified(s.provenance[i])) s.provenance[i] = "USER_INPUT";
  });
}

export function unverifiedCount(data: Data, seriesIndex?: number): number {
  let n = 0;
  data.series.forEach((s, si) => {
    if (seriesIndex !== undefined && si !== seriesIndex) return;
    for (const p of s.provenance) if (isUnverified(p)) n++;
  });
  return n;
}

export function addRow(data: Data): void {
  data.labels.push(`Item ${data.labels.length + 1}`);
  for (const s of data.series) {
    s.values.push(null);
    s.provenance.push("MISSING");
  }
}

export function removeRow(data: Data, i: number): void {
  if (data.labels.length <= 1 || i < 0 || i >= data.labels.length) return;
  data.labels.splice(i, 1);
  for (const s of data.series) {
    s.values.splice(i, 1);
    s.provenance.splice(i, 1);
    if (s.pointColorOverrides) {
      const next: Record<number, string> = {};
      for (const [k, c] of Object.entries(s.pointColorOverrides)) {
        const idx = Number(k);
        if (idx < i) next[idx] = c;
        else if (idx > i) next[idx - 1] = c;
      }
      s.pointColorOverrides = next;
    }
  }
}

export function addSeries(data: Data): void {
  const n = data.labels.length;
  const used = data.series.map((s) => Number(/^s(\d+)$/.exec(s.id)?.[1] ?? 0));
  const id = `s${Math.max(0, ...used) + 1}`;
  data.series.push({
    id,
    name: `Series ${data.series.length + 1}`,
    color: SERIES_PALETTE[data.series.length % SERIES_PALETTE.length]!,
    values: Array<number | null>(n).fill(null),
    provenance: Array<"MISSING">(n).fill("MISSING"),
  });
}

export function removeSeries(data: Data, seriesIndex: number): void {
  if (data.series.length <= 1) return;
  data.series.splice(seriesIndex, 1);
}

/** Rename a series. Blank names fall back to "Series N" so legends never show an empty entry. */
export function setSeriesName(data: Data, seriesIndex: number, name: string): void {
  const s = data.series[seriesIndex];
  if (!s) return;
  s.name = name.trim() || `Series ${seriesIndex + 1}`;
}

/** Set (hex) or clear (null) one pie/donut slice color. Overrides live on series[0], keyed by label index. */
export function setSliceColor(data: Data, labelIndex: number, color: string | null): void {
  const s = data.series[0];
  if (!s || labelIndex < 0 || labelIndex >= data.labels.length) return;
  if (color === null) {
    if (s.pointColorOverrides) {
      delete s.pointColorOverrides[labelIndex];
      if (Object.keys(s.pointColorOverrides).length === 0) delete s.pointColorOverrides;
    }
    return;
  }
  (s.pointColorOverrides ??= {})[labelIndex] = color;
}

export function clearSliceColors(data: Data): void {
  const s = data.series[0];
  if (s) delete s.pointColorOverrides;
}
