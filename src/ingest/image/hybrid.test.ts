import { describe, expect, it } from "vitest";
import { buildPrompt } from "../../vision/prompt";
import { extractionToTable, normalizeElements, validateExtraction } from "../../vision/VisionProvider";
import type { ExtractedChart, NormBounds } from "../../vision/VisionProvider";
import { createDefaultDocument } from "../../model/defaults";
import { applyScanResult } from "../toDocument";
import { buildAxisMap, verifyGeometry } from "./geometry";
import { plotToFull } from "./frame";
import { sharpen } from "./preprocess";
import type { ScanResult } from "./scanTypes";

type RGB = [number, number, number];
const BG: RGB = [15, 23, 42];
const BLUE: RGB = [60, 90, 220];
const W = 400;
const H = 200;
const BASE = 170;
const full = { width: W, height: H };
const rect = { x: 0, y: 0, width: W, height: H };

function paint(rects: [number, number, number, number, RGB][], radius = 0) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) data.set([...BG, 255], p * 4);
  for (const [x0, y0, x1, y1, c] of rects) {
    for (let y = y0; y < y1; y++) {
      const r = y - y0;
      const inset = r < radius ? Math.round(radius - Math.sqrt(Math.max(0, radius * radius - (radius - r - 0.5) ** 2))) : 0;
      for (let x = x0 + inset; x < x1 - inset; x++) data.set([...c, 255], (y * W + x) * 4);
    }
  }
  return { data, width: W, height: H };
}
const norm = (x0: number, y0: number, x1: number, y1: number): NormBounds => [(y0 / H) * 1000, (x0 / W) * 1000, (y1 / H) * 1000, (x1 / W) * 1000];

// bars at 2 px per unit: 50, 30, 20 (+ a 1% sliver)
const heights = [100, 60, 40, 2];
const xs = [40, 130, 220, 310];
const bars = xs.map((x, i) => [x, BASE - heights[i]!, x + 50, BASE] as [number, number, number, number]);
const boxes = bars.map((b) => norm(...b));
const bar = (over: Partial<ExtractedChart> = {}, values: (number | null)[] = [null, null, null, null], source: "printed" | "estimated" = "estimated"): ExtractedChart => ({
  chartType: "bar",
  title: "",
  subtitle: "",
  sourceNote: "",
  labels: ["A", "B", "C", "D"],
  series: [{ name: "S", values, valueSource: source, confidence: 0.9 }],
  units: { prefix: "", suffix: "" },
  elementBounds: boxes,
  style: {},
  ...over,
});
const run = (c: ExtractedChart, rects = bars.map((b) => [...b, BLUE] as [number, number, number, number, RGB]), radius = 0) => verifyGeometry({ chart: c, crop: paint(rects, radius), rect, full, background: "#0F172A", ink: "#F8FAFC" });
// ticks: value 0 at y=170, value 100 at y=-30?  Use: y=170 -> 0, y=70 -> 50  (0.5 per px)
const ticks = [{ value: 0, coord: (170 / H) * 1000 }, { value: 50, coord: (70 / H) * 1000 }];

describe("axis map from yAxisTicks", () => {
  it("fits two or more ticks exactly, even when the axis doesn't start at zero", () => {
    const m = buildAxisMap({ zeroBaselineCoord: null, topTickCoord: null, topTickValue: null, ticks: [{ value: 20, coord: 800 }, { value: 60, coord: 400 }, { value: 100, coord: 0 }] }, 200, 0)!;
    expect(m.value(160)).toBeCloseTo(20); // 800/1000*200
    expect(m.value(40)).toBeCloseTo(80);
    expect(m.zeroCoord).toBeCloseTo(200); // value 0 would sit at the bottom edge
  });
  it("one tick plus the zero baseline gives a line through (zero, 0)", () => {
    const m = buildAxisMap({ zeroBaselineCoord: 850, topTickCoord: null, topTickValue: null, ticks: [{ value: 50, coord: 350 }] }, 200, 0)!;
    expect(m.value(170)).toBeCloseTo(0);
    expect(m.value(70)).toBeCloseTo(50);
  });
  it("is null without enough information", () => {
    expect(buildAxisMap(undefined, 200, 0)).toBeNull();
    expect(buildAxisMap({ zeroBaselineCoord: null, topTickCoord: null, topTickValue: null, ticks: [{ value: 5, coord: 100 }] }, 200, 0)).toBeNull();
  });
});

describe("pixel geometry from ticks", () => {
  const withAxis = (values: (number | null)[], source: "printed" | "estimated" = "estimated") => bar({ axisScale: { zeroBaselineCoord: (170 / H) * 1000, topTickCoord: null, topTickValue: null, ticks } }, values, source);
  it("computes every value mathematically for a chart with no bar labels", () => {
    const { chart } = run(withAxis([null, null, null, null]));
    expect(chart.series[0]!.values).toEqual([50, 30, 20, 1]);
    expect(extractionToTable(chart, []).series[0]!.provenance).toEqual(["ESTIMATED", "ESTIMATED", "ESTIMATED", "ESTIMATED"]);
  });
  it("fills a null sliver with an estimated value and leaves printed neighbours exact", () => {
    const { chart } = run(withAxis([50, 30, 20, null], "printed"));
    expect(chart.series[0]!.values).toEqual([50, 30, 20, 1]);
    expect(extractionToTable(chart, []).series[0]!.provenance).toEqual(["OCR_EXACT", "OCR_EXACT", "OCR_EXACT", "ESTIMATED"]);
  });
  it("trusts geometry over OCR above a 10% disagreement and flags the cell", () => {
    const { chart } = run(withAxis([50, 30, 23, 1], "printed")); // 23 vs 20 = 15% off
    expect(chart.series[0]!.values[2]).toBe(20);
    expect(extractionToTable(chart, []).series[0]!.provenance![2]).toBe("LOW_CONFIDENCE");
  });
  it("keeps OCR values within 10% (rounding / sub-pixel noise)", () => {
    const { chart } = run(withAxis([50, 30, 21.5, 1], "printed")); // 7.5% off
    expect(chart.series[0]!.values[2]).toBe(21.5);
  });
  it("without an axis, a 12% disagreement among consistent bars is also corrected", () => {
    const { chart } = run(bar({}, [50, 30, 22.5, null], "printed")); // 22.5 vs 20 = 12.5%
    expect(chart.series[0]!.values.slice(0, 3)).toEqual([50, 30, 20]);
  });
  it("reads line / area vertices from their own height", () => {
    // vertices at y = 70, 110, 130 -> 50, 30, 20 on the same axis; boxes are small squares centred on the points
    const pts = [[70, 70], [160, 110], [250, 130]] as const;
    const els = pts.map(([x, y]) => norm(x - 3, y - 3, x + 3, y + 3));
    const c = bar({ chartType: "line", labels: ["A", "B", "C"], elementBounds: els, axisScale: { zeroBaselineCoord: (170 / H) * 1000, topTickCoord: null, topTickValue: null, ticks } }, [null, null, 18], "estimated");
    const { chart } = verifyGeometry({ chart: c, crop: paint([]), rect, full, background: "#0F172A", ink: "#F8FAFC" });
    expect(chart.series[0]!.values).toEqual([50, 30, 20]);
  });
});

describe("bar style from pixels", () => {
  it("measures the gap between bars from their boxes", () => {
    // width 50, pitch 90 -> gap 1 - 50/90 = 0.44
    expect(run(bar({}, [50, 30, 20, 1], "printed")).barStyle?.barGapRatio).toBeCloseTo(0.44, 2);
  });
  it("tells sharp corners from rounded ones, as a share of the bar width", () => {
    const sharp = run(bar({}, [50, 30, 20, 1], "printed"), bars.map((b) => [...b, BLUE] as [number, number, number, number, RGB]), 0);
    expect(sharp.barStyle?.barRadiusRatio).toBe(0);
    const rounded = run(bar({}, [50, 30, 20, 1], "printed"), bars.map((b) => [...b, BLUE] as [number, number, number, number, RGB]), 12);
    expect(rounded.barStyle!.barRadiusRatio!).toBeGreaterThan(0.12);
    expect(rounded.barStyle!.barRadiusRatio!).toBeLessThan(0.3);
  });
});

describe("elements schema", () => {
  const els = [
    { label: "A", value: 50, rawText: "50%", bounds: [100, 10, 900, 60], confidence: 0.95 },
    { label: "B", value: null, rawText: "30%", bounds: [300, 100, 900, 150], confidence: 0.8 },
    { label: "C", value: null, rawText: "", bounds: [800, 200, 900, 201], confidence: 0.3 },
  ];
  it("builds labels, values and bounds from elements; rawText fills an unread value", () => {
    const { chart } = validateExtraction({ chartType: "bar", elements: els });
    expect(chart?.labels).toEqual(["A", "B", "C"]);
    expect(chart?.series[0]!.values).toEqual([50, 30, null]);
    expect(chart?.series[0]!.confidences).toEqual([0.95, 0.8, 0.3]);
    expect(chart?.series[0]!.valueSource).toBe("estimated"); // the sliver has no text
    expect(chart?.elementBounds).toEqual([[100, 10, 900, 60], [300, 100, 900, 150], [800, 200, 900, 201]]);
  });
  it("is 'printed' when every mark has text, and explicit labels / series win over elements", () => {
    const all = els.map((e, i) => ({ ...e, value: [50, 30, 20][i], rawText: ["50", "30", "20"][i] }));
    expect(validateExtraction({ elements: all }).chart?.series[0]!.valueSource).toBe("printed");
    const r = normalizeElements({ labels: ["X", "Y", "Z"], series: [{ name: "S", values: [1, null, null] }], elements: els });
    expect(r.labels).toEqual(["X", "Y", "Z"]);
    expect((r.series as { values: unknown[] }[])[0]!.values).toEqual([1, 30, null]);
  });
  it("parses plotBox, zeroBaselineY, yAxisTicks and the frame", () => {
    const { chart } = validateExtraction({ frame: "plot", labels: ["A"], series: [{ name: "S", values: [1] }], plotBox: [100, 100, 900, 900], zeroBaselineY: 880, yAxisTicks: [{ value: 0, coord: 880 }, { value: 100, coord: 120 }, { value: "x", coord: 1 }] });
    expect(chart?.frame).toBe("plot");
    expect(chart?.plotBox).toEqual([100, 100, 900, 900]);
    expect(chart?.axisScale?.zeroBaselineCoord).toBe(880);
    expect(chart?.axisScale?.ticks).toEqual([{ value: 0, coord: 880 }, { value: 100, coord: 120 }]);
  });
  it("parses layout DNA style fields with clamping", () => {
    const { chart } = validateExtraction({ labels: ["A"], series: [{ name: "S", values: [1] }], style: { titleAlign: "center", titleScale: 9, legendPosition: "bottom", showMarkers: false, strokeWidth: 99, donutInnerRatio: 0.05, barCorners: "sharp" } });
    expect(chart?.style).toMatchObject({ titleAlign: "center", titleScale: 1.6, legendPosition: "bottom", showMarkers: false, strokeWidth: 16, donutInnerRatio: 0.2, barCorners: "sharp" });
  });
});

describe("plot frame conversion", () => {
  it("maps plot-crop coordinates back to the full screenshot", () => {
    // crop = right half, lower half of a 400x200 image: x 200..400, y 100..200
    const c = bar({ frame: "plot", elementBounds: [[0, 0, 500, 500]], plotBox: [0, 0, 1000, 1000], axisScale: { zeroBaselineCoord: 1000, topTickCoord: 0, topTickValue: 100, ticks: [{ value: 0, coord: 1000 }, { value: 100, coord: 0 }] } });
    const out = plotToFull(c, { rect: { x: 200, y: 100, width: 200, height: 100 } }, full);
    expect(out.frame).toBe("full");
    expect(out.elementBounds).toEqual([[500, 500, 750, 750]]);
    expect(out.plotBox).toEqual([500, 500, 1000, 1000]);
    // value axis is vertical: y coordinates map through the crop's y range
    expect(out.axisScale?.zeroBaselineCoord).toBe(1000);
    expect(out.axisScale?.ticks).toEqual([{ value: 0, coord: 1000 }, { value: 100, coord: 500 }]);
  });
  it("maps the x axis for horizontal bars", () => {
    const c = bar({ chartType: "horizontal-bar", frame: "plot", axisScale: { zeroBaselineCoord: 0, topTickCoord: 1000, topTickValue: 10, ticks: [{ value: 10, coord: 1000 }] } });
    const out = plotToFull(c, { rect: { x: 100, y: 0, width: 200, height: 200 } }, full);
    expect(out.axisScale?.zeroBaselineCoord).toBe(250);
    expect(out.axisScale?.ticks).toEqual([{ value: 10, coord: 750 }]);
  });
});

describe("sharpen (plot image contrast)", () => {
  it("raises edge contrast and leaves flat areas and alpha alone", () => {
    const w = 5;
    const data = new Uint8ClampedArray(w * 1 * 4);
    [100, 100, 150, 150, 150].forEach((v, x) => data.set([v, v, v, 255], x * 4));
    sharpen({ data, width: w, height: 1 }, 0.7);
    expect(data[1 * 4]!).toBeLessThan(100); // darker side of the edge dips
    expect(data[2 * 4]!).toBeGreaterThan(150); // brighter side overshoots
    expect(data[0]!).toBe(100); // flat
    expect(data[4 * 4]!).toBe(150);
    expect(data[3]!).toBe(255);
  });
});

describe("prompt: dual image and geometry-first schema", () => {
  const p1 = buildPrompt({ width: 1600, height: 900, colors: [] });
  const p2 = buildPrompt({ width: 1600, height: 900, colors: [], plot: { width: 1800, height: 1000 } });
  it("describes both images and the coordinate frames when a plot crop is sent", () => {
    expect(p2).toMatch(/TWO images/);
    expect(p2).toMatch(/IMAGE 2 \(1800x1000 px\)/);
    expect(p2).toMatch(/"frame":"plot"/);
    expect(p1).not.toMatch(/TWO images/);
    expect(p1).toMatch(/"frame":"full"/);
  });
  it("asks for plotBox, zeroBaselineY, yAxisTicks and an element for every mark, plus layout DNA", () => {
    for (const k of ["plotBox", "zeroBaselineY", "yAxisTicks", "elements", "rawText", "titleAlign", "legendPosition", "showMarkers", "donutInnerRatio", "barCorners"]) expect(p2).toContain(k);
    expect(p2).toMatch(/EVERY visible mark/);
  });
});

describe("applyScanResult: layout DNA", () => {
  const result = (design: Partial<ScanResult["design"]>): ScanResult => {
    const chart = bar({}, [50, 30, 20, 1], "printed");
    return {
      chart,
      table: extractionToTable(chart, []),
      croppedBlob: new Blob([]),
      crop: { width: 100, height: 100 },
      warnings: [],
      design: { background: null, textColor: null, barColors: {}, aspect: "16:9", showXAxis: null, showYAxis: null, showGridlines: null, showDataLabels: null, dataLabelPosition: null, ...design },
    };
  };
  it("applies title, legend, markers, stroke, donut hole, gap and corner radius", () => {
    const d = applyScanResult(createDefaultDocument(), result({ titleAlign: "center", titleScale: 1.3, legendPosition: "bottom", showMarkers: false, strokeWidth: 6, donutInnerRatio: 0.7, barGapRatio: 0.44, barRadiusRatio: 0.2 }));
    expect(d.canvas).toMatchObject({ titleAlign: "center", titleScale: 1.3 });
    expect(d.geometry).toMatchObject({ legendPosition: "bottom", showMarkers: false, strokeWidth: 6, donutInnerRatio: 0.7, barGapRatio: 0.44 });
    expect(d.geometry.barRadius[0]).toBeGreaterThan(0);
    expect(d.geometry.barRadius).toEqual([d.geometry.barRadius[0], d.geometry.barRadius[0], 0, 0]);
  });
  it("sharp bars (ratio 0) get radius 0, and unset fields keep the document's values", () => {
    const base = createDefaultDocument();
    const d = applyScanResult(base, result({ barRadiusRatio: 0 }));
    expect(d.geometry.barRadius).toEqual([0, 0, 0, 0]);
    expect(d.canvas.titleAlign).toBe(base.canvas.titleAlign);
    expect(d.geometry.legendPosition).toBe(base.geometry.legendPosition);
  });
});
