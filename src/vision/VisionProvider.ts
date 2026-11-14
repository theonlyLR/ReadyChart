import type { CellProvenance, ChartType, DataLabelPosition, LegendPosition, TitleAlign } from "../model/types";
import { parseUnitCell } from "../ingest/parseTable";
import type { ParsedSeries, ParsedTable } from "../ingest/parseTable";
import type { SampledColor } from "../ingest/image/sampleColors";
import { valuesFromPixels } from "./pixelMath";
import type { AxisCalibration } from "./pixelMath";

/**
 * Anything that can read a chart image (a hosted vision model today, an on-device model tomorrow).
 * The app only ever talks to this interface (CLAUDE.md rule 6). Output is untrusted: it is validated by
 * `validateExtraction` and every value lands in the document tagged as unverified.
 */
export interface ExtractHints {
  width: number;
  height: number;
  colors: string[];
  /** Image 2: a sharpened 2x crop of the chart region. Only present for providers that set usesPlotImage. */
  plot?: { image: Blob; width: number; height: number };
}

export interface VisionProvider {
  readonly name: string;
  /** True when the provider can be shown the plot crop as a second image (and answers in its coordinate frame). */
  readonly usesPlotImage?: boolean;
  extractChart(image: Blob, hints: ExtractHints, signal?: AbortSignal): Promise<unknown>;
}

export type ValueSource = "printed" | "estimated";

/** Values below this confidence are tagged LOW_CONFIDENCE and highlighted on the canvas until the user checks them. */
export const CONFIDENCE_THRESHOLD = 0.85;

/** [ymin, xmin, ymax, xmax], each 0..1000 of the full image. */
export type NormBounds = [number, number, number, number];
/** [x, y], each 0..1000 of the full image. */
export type NormPoint = [number, number];

/** Placeholder for a sample point the model got wrong; keeps array indexes aligned. */
export const NO_POINT: NormPoint = [-1, -1];

export interface SamplePoints {
  background?: NormPoint;
  /** One point on each series' fill/stroke (legend swatch or mark), in series order. */
  series: NormPoint[];
  /** One point inside each bar (single-series bar charts), in label order. */
  bars: NormPoint[];
}

/**
 * Value axis anchors, as coordinates along the value axis (y for vertical bars, x for horizontal), 0..1000 of the FULL
 * image. Lets the app turn bar sizes into numbers when the chart has no printed labels.
 */
export interface AxisScale {
  zeroBaselineCoord: number | null;
  topTickCoord: number | null;
  topTickValue: number | null;
  /** Every visible axis tick (value + coordinate along the value axis). Two or more give an exact linear scale. */
  ticks?: { value: number; coord: number }[];
}

export interface ExtractedStyle {
  showXAxis?: boolean;
  showYAxis?: boolean;
  showGridlines?: boolean;
  showDataLabels?: boolean;
  dataLabelPosition?: DataLabelPosition;
  /** Hex of the main text colour, when the model could read it. */
  textColor?: string;
  titleAlign?: TitleAlign;
  /** Title size relative to a normal title (0.6..1.6). */
  titleScale?: number;
  legendPosition?: LegendPosition;
  showMarkers?: boolean;
  strokeWidth?: number;
  donutInnerRatio?: number;
  /** Model's call on bar corners; pixel measurement wins when it can measure. */
  barCorners?: "sharp" | "rounded";
}

export interface ExtractedSeries {
  name: string;
  values: (number | null)[];
  /** "printed": read from a label on the chart. "estimated": the model guessed, or computed from pixels. */
  valueSource: ValueSource;
  /** 0..1 */
  confidence: number;
  /** Optional per-value confidence (same length as labels); overrides `confidence` where present. */
  confidences?: (number | null)[];
  /** Per value: true where the model estimated an unreadable mark (e.g. a 1% sliver) instead of reading it. */
  estimated?: (boolean | null)[];
  colorHint?: string;
  /** y pixel of each bar top / point, in the coordinate frame of the image that was sent. Enables pixel math. */
  topsPx?: (number | null)[];
}

export interface ExtractedChart {
  chartType: ChartType;
  title: string;
  subtitle: string;
  /** Footnote / "Source: ..." line. */
  sourceNote: string;
  labels: string[];
  series: ExtractedSeries[];
  units: { prefix: string; suffix: string };
  axis?: AxisCalibration;
  /** Chart area alone, without browser tabs, toolbars or page chrome. */
  chartBounds?: NormBounds;
  /** One box per mark (bar / column / slice), in order, same length as labels. null = the model gave an unusable box. */
  elementBounds?: (NormBounds | null)[];
  axisScale?: AxisScale;
  /** Inner plot area (axes box). */
  plotBox?: NormBounds;
  /** Which image the geometry fields are normalised to: the plot crop (Image 2) or the full screenshot. */
  frame?: "plot" | "full";
  samplePoints?: SamplePoints;
  style: ExtractedStyle;
}

const CHART_TYPES: readonly ChartType[] = ["bar", "horizontal-bar", "stacked-bar", "line", "area", "pie", "donut"];
const LABEL_POSITIONS: readonly DataLabelPosition[] = ["outside-top", "inside-top", "inside-bottom"];
/** A crop narrower than this (of 1000) is assumed to be a model mistake. */
const MIN_BOUNDS_SPAN = 100;

const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const hex = (v: unknown): string | undefined => (/^#[0-9a-f]{6}$/i.test(str(v)) ? str(v).toUpperCase() : undefined);
const norm = (n: number): number => Math.min(1000, Math.max(0, n));

function point(v: unknown): NormPoint | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const x = num(v[0]);
  const y = num(v[1]);
  return x === null || y === null ? null : [norm(x), norm(y)];
}

/** A mark's box: like parseBounds but with no minimum size, because 1-2 px slivers are exactly what this is for. */
export function parseElementBox(v: unknown): NormBounds | null {
  if (!Array.isArray(v) || v.length < 4) return null;
  const n = v.slice(0, 4).map(num);
  if (n.some((x) => x === null)) return null;
  const [a, b, c, d] = n.map((x) => norm(x!)) as [number, number, number, number];
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

/** [ymin,xmin,ymax,xmax] -> clamped, ordered box; null when missing, malformed or implausibly small. */
export function parseBounds(v: unknown): NormBounds | null {
  if (!Array.isArray(v) || v.length < 4) return null;
  const n = v.slice(0, 4).map(num);
  if (n.some((x) => x === null)) return null;
  const [a, b, c, d] = n.map((x) => norm(x!)) as [number, number, number, number];
  const box: NormBounds = [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
  return box[2] - box[0] < MIN_BOUNDS_SPAN || box[3] - box[1] < MIN_BOUNDS_SPAN ? null : box;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The geometry-first schema lists every mark as an element { label, value, rawText, bounds, confidence }. Fold it into the
 * flat labels / series / elementBounds shape the rest of the pipeline uses; explicit labels, series and
 * elementBounds from the model win, and an element only fills what is missing (a null value readable from rawText).
 */
export function normalizeElements(r: Record<string, unknown>): Record<string, unknown> {
  const els = Array.isArray(r.elements) ? r.elements.filter(isObj) : [];
  if (els.length === 0) return r;
  const out: Record<string, unknown> = { ...r };
  const fromRaw = (e: Record<string, unknown>): number | null => {
    const v = num(e.value);
    if (v !== null) return v;
    const raw = str(e.rawText, 40);
    const p = raw && /\d/.test(raw) ? parseUnitCell(raw).value : null;
    return typeof p === "number" ? p : null;
  };
  const values = els.map(fromRaw);
  const confs = els.map((e) => (num(e.confidence) === null ? null : Math.min(1, Math.max(0, num(e.confidence)!))));
  const printed = els.every((e, i) => values[i] !== null && str(e.rawText, 40) !== "");
  if (!Array.isArray(r.labels) || r.labels.length === 0) out.labels = els.map((e) => str(e.label, 80));
  const given = Array.isArray(r.series) ? r.series.filter(isObj) : [];
  if (given.length === 0) {
    out.series = [{ name: str(r.title, 60) || "Value", values, valueSource: printed ? "printed" : "estimated", confidence: Math.min(...confs.map((c) => c ?? 0.5)), confidences: confs }];
  } else {
    const first = given[0]!;
    const own = Array.isArray(first.values) ? first.values : [];
    out.series = [
      { ...first, values: values.map((v, i) => num(own[i]) ?? v), confidences: Array.isArray(first.confidences) ? first.confidences : confs },
      ...given.slice(1),
    ];
  }
  if (!Array.isArray(r.elementBounds)) out.elementBounds = els.map((e) => e.bounds);
  return out;
}

/** Hand-written schema check for the model's JSON. Never throws; problems become warnings. */
export function validateExtraction(raw: unknown): { chart: ExtractedChart | null; warnings: string[] } {
  const warnings: string[] = [];
  if (!raw || typeof raw !== "object") return { chart: null, warnings: ["The model's answer wasn't a JSON object."] };
  const r = normalizeElements(raw as Record<string, unknown>);

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
      confidences: Array.isArray(o.confidences) ? fit(o.confidences, (x) => (num(x) === null ? null : Math.min(1, Math.max(0, num(x)!)))) : undefined,
      estimated: Array.isArray(o.estimated) ? fit(o.estimated, (x) => (typeof x === "boolean" ? x : null)) : undefined,
      colorHint: hex(o.color),
      topsPx: Array.isArray(o.topsPx) ? fit(o.topsPx, num) : undefined,
    });
  }
  if (series.length === 0) return { chart: null, warnings: [...warnings, "No data series were found in the image."] };

  const a = r.axis && typeof r.axis === "object" ? (r.axis as Record<string, unknown>) : null;
  const axis: AxisCalibration | undefined =
    a && num(a.baselinePx) !== null && num(a.topTickPx) !== null && num(a.topTickValue) !== null
      ? { baselinePx: num(a.baselinePx)!, baselineValue: num(a.baselineValue) ?? 0, topTickPx: num(a.topTickPx)!, topTickValue: num(a.topTickValue)! }
      : undefined;

  const chartBounds = parseBounds(r.chartBounds) ?? undefined;
  if (r.chartBounds !== undefined && !chartBounds) warnings.push("The chart's crop box looked wrong, so the whole image was used.");

  const sp = r.samplePoints && typeof r.samplePoints === "object" ? (r.samplePoints as Record<string, unknown>) : null;
  let elementBounds: (NormBounds | null)[] | undefined;
  if (Array.isArray(r.elementBounds)) {
    elementBounds = r.elementBounds.map(parseElementBox);
    if (elementBounds.length !== labels.length) {
      warnings.push(`The model gave ${elementBounds.length} element boxes for ${labels.length} labels, so bar sizes weren't used.`);
      elementBounds = undefined;
    }
  }
  const ax = r.axisScale && typeof r.axisScale === "object" ? (r.axisScale as Record<string, unknown>) : null;
  const coord = (v: unknown): number | null => (num(v) === null ? null : norm(num(v)!));
  const ticks = (Array.isArray(r.yAxisTicks) ? r.yAxisTicks : [])
    .filter(isObj)
    .map((t) => ({ value: num(t.value), coord: coord(t.coord) }))
    .filter((t): t is { value: number; coord: number } => t.value !== null && t.coord !== null);
  const zeroY = coord(r.zeroBaselineY);
  const axisScale: AxisScale | undefined =
    ax || ticks.length > 0 || zeroY !== null
      ? { zeroBaselineCoord: zeroY ?? coord(ax?.zeroBaselineCoord), topTickCoord: coord(ax?.topTickCoord), topTickValue: num(ax?.topTickValue), ticks: ticks.length > 0 ? ticks : undefined }
      : undefined;
  const plotBox = parseBounds(r.plotBox) ?? undefined;
  const frame = r.frame === "plot" ? ("plot" as const) : r.frame === "full" ? ("full" as const) : undefined;

  // Unusable entries become NO_POINT so the rest keep their series / bar index.
  const list = (v: unknown): NormPoint[] => (Array.isArray(v) ? v.map((p) => point(p) ?? NO_POINT) : []);
  const samplePoints: SamplePoints | undefined = sp ? { background: point(sp.background) ?? undefined, series: list(sp.series), bars: list(sp.bars) } : undefined;

  const st = r.style && typeof r.style === "object" ? (r.style as Record<string, unknown>) : r;
  const style: ExtractedStyle = {
    showXAxis: bool(st.showXAxis),
    showYAxis: bool(st.showYAxis),
    showGridlines: bool(st.showGridlines),
    showDataLabels: bool(st.showDataLabels),
    dataLabelPosition: LABEL_POSITIONS.find((p) => p === st.dataLabelPosition),
    textColor: hex(st.textColor),
    titleAlign: st.titleAlign === "center" ? "center" : st.titleAlign === "left" ? "left" : undefined,
    titleScale: num(st.titleScale) === null ? undefined : Math.min(1.6, Math.max(0.6, num(st.titleScale)!)),
    legendPosition: (["top", "bottom", "hidden"] as const).find((p) => p === st.legendPosition),
    showMarkers: bool(st.showMarkers),
    strokeWidth: num(st.strokeWidth) === null ? undefined : Math.min(16, Math.max(1, num(st.strokeWidth)!)),
    donutInnerRatio: num(st.donutInnerRatio) === null ? undefined : Math.min(0.9, Math.max(0.2, num(st.donutInnerRatio)!)),
    barCorners: st.barCorners === "sharp" ? "sharp" : st.barCorners === "rounded" ? "rounded" : undefined,
  };

  const u = r.units && typeof r.units === "object" ? (r.units as Record<string, unknown>) : {};
  return {
    chart: {
      chartType: type ?? "bar",
      title: str(r.title),
      subtitle: str(r.subtitle),
      sourceNote: str(r.sourceNote, 300),
      labels,
      series,
      units: { prefix: str(u.prefix, 3), suffix: str(u.suffix, 3) },
      axis,
      chartBounds,
      elementBounds,
      axisScale,
      plotBox,
      frame,
      samplePoints,
      style,
    },
    warnings,
  };
}

function nearestColor(hexColor: string, palette: string[]): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = rgb(hexColor) as [number, number, number];
  let best = hexColor;
  let bestD = Infinity;
  for (const p of palette) {
    const [pr, pg, pb] = rgb(p) as [number, number, number];
    const d = Math.hypot(pr - r, pg - g, pb - b);
    if (d < bestD) ((bestD = d), (best = p));
  }
  return best;
}

/**
 * Turn a validated extraction into a ParsedTable.
 * Per-cell provenance: printed -> OCR_EXACT; pixel math from calibrated bar tops -> AXIS_MEASURED;
 * a guess, or confidence below CONFIDENCE_THRESHOLD -> LOW_CONFIDENCE. Series colours snap to colours actually
 * sampled from the image when no coordinate-sampled colour is available.
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
    const goodTag: CellProvenance = source === "pixel" ? "AXIS_MEASURED" : "OCR_EXACT";
    const provenance = values.map((v, k): CellProvenance => {
      if (v === null) return "MISSING";
      const conf = s.confidences?.[k] ?? s.confidence;
      // An estimated sliver or a bar-size measurement is never "printed", even when the other values were read exactly.
      if (s.estimated?.[k] === true) return "ESTIMATED";
      return conf < CONFIDENCE_THRESHOLD || source === "guess" ? "LOW_CONFIDENCE" : goodTag;
    });
    const color = s.colorHint && palette.length ? nearestColor(s.colorHint, palette) : (s.colorHint ?? palette[i]);
    return { name: s.name, values, included: true, color, provenance };
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
