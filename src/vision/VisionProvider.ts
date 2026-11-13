import type { CellProvenance, ChartType } from "../model/types";
import type { ParsedSeries, ParsedTable } from "../ingest/parseTable";
import type { SampledColor } from "../ingest/image/sampleColors";
import { valuesFromPixels } from "./pixelMath";
import type { AxisCalibration } from "./pixelMath";

/**
 * Anything that can read a chart image (a hosted vision model today, an on-device model tomorrow).
 * The app only ever talks to this interface (CLAUDE.md rule 6). Output is untrusted: it is validated by
 * `validateExtraction` and every value lands in the document tagged as unverified.
 */
export interface VisionProvider {
  readonly name: string;
  extractChart(image: Blob, hints: { width: number; height: number; colors: string[] }): Promise<unknown>;
}

export type ValueSource = "printed" | "estimated";

export interface ExtractedSeries {
  name: string;
  values: (number | null)[];
  /** "printed": read from a label on the chart. "estimated": the model guessed, or computed from pixels. */
  valueSource: ValueSource;
  /** 0..1 */
  confidence: number;
  colorHint?: string;
  /** y pixel of each bar top / point, in the coordinate frame of the image that was sent. Enables pixel math. */
  topsPx?: (number | null)[];
}

export interface ExtractedChart {
  chartType: ChartType;
  title: string;
  subtitle: string;
  labels: string[];
  series: ExtractedSeries[];
  units: { prefix: string; suffix: string };
  axis?: AxisCalibration;
}

const CHART_TYPES: readonly ChartType[] = ["bar", "horizontal-bar", "stacked-bar", "line", "area", "pie", "donut"];
const LOW_CONFIDENCE = 0.6;

const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Hand-written schema check for the model's JSON. Never throws; problems become warnings. */
export function validateExtraction(raw: unknown): { chart: ExtractedChart | null; warnings: string[] } {
  const warnings: string[] = [];
  if (!raw || typeof raw !== "object") return { chart: null, warnings: ["The model's answer wasn't a JSON object."] };
  const r = raw as Record<string, unknown>;

  const labels = Array.isArray(r.labels) ? r.labels.map((l) => str(l, 80)) : [];
  if (labels.length === 0) return { chart: null, warnings: ["No category labels were found in the image."] };

  const type = CHART_TYPES.find((t) => t === r.chartType);
  if (!type) warnings.push("Chart type wasn't recognised; defaulted to Bar.");

  const series: ExtractedSeries[] = [];
  for (const [si, s] of (Array.isArray(r.series) ? r.series : []).entries()) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const fit = <T,>(arr: unknown, f: (x: unknown) => T | null): (T | null)[] => {
      const a = Array.isArray(arr) ? arr.map(f) : [];
      return Array.from({ length: labels.length }, (_, i) => a[i] ?? null);
    };
    const given = Array.isArray(o.values) ? o.values.length : 0;
    if (given !== labels.length) warnings.push(`"${str(o.name) || `Series ${si + 1}`}" had ${given} values for ${labels.length} labels; padded or trimmed.`);
    series.push({
      name: str(o.name, 60) || `Series ${si + 1}`,
      values: fit(o.values, num),
      valueSource: o.valueSource === "printed" ? "printed" : "estimated",
      confidence: Math.min(1, Math.max(0, num(o.confidence) ?? 0.5)),
      colorHint: /^#[0-9a-f]{6}$/i.test(str(o.color)) ? str(o.color).toUpperCase() : undefined,
      topsPx: Array.isArray(o.topsPx) ? fit(o.topsPx, num) : undefined,
    });
  }
  if (series.length === 0) return { chart: null, warnings: [...warnings, "No data series were found in the image."] };

  const a = r.axis && typeof r.axis === "object" ? (r.axis as Record<string, unknown>) : null;
  const axis: AxisCalibration | undefined =
    a && num(a.baselinePx) !== null && num(a.topTickPx) !== null && num(a.topTickValue) !== null
      ? { baselinePx: num(a.baselinePx)!, baselineValue: num(a.baselineValue) ?? 0, topTickPx: num(a.topTickPx)!, topTickValue: num(a.topTickValue)! }
      : undefined;

  const u = r.units && typeof r.units === "object" ? (r.units as Record<string, unknown>) : {};
  return {
    chart: {
      chartType: type ?? "bar",
      title: str(r.title),
      subtitle: str(r.subtitle),
      labels,
      series,
      units: { prefix: str(u.prefix, 3), suffix: str(u.suffix, 3) },
      axis,
    },
    warnings,
  };
}

function nearestColor(hex: string, palette: string[]): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = rgb(hex) as [number, number, number];
  let best = hex;
  let bestD = Infinity;
  for (const p of palette) {
    const [pr, pg, pb] = rgb(p) as [number, number, number];
    const d = Math.hypot(pr - r, pg - g, pb - b);
    if (d < bestD) ((bestD = d), (best = p));
  }
  return best;
}

/**
 * Turn a validated extraction into a ParsedTable ready for the shared import preview.
 * Per-cell provenance: printed -> OCR_EXACT; pixel math from calibrated bar tops -> AXIS_MEASURED;
 * a guess, or confidence below 0.6 -> LOW_CONFIDENCE. Series colours snap to colours actually sampled from the image.
 */
export function extractionToTable(chart: ExtractedChart, sampled: SampledColor[]): ParsedTable {
  const warnings: string[] = [];
  const palette = sampled.map((c) => c.hex);
  const series: ParsedSeries[] = chart.series.map((s, i) => {
    let values = s.values;
    let source: "printed" | "pixel" | "guess" = s.valueSource === "printed" ? "printed" : "guess";
    if (s.valueSource !== "printed" && chart.axis && s.topsPx) {
      const measured = valuesFromPixels(chart.axis, s.topsPx);
      if (measured) {
        // Prefer pixel math over the model's guess wherever both exist.
        values = measured.map((m, k) => m ?? s.values[k] ?? null);
        source = "pixel";
      }
    }
    const low = s.confidence < LOW_CONFIDENCE;
    const tag: CellProvenance = low || source === "guess" ? "LOW_CONFIDENCE" : source === "pixel" ? "AXIS_MEASURED" : "OCR_EXACT";
    const color = s.colorHint && palette.length ? nearestColor(s.colorHint, palette) : palette[i];
    return { name: s.name, values, included: true, color, provenance: values.map((v) => (v === null ? "MISSING" : tag)) };
  });
  if (series.some((s) => s.provenance?.includes("LOW_CONFIDENCE"))) warnings.push("Some values are guesses or low-confidence. Compare them with the screenshot before relying on them.");
  return {
    labels: chart.labels,
    series,
    units: chart.units,
    chart: chart.chartType,
    warnings,
  };
}
