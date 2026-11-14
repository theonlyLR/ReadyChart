import { describe, expect, it } from "vitest";
import { buildPrompt } from "../../vision/prompt";
import { extractionToTable, validateExtraction } from "../../vision/VisionProvider";
import type { ExtractedChart, NormBounds } from "../../vision/VisionProvider";
import { applyMeasuredColors, deriveDesign } from "./design";
import { THIN_BAR_PX, boxToCropRect, measureExtent, medianFillColor, sampleRegion, verifyGeometry } from "./geometry";

type RGB = [number, number, number];
const BG: RGB = [15, 23, 42];
const INK: RGB = [248, 250, 252];
const BLUE: RGB = [60, 90, 220];
const AMBER: RGB = [245, 158, 11];

const W = 400;
const H = 200;
const BASE = 170; // baseline y
const paint = (rects: [number, number, number, number, RGB][]) => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) data.set([...BG, 255], p * 4);
  for (const [x0, y0, x1, y1, c] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set([...c, 255], (y * W + x) * 4);
  return { data, width: W, height: H };
};
const norm = (x0: number, y0: number, x1: number, y1: number): NormBounds => [(y0 / H) * 1000, (x0 / W) * 1000, (y1 / H) * 1000, (x1 / W) * 1000];
const full = { width: W, height: H };
const rect = { x: 0, y: 0, width: W, height: H };
// Four bars, 2 px per unit: 50, 30, 20 and a 1-unit sliver (2 px tall).
const barX = [40, 130, 220, 310];
const heights = [100, 60, 40, 2];
const bars = barX.map((x, i) => [x, BASE - heights[i]!, x + 50, BASE] as [number, number, number, number]);
const img = () => paint(bars.map((b, i) => [...b, i === 2 ? AMBER : BLUE] as [number, number, number, number, RGB]));
const boxes = bars.map((b) => norm(...b));

const chart = (over: Partial<ExtractedChart> = {}, values: (number | null)[] = [50, 30, 20, null], valueSource: "printed" | "estimated" = "printed"): ExtractedChart => ({
  chartType: "bar",
  title: "",
  subtitle: "",
  sourceNote: "",
  labels: ["A", "B", "C", "D"],
  series: [{ name: "S", values, valueSource, confidence: 0.95 }],
  units: { prefix: "", suffix: "%" },
  elementBounds: boxes,
  style: {},
  ...over,
});
const run = (c: ExtractedChart, image = img()) => verifyGeometry({ chart: c, crop: image, rect, full, background: "#0F172A", ink: "#F8FAFC" });

describe("boxToCropRect", () => {
  it("maps full-image normalised boxes into the crop", () => {
    const r = boxToCropRect(norm(100, 50, 200, 120), { x: 80, y: 20, width: 300, height: 160 }, full, 300, 160)!;
    expect(r).toEqual({ x: 20, y: 30, width: 100, height: 70 });
  });
  it("returns null for boxes outside the crop and keeps 1px slivers", () => {
    expect(boxToCropRect(norm(0, 0, 10, 10), { x: 100, y: 100, width: 100, height: 50 }, full, 100, 50)).toBeNull();
    expect(boxToCropRect(norm(10, 100, 10.2, 110), rect, full, W, H)!.width).toBe(1);
  });
});

describe("medianFillColor (text-safe)", () => {
  it("ignores label pixels and background inside the middle 60% of the box", () => {
    const image = paint([[40, 70, 90, BASE, BLUE], [55, 90, 75, 100, INK]]); // white value label inside the bar
    const hex = medianFillColor(image, { x: 40, y: 70, width: 50, height: 100 }, BG, INK);
    expect(hex).toEqual(BLUE);
  });
  it("returns null when the box holds only background and text", () => {
    expect(medianFillColor(paint([]), { x: 10, y: 10, width: 20, height: 20 }, BG, INK)).toBeNull();
  });
});

describe("measureExtent", () => {
  it("finds the true edges even when the model's box is loose, and rides through an inside label", () => {
    const image = paint([[40, 70, 90, BASE, BLUE], [55, 100, 75, 110, INK]]);
    const e = measureExtent(image, { x: 36, y: 60, width: 58, height: 120 }, BLUE, true)!;
    expect(e).toEqual({ near: 70, far: BASE });
  });
});

describe("sliver recovery", () => {
  it("computes an unreadable 1% sliver from the scale of the readable bars and tags it estimated", () => {
    const { chart: out } = run(chart());
    expect(out.series[0]!.values).toEqual([50, 30, 20, 1]);
    expect(out.series[0]!.estimated).toEqual([null, null, null, true]);
    const t = extractionToTable(out, []);
    expect(t.series[0]!.provenance).toEqual(["OCR_EXACT", "OCR_EXACT", "OCR_EXACT", "ESTIMATED"]);
  });
  it("leaves printed values within 15% alone", () => {
    const { chart: out } = run(chart({}, [51, 29, 21, null]));
    expect(out.series[0]!.values.slice(0, 3)).toEqual([51, 29, 21]);
  });
});

describe("axisScale (no printed labels)", () => {
  const axis = { zeroBaselineCoord: (BASE / H) * 1000, topTickCoord: (20 / H) * 1000, topTickValue: 75 }; // 150 px = 75 -> 0.5/px
  it("derives every value from bar size and tags all of them estimated", () => {
    const { chart: out } = run(chart({ axisScale: axis }, [null, null, null, null], "estimated"));
    expect(out.series[0]!.values).toEqual([50, 30, 20, 1]);
    expect(out.series[0]!.estimated).toEqual([true, true, true, true]);
    expect(extractionToTable(out, []).series[0]!.provenance).toEqual(["ESTIMATED", "ESTIMATED", "ESTIMATED", "ESTIMATED"]);
  });
  it("prefers geometry over the model's guesses when the series isn't printed", () => {
    const { chart: out } = run(chart({ axisScale: axis }, [48, 33, 15, 2], "estimated"));
    expect(out.series[0]!.values).toEqual([50, 30, 20, 1]);
  });
  it("uses the axis even with a single bar and negative bars", () => {
    const image = paint([[40, BASE, 90, BASE + 30, BLUE], [130, BASE - 60, 180, BASE, BLUE]]);
    const c = chart({ axisScale: axis, labels: ["A", "B"], elementBounds: [norm(40, BASE, 90, BASE + 30), norm(130, BASE - 60, 180, BASE)] }, [null, null], "estimated");
    expect(run(c, image).chart.series[0]!.values).toEqual([-15, 30]);
  });
});

describe("OCR vs geometry contradictions", () => {
  it("prefers the geometric value when a printed number is off by more than 15% and marks it low-confidence", () => {
    // sizes 100/60/40/20 px at 0.5 per px; the third bar's label was misread as 28 instead of 20
    const four = paint([[40, 70, 90, BASE, BLUE], [130, 110, 180, BASE, BLUE], [220, 130, 270, BASE, BLUE], [310, 150, 360, BASE, BLUE]]);
    const bs = [norm(40, 70, 90, BASE), norm(130, 110, 180, BASE), norm(220, 130, 270, BASE), norm(310, 150, 360, BASE)];
    const { chart: out } = run(chart({ elementBounds: bs }, [50, 30, 28, 10]), four);
    expect(out.series[0]!.values).toEqual([50, 30, 20, 10]);
    expect(out.series[0]!.confidences![2]).toBeLessThan(0.85);
    expect(extractionToTable(out, []).series[0]!.provenance).toEqual(["OCR_EXACT", "OCR_EXACT", "LOW_CONFIDENCE", "OCR_EXACT"]);
  });
  it("doesn't adjudicate with fewer than 3 anchors", () => {
    const { chart: out } = run(chart({}, [50, 45, null, null]));
    expect(out.series[0]!.values.slice(0, 2)).toEqual([50, 45]);
  });
  it("doesn't 'correct' a chart whose bars don't share a linear scale (truncated axis)", () => {
    const four = paint([[40, 70, 90, BASE, BLUE], [130, 110, 180, BASE, BLUE], [220, 130, 270, BASE, BLUE], [310, 150, 360, BASE, BLUE]]);
    const bs = [norm(40, 70, 90, BASE), norm(130, 110, 180, BASE), norm(220, 130, 270, BASE), norm(310, 150, 360, BASE)];
    const { chart: out } = run(chart({ elementBounds: bs }, [92, 71, 15, 90]), four); // ratios all over the place
    expect(out.series[0]!.values).toEqual([92, 71, 15, 90]);
  });
});

describe("scope", () => {
  it("only acts on single-series bar / horizontal-bar charts with one box per label", () => {
    const pie = chart({ chartType: "pie" });
    expect(run(pie).chart).toBe(pie);
    const multi = chart({ series: [...chart().series, { name: "T", values: [1, 2, 3, 4], valueSource: "printed", confidence: 1 }] });
    expect(run(multi).chart).toBe(multi);
    const none = chart({ elementBounds: undefined });
    expect(run(none).chart).toBe(none);
  });
  it("measures widths for horizontal bars", () => {
    // bars grow right from x=60 at 2 px per unit: 40, 25
    const image = paint([[60, 30, 60 + 80, 60, BLUE], [60, 100, 60 + 50, 130, BLUE]]);
    const c = chart({ chartType: "horizontal-bar", labels: ["A", "B"], elementBounds: [norm(60, 30, 140, 60), norm(60, 100, 110, 130)] }, [40, null]);
    expect(run(c, image).chart.series[0]!.values).toEqual([40, 25]);
  });
  it("leaves legacy pixel-calibrated charts (local scanner axis) to extractionToTable but still measures colours", () => {
    const c = chart({ axis: { baselinePx: BASE, baselineValue: 0, topTickPx: 20, topTickValue: 75 } }, [null, null, null, null], "estimated");
    const r = run(c);
    expect(r.chart).toBe(c);
    expect(r.colors[2]).toBe("#F59E0B");
  });
});

describe("measured colours", () => {
  it("returns a text-safe median per bar and turns differing bars into overrides", () => {
    const r = run(chart());
    expect(r.colors.slice(0, 3)).toEqual(["#3C5ADC", "#3C5ADC", "#F59E0B"]);
    const derived = deriveDesign(chart(), img(), rect, full);
    const out = applyMeasuredColors(derived, chart(), r.colors);
    expect(out.seriesColors).toEqual(["#3C5ADC"]);
    expect(out.design.barColors).toEqual({ 2: "#F59E0B" });
  });
});

describe("schema + prompt", () => {
  const base = { labels: ["A", "B", "C"], series: [{ name: "S", values: [1, 2, 3] }] };
  it("parses elementBounds (slivers allowed) and axisScale", () => {
    const { chart: c } = validateExtraction({ ...base, elementBounds: [[100, 10, 900, 60], [500, 100, 900, 101], "bad"], axisScale: { zeroBaselineCoord: 900, topTickCoord: 100, topTickValue: 80 } });
    expect(c?.elementBounds).toEqual([[100, 10, 900, 60], [500, 100, 900, 101], null]);
    expect(c?.axisScale).toEqual({ zeroBaselineCoord: 900, topTickCoord: 100, topTickValue: 80 });
  });
  it("enforces labels.length === elementBounds.length by dropping a mismatched list with a warning", () => {
    const r = validateExtraction({ ...base, elementBounds: [[0, 0, 100, 100]] });
    expect(r.chart?.elementBounds).toBeUndefined();
    expect(r.warnings.join(" ")).toMatch(/1 element boxes for 3 labels/);
  });
  it("the prompt demands geometry-first types, elementBounds, equal lengths and axisScale", () => {
    const p = buildPrompt({ width: 1, height: 1, colors: [] });
    expect(p).toMatch(/NEVER "pie" or "donut"/);
    expect(p).toMatch(/"elementBounds"/);
    expect(p).toMatch(/exactly the same number of entries/);
    expect(p).toMatch(/"axisScale"/);
    expect(p).toMatch(/zeroBaselineCoord/);
  });
});

describe("thin-sliver colour sampling", () => {
  it("samples a strip across the end of a bar shorter than 8 px instead of the middle 60%", () => {
    expect(THIN_BAR_PX).toBe(8);
    expect(sampleRegion({ x: 10, y: 20, width: 50, height: 2 }, true)).toEqual({ x: 10, y: 20, width: 50, height: 2 });
    expect(sampleRegion({ x: 10, y: 20, width: 50, height: 7 }, true)).toEqual({ x: 10, y: 20, width: 50, height: 4 });
    expect(sampleRegion({ x: 10, y: 20, width: 3, height: 40 }, false)).toEqual({ x: 10, y: 20, width: 3, height: 40 });
    expect(sampleRegion({ x: 10, y: 20, width: 50, height: 100 }, true)).toEqual({ x: 20, y: 40, width: 30, height: 60 });
  });
  it("a 2 px sliver gets its own colour (not the series colour)", () => {
    const image = paint([[40, 70, 90, BASE, BLUE], [310, BASE - 2, 360, BASE, AMBER]]);
    expect(medianFillColor(image, { x: 310, y: BASE - 2, width: 50, height: 2 }, BG, INK)).toEqual(AMBER);
    const r = run(chart({ elementBounds: [norm(40, 70, 90, BASE), norm(310, BASE - 2, 360, BASE)], labels: ["A", "B"] }, [50, null]), image);
    expect(r.colors).toEqual(["#3C5ADC", "#F59E0B"]);
  });
  it("horizontal slivers sample a vertical strip at the bar's end", () => {
    const image = paint([[60, 40, 62, 80, AMBER]]);
    expect(medianFillColor(image, { x: 60, y: 40, width: 2, height: 40 }, BG, INK, false)).toEqual(AMBER);
  });
  it("the first bar's colour becomes the series colour and later differing bars become overrides", () => {
    const first = chart();
    const derived = deriveDesign(first, img(), rect, full);
    const out = applyMeasuredColors(derived, first, ["#F59E0B", "#3C5ADC", "#3C5ADC", "#3C5ADC"]);
    expect(out.seriesColors).toEqual(["#F59E0B"]);
    expect(out.design.barColors).toEqual({ 1: "#3C5ADC", 2: "#3C5ADC", 3: "#3C5ADC" });
  });
});
