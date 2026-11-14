import type { ChartDocument, ChartType } from "./types";
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
const UNVERIFIED: ReadonlySet<string> = new Set(["PARSED", "OCR_EXACT", "AXIS_MEASURED", "LOW_CONFIDENCE", "ESTIMATED"]);

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
  // Per-item colours are keyed by row index: drop any stale key past the end, so the new row starts clean and
  // falls back to the series colour (bar) or the palette (slice) instead of inheriting a leftover override.
  for (const s of data.series) pruneOverrides(s, data.labels.length);
  data.labels.push(`Item ${data.labels.length + 1}`);
  for (const s of data.series) {
    s.values.push(null);
    s.provenance.push("MISSING");
  }
}

function pruneOverrides(s: Data["series"][number], keep: number): void {
  if (!s.pointColorOverrides) return;
  for (const k of Object.keys(s.pointColorOverrides)) if (Number(k) >= keep) delete s.pointColorOverrides[Number(k)];
  if (Object.keys(s.pointColorOverrides).length === 0) delete s.pointColorOverrides;
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
      if (Object.keys(next).length > 0) s.pointColorOverrides = next;
      else delete s.pointColorOverrides;
    }
  }
}

export function addSeries(data: Data): void {
  const n = data.labels.length;
  // A second series makes this a multi-series dataset: series colours identify the series, so per-item colours go.
  if (data.series.length >= 1) clearSliceColors(data);
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

/** Per-item colouring is on when a single-series chart has per-bar / per-slice colour overrides. */
export function itemColorsActive(data: Data): boolean {
  return data.series.length === 1 && Object.keys(data.series[0]?.pointColorOverrides ?? {}).length > 0;
}

/**
 * "Color each bar" toggle. On: give every bar its own colour, keeping any it already has (sampled or chosen) and seeding
 * the rest from the default palette (the first bar keeps the series colour). Off: back to one series colour.
 */
export function colorEachItem(data: Data, on: boolean): void {
  const s = data.series[0];
  if (!s || data.series.length !== 1) return;
  if (!on) return clearSliceColors(data);
  const colours: Record<number, string> = {};
  data.labels.forEach((_, i) => {
    colours[i] = s.pointColorOverrides?.[i] ?? (i === 0 ? s.color : SERIES_PALETTE[i % SERIES_PALETTE.length]!);
  });
  s.pointColorOverrides = colours;
}

const isRadial = (t: ChartType): boolean => t === "pie" || t === "donut";

/**
 * Change the chart type without losing per-item colours. Bar, horizontal bar and line/area read one colour per item
 * (override, else the series colour); pie and donut read override, else the palette. Crossing between those two
 * families would otherwise reset every item to the other family's default, so the colours the source showed are
 * frozen into the overrides first. Uniform bars (nothing to preserve) and pie -> bar without any chosen or sampled
 * colours keep the target's own defaults. Single-series charts only.
 */
export function setChartType(d: ChartDocument, type: ChartType): void {
  const from = d.geometry.type;
  const s = d.data.series[0];
  if (from !== type && s && d.data.series.length === 1 && isRadial(from) !== isRadial(type)) {
    const n = d.data.labels.length;
    if (isRadial(from)) {
      // Pie -> bar: only chosen or sampled slice colours are worth carrying; the rainbow default is not.
      if (s.pointColorOverrides) {
        const frozen: Record<number, string> = {};
        for (let i = 0; i < n; i++) frozen[i] = s.pointColorOverrides[i] ?? SERIES_PALETTE[i % SERIES_PALETTE.length]!;
        s.pointColorOverrides = frozen;
      }
    } else {
      const shown = Array.from({ length: n }, (_, i) => s.pointColorOverrides?.[i] ?? s.color);
      if (new Set(shown).size > 1) s.pointColorOverrides = Object.fromEntries(shown.map((c, i) => [i, c]));
    }
  }
  d.geometry.type = type;
}
