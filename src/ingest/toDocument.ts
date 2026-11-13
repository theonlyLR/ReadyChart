import type { CellProvenance, ChartDocument, ChartType, DataSeries } from "../model/types";
import { SERIES_PALETTE } from "../model/defaults";
import type { ParsedTable } from "./parseTable";

export type ImportMode = "replace" | "append";

export interface ApplyOptions {
  mode: ImportMode;
  chart: ChartType;
  /** Provenance for every non-empty imported cell. */
  provenance: Exclude<CellProvenance, "USER_INPUT" | "MISSING">;
}

/** Pie/donut render only positive values, so never apply them to data with negatives. */
export function chartForData(chart: ChartType, table: ParsedTable): ChartType {
  const negative = table.series.some((s) => s.included && s.values.some((v) => v !== null && v < 0));
  return negative && (chart === "pie" || chart === "donut") ? "horizontal-bar" : chart;
}

function nextSeriesId(series: DataSeries[]): string {
  const used = series.map((s) => Number(/^s(\d+)$/.exec(s.id)?.[1] ?? 0));
  return `s${Math.max(0, ...used) + 1}`;
}

/**
 * Build the next ChartDocument from a parsed table. Pure: returns a new document and leaves brand, canvas and
 * motion untouched. Imported cells are tagged with `provenance` so the Data Table tints them until verified.
 */
export function applyParsedTable(doc: ChartDocument, table: ParsedTable, opts: ApplyOptions): ChartDocument {
  const next = structuredClone(doc) as ChartDocument;
  const incoming = table.series.filter((s) => s.included);
  if (incoming.length === 0) return next;
  const tag = (v: number | null): CellProvenance => (v === null ? "MISSING" : opts.provenance);
  const tagsFor = (s: (typeof incoming)[number], values: (number | null)[]): CellProvenance[] =>
    values.map((v, i) => (v === null ? "MISSING" : (s.provenance?.[i] ?? tag(v))));

  if (opts.mode === "append" && next.data.labels.length > 0) {
    const n = next.data.labels.length;
    for (const s of incoming) {
      const values = Array.from({ length: n }, (_, i) => s.values[i] ?? null);
      next.data.series.push({
        id: nextSeriesId(next.data.series),
        name: s.name,
        color: s.color ?? SERIES_PALETTE[next.data.series.length % SERIES_PALETTE.length]!,
        values,
        provenance: tagsFor(s, values),
      });
    }
    return next;
  }

  next.data.labels = [...table.labels];
  next.data.unitPrefix = table.units.prefix;
  next.data.unitSuffix = table.units.suffix;
  next.data.compactNotation = false;
  next.data.series = incoming.map((s, i) => ({
    id: `s${i + 1}`,
    name: s.name,
    color: s.color ?? SERIES_PALETTE[i % SERIES_PALETTE.length]!,
    values: [...s.values],
    provenance: tagsFor(s, s.values),
  }));
  next.geometry.type = chartForData(opts.chart, table);
  return next;
}
