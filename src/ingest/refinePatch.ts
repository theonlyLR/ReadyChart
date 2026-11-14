import { setChartType } from "../model/dataOps";
import type { ChartDocument, ChartType, DataLabelPosition, LegendPosition, TitleAlign } from "../model/types";

/**
 * Applies the closed-loop refinement patch (RFC 6902 style) to a ChartDocument, strictly inside an allowlist.
 *
 * This pass exists to repair a screenshot reconstruction, so unlike natural-language STYLING edits (CLAUDE.md rule 5:
 * /geometry, /motion, /canvas, /brand only) it may also correct what the screenshot itself shows: text, labels, units and
 * individual cell values. It can never add or remove rows or series, never touch /brand, /motion or provenance
 * directly, and every value it changes is re-tagged for review. Anything outside the list is rejected with a reason.
 */

export interface PatchOp {
  op: string;
  path: string;
  value?: unknown;
}

export interface PatchResult {
  doc: ChartDocument;
  applied: PatchOp[];
  rejected: { op: PatchOp; reason: string }[];
}

const CHART_TYPES: readonly ChartType[] = ["bar", "horizontal-bar", "stacked-bar", "line", "area", "pie", "donut"];
const LABEL_POSITIONS: readonly DataLabelPosition[] = ["outside-top", "inside-top", "inside-bottom"];
const LEGENDS: readonly LegendPosition[] = ["top", "bottom", "hidden"];
const ALIGNS: readonly TitleAlign[] = ["left", "center"];
const HEX = /^#[0-9a-f]{6}$/i;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const idx = (s: string | undefined, len: number): number | null => {
  if (s === undefined || !/^\d+$/.test(s)) return null;
  const i = Number(s);
  return i < len ? i : null;
};

type Scalar = (d: ChartDocument, v: unknown) => string | null;

/** One setter per allowed scalar path. Returns an error message, or null when the value was applied. */
const SCALARS: Record<string, Scalar> = {
  "/title": (d, v) => (typeof v === "string" ? ((d.title = v.slice(0, 200)), null) : "expected text"),
  "/subtitle": (d, v) => (typeof v === "string" ? ((d.subtitle = v.slice(0, 200)), null) : "expected text"),
  "/sourceFooter": (d, v) => (typeof v === "string" ? ((d.sourceFooter = v.slice(0, 300)), null) : "expected text"),
  "/canvas/background": (d, v) => (typeof v === "string" && HEX.test(v) ? ((d.canvas.background = v.toUpperCase()), null) : "expected #RRGGBB"),
  "/canvas/textColor": (d, v) => (v === null ? ((d.canvas.textColor = null), null) : typeof v === "string" && HEX.test(v) ? ((d.canvas.textColor = v.toUpperCase()), null) : "expected #RRGGBB or null"),
  "/canvas/titleAlign": (d, v) => (ALIGNS.includes(v as TitleAlign) ? ((d.canvas.titleAlign = v as TitleAlign), null) : "expected left or center"),
  "/canvas/titleScale": (d, v) => (isNum(v) ? ((d.canvas.titleScale = clamp(v, 0.6, 1.6)), null) : "expected a number"),
  "/geometry/type": (d, v) => (CHART_TYPES.includes(v as ChartType) ? (setChartType(d, v as ChartType), null) : "unknown chart type"),
  "/geometry/barRadius": (d, v) => (Array.isArray(v) && v.length === 4 && v.every(isNum) ? ((d.geometry.barRadius = v.map((x) => clamp(x, 0, 80)) as [number, number, number, number]), null) : "expected 4 numbers"),
  "/geometry/barGapRatio": (d, v) => (isNum(v) ? ((d.geometry.barGapRatio = clamp(v, 0, 0.9)), null) : "expected a number"),
  "/geometry/strokeWidth": (d, v) => (isNum(v) ? ((d.geometry.strokeWidth = clamp(v, 1, 16)), null) : "expected a number"),
  "/geometry/curveTension": (d, v) => (isNum(v) ? ((d.geometry.curveTension = clamp(v, 0, 1)), null) : "expected a number"),
  "/geometry/donutInnerRatio": (d, v) => (isNum(v) ? ((d.geometry.donutInnerRatio = clamp(v, 0.2, 0.9)), null) : "expected a number"),
  "/geometry/groupSmallSlicesBelowPct": (d, v) => (isNum(v) ? ((d.geometry.groupSmallSlicesBelowPct = clamp(v, 0, 15)), null) : "expected a number"),
  "/geometry/showGridlines": (d, v) => (typeof v === "boolean" ? ((d.geometry.showGridlines = v), null) : "expected true or false"),
  "/geometry/showDataLabels": (d, v) => (typeof v === "boolean" ? ((d.geometry.showDataLabels = v), null) : "expected true or false"),
  "/geometry/showXAxis": (d, v) => (typeof v === "boolean" ? ((d.geometry.showXAxis = v), null) : "expected true or false"),
  "/geometry/showYAxis": (d, v) => (typeof v === "boolean" ? ((d.geometry.showYAxis = v), null) : "expected true or false"),
  "/geometry/showMarkers": (d, v) => (typeof v === "boolean" ? ((d.geometry.showMarkers = v), null) : "expected true or false"),
  "/geometry/dataLabelPosition": (d, v) => (LABEL_POSITIONS.includes(v as DataLabelPosition) ? ((d.geometry.dataLabelPosition = v as DataLabelPosition), null) : "unknown label position"),
  "/geometry/legendPosition": (d, v) => (LEGENDS.includes(v as LegendPosition) ? ((d.geometry.legendPosition = v as LegendPosition), null) : "unknown legend position"),
  "/data/unitPrefix": (d, v) => (typeof v === "string" ? ((d.data.unitPrefix = v.slice(0, 3)), null) : "expected text"),
  "/data/unitSuffix": (d, v) => (typeof v === "string" ? ((d.data.unitSuffix = v.slice(0, 3)), null) : "expected text"),
};

const unescape = (s: string): string => s.replace(/~1/g, "/").replace(/~0/g, "~");

function applyOne(d: ChartDocument, op: PatchOp): string | null {
  if (op.op !== "replace" && op.op !== "add" && op.op !== "remove") return "unsupported operation";
  const segs = op.path.split("/").slice(1).map(unescape);
  const scalar = SCALARS[op.path];
  if (scalar) return op.op === "remove" ? "can't remove this field" : scalar(d, op.value);

  if (segs[0] === "data" && segs[1] === "labels" && segs.length === 3) {
    const i = idx(segs[2], d.data.labels.length);
    if (i === null) return "no such row";
    if (op.op === "remove" || typeof op.value !== "string") return "expected text";
    d.data.labels[i] = op.value.slice(0, 80);
    return null;
  }
  if (segs[0] === "data" && segs[1] === "series") {
    const s = d.data.series[idx(segs[2], d.data.series.length) ?? -1];
    if (!s) return "no such series";
    if (segs.length === 4 && segs[3] === "name" && op.op !== "remove") return typeof op.value === "string" ? ((s.name = op.value.slice(0, 60) || s.name), null) : "expected text";
    if (segs.length === 4 && segs[3] === "color" && op.op !== "remove") return typeof op.value === "string" && HEX.test(op.value) ? ((s.color = op.value.toUpperCase()), null) : "expected #RRGGBB";
    if (segs.length === 5 && segs[3] === "values") {
      const i = idx(segs[4], s.values.length);
      if (i === null) return "no such row";
      if (op.op === "remove") return "can't remove a value";
      if (op.value !== null && !isNum(op.value)) return "expected a number or null";
      s.values[i] = op.value as number | null;
      // A changed value is a correction the user should look at, never a silently trusted one.
      s.provenance[i] = op.value === null ? "MISSING" : "LOW_CONFIDENCE";
      return null;
    }
    if (segs.length === 5 && segs[3] === "pointColorOverrides") {
      if (d.data.series.length !== 1) return "per-item colours need a single series";
      const i = idx(segs[4], d.data.labels.length);
      if (i === null) return "no such row";
      if (op.op === "remove") {
        if (s.pointColorOverrides) delete s.pointColorOverrides[i];
        if (s.pointColorOverrides && Object.keys(s.pointColorOverrides).length === 0) delete s.pointColorOverrides;
        return null;
      }
      if (typeof op.value !== "string" || !HEX.test(op.value)) return "expected #RRGGBB";
      (s.pointColorOverrides ??= {})[i] = op.value.toUpperCase();
      return null;
    }
  }
  return "path isn't allowed";
}

/** Pure: returns a new document with every valid, allowed operation applied and a list of what was rejected. */
export function applyRefinePatch(doc: ChartDocument, patch: unknown[]): PatchResult {
  const next = structuredClone(doc) as ChartDocument;
  const applied: PatchOp[] = [];
  const rejected: PatchResult["rejected"] = [];
  for (const raw of patch) {
    const op = raw as PatchOp;
    if (!op || typeof op.op !== "string" || typeof op.path !== "string") {
      rejected.push({ op: op ?? { op: "?", path: "?" }, reason: "malformed operation" });
      continue;
    }
    const reason = applyOne(next, op);
    if (reason) rejected.push({ op, reason });
    else applied.push(op);
  }
  return { doc: next, applied, rejected };
}

/** The slice of the document the critique model needs: no logo data URLs, fonts or motion settings. */
export function docForCritique(doc: ChartDocument): unknown {
  return { title: doc.title, subtitle: doc.subtitle, sourceFooter: doc.sourceFooter, canvas: { aspectPreset: doc.canvas.aspectPreset, background: doc.canvas.background, textColor: doc.canvas.textColor, titleAlign: doc.canvas.titleAlign, titleScale: doc.canvas.titleScale }, data: { unitPrefix: doc.data.unitPrefix, unitSuffix: doc.data.unitSuffix, labels: doc.data.labels, series: doc.data.series.map((s) => ({ name: s.name, color: s.color, values: s.values, pointColorOverrides: s.pointColorOverrides })) }, geometry: doc.geometry };
}
