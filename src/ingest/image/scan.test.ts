import { describe, expect, it } from "vitest";
import { createDefaultDocument } from "../../model/defaults";
import { useDocumentStore } from "../../store/documentStore";
import { extractionToTable, parseBounds, validateExtraction } from "../../vision/VisionProvider";
import type { ExtractedChart } from "../../vision/VisionProvider";
import { applyScanResult } from "../toDocument";
import { boundsToRect, pointToCrop } from "./crop";
import { deriveDesign, snapAspect } from "./design";
import { sampleAverage } from "./samplePoint";
import type { ScanResult } from "./scanTypes";

/** RGBA buffer filled with `bg`, with filled rectangles [x0,y0,x1,y1,rgb]. */
function paint(width: number, height: number, bg: [number, number, number], rects: [number, number, number, number, [number, number, number]][]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) data.set([...bg, 255], p * 4);
  for (const [x0, y0, x1, y1, c] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set([...c, 255], (y * width + x) * 4);
  return { data, width, height };
}

describe("boundsToRect / pointToCrop", () => {
  it("maps normalised bounds to whole pixels, rounding outward", () => {
    expect(boundsToRect([100, 200, 900, 800], 1000, 500)).toEqual({ x: 200, y: 50, width: 600, height: 400 });
    expect(boundsToRect([333, 333, 667, 667], 100, 100)).toEqual({ x: 33, y: 33, width: 34, height: 34 });
  });
  it("falls back to the full image and never returns an empty rect", () => {
    expect(boundsToRect(undefined, 640, 480)).toEqual({ x: 0, y: 0, width: 640, height: 480 });
    expect(boundsToRect([500, 500, 500, 500], 10, 10).width).toBeGreaterThanOrEqual(1);
  });
  it("re-expresses a full-image point inside the crop", () => {
    const rect = { x: 200, y: 50, width: 600, height: 400 };
    expect(pointToCrop([500, 500], rect, 1000, 500)).toEqual([500, 500]);
    expect(pointToCrop([200, 100], rect, 1000, 500)).toEqual([0, 0]);
  });
});

describe("parseBounds", () => {
  it("orders reversed boxes and clamps to 0..1000", () => {
    expect(parseBounds([900, 800, -50, 100])).toEqual([0, 100, 900, 800]);
  });
  it("rejects missing, malformed or tiny boxes", () => {
    expect(parseBounds(undefined)).toBeNull();
    expect(parseBounds([1, 2, 3])).toBeNull();
    expect(parseBounds([0, 0, 50, 50])).toBeNull();
  });
});

describe("sampleAverage (5x5)", () => {
  it("averages a 5x5 window, hiding single-pixel noise", () => {
    const img = paint(20, 20, [255, 255, 255], [[0, 0, 20, 20, [100, 100, 100]]]);
    img.data.set([0, 0, 0, 255], (10 * 20 + 10) * 4); // one dark speck in the window
    const hex = sampleAverage(img, 525, 525)!;
    const v = parseInt(hex.slice(1, 3), 16);
    expect(v).toBeGreaterThan(90);
    expect(v).toBeLessThan(100);
  });
  it("clamps at the edges and ignores transparent pixels", () => {
    const img = paint(4, 4, [10, 20, 30], []);
    expect(sampleAverage(img, -50, 2000)).toBe("#0A141E");
    img.data.fill(0);
    expect(sampleAverage(img, 500, 500)).toBeNull();
  });
});

describe("snapAspect", () => {
  it("snaps to the nearest preset", () => {
    expect(snapAspect(1600, 900)).toBe("16:9");
    expect(snapAspect(1000, 1200)).toBe("4:5");
    expect(snapAspect(900, 950)).toBe("1:1");
    expect(snapAspect(500, 900)).toBe("9:16");
  });
});

const chart = (over: Partial<ExtractedChart> = {}): ExtractedChart => ({
  chartType: "bar",
  title: "Revenue",
  subtitle: "By quarter",
  sourceNote: "Source: X",
  labels: ["A", "B", "C"],
  series: [{ name: "Rev", values: [1, 2, 3], valueSource: "printed", confidence: 0.95 }],
  units: { prefix: "$", suffix: "M" },
  style: { showGridlines: false, dataLabelPosition: "inside-top", showYAxis: false },
  ...over,
});

describe("deriveDesign", () => {
  // 100x100 dark page; three bars: blue, blue, orange.
  const px = paint(100, 100, [20, 24, 40], [
    [10, 40, 30, 90, [30, 100, 220]],
    [40, 30, 60, 90, [30, 100, 220]],
    [70, 20, 90, 90, [240, 140, 20]],
  ]);
  const points = { background: [950, 50] as [number, number], series: [[200, 700]] as [number, number][], bars: [[200, 700], [500, 700], [800, 700]] as [number, number][] };
  const rect = { x: 0, y: 0, width: 100, height: 100 };

  it("samples background, series and per-bar colours from real pixels", () => {
    const { design, seriesColors } = deriveDesign(chart({ samplePoints: points }), px, rect, { width: 100, height: 100 });
    expect(design.background).toBe("#141828");
    expect(seriesColors[0]).toBe("#1E64DC");
    expect(design.barColors).toEqual({ 2: "#F08C14" });
  });
  it("drops samples that landed on the background", () => {
    const bad = { ...points, bars: [[200, 700], [500, 700], [800, 50]] as [number, number][] };
    const { design } = deriveDesign(chart({ samplePoints: bad }), px, rect, { width: 100, height: 100 });
    expect(design.barColors).toEqual({});
  });
  it("only overrides per-bar colours on single-series bar charts", () => {
    const two = chart({ samplePoints: points, series: [...chart().series, { name: "B", values: [1, 1, 1], valueSource: "printed", confidence: 1 }] });
    expect(deriveDesign(two, px, rect, { width: 100, height: 100 }).design.barColors).toEqual({});
    expect(deriveDesign(chart({ chartType: "line", samplePoints: points }), px, rect, { width: 100, height: 100 }).design.barColors).toEqual({});
  });
  it("keeps model text colour only when it contrasts with the sampled background", () => {
    const withText = (c: string) => deriveDesign(chart({ samplePoints: points, style: { textColor: c } }), px, rect, { width: 100, height: 100 }).design.textColor;
    expect(withText("#F8FAFC")).toBe("#F8FAFC");
    expect(withText("#202030")).toBeNull();
  });
  it("falls back gracefully with no sample points", () => {
    const { design, seriesColors } = deriveDesign(chart(), px, rect, { width: 100, height: 100 });
    expect(design.background).toBe("#141828");
    expect(seriesColors).toEqual([null]);
  });
});

describe("confidence tagging", () => {
  it("tags values under 0.85 as LOW_CONFIDENCE, per value when given", () => {
    const t = extractionToTable(chart({ series: [{ name: "S", values: [1, 2, 3], valueSource: "printed", confidence: 0.9, confidences: [0.99, 0.84, null] }] }), []);
    expect(t.series[0]!.provenance).toEqual(["OCR_EXACT", "LOW_CONFIDENCE", "OCR_EXACT"]);
    const u = extractionToTable(chart({ series: [{ name: "S", values: [1], valueSource: "printed", confidence: 0.84 }], labels: ["A"] }), []);
    expect(u.series[0]!.provenance).toEqual(["LOW_CONFIDENCE"]);
  });
});

describe("applyScanResult", () => {
  const scanOf = (c: ExtractedChart, design: Partial<ScanResult["design"]> = {}): ScanResult => ({
    chart: c,
    table: extractionToTable(c, []),
    croppedBlob: new Blob([]),
    crop: { width: 100, height: 100 },
    warnings: [],
    design: { background: "#141828", textColor: "#F8FAFC", barColors: { 2: "#F08C14" }, aspect: "4:5", showXAxis: null, showYAxis: false, showGridlines: false, showDataLabels: true, dataLabelPosition: "inside-top", ...design },
  });

  it("recreates data and visual design in one document", () => {
    const doc = applyScanResult(createDefaultDocument(), scanOf(chart()));
    expect(doc.title).toBe("Revenue");
    expect(doc.sourceFooter).toBe("Source: X");
    expect(doc.data.unitPrefix).toBe("$");
    expect(doc.canvas).toMatchObject({ aspectPreset: "4:5", width: 1080, height: 1350, background: "#141828", textColor: "#F8FAFC" });
    expect(doc.geometry).toMatchObject({ showXAxis: true, showYAxis: false, showGridlines: false, dataLabelPosition: "inside-top" });
    expect(doc.data.series[0]!.pointColorOverrides).toEqual({ 2: "#F08C14" });
  });
  it("skips bar overrides for multi-series data", () => {
    const multi = chart({ series: [...chart().series, { name: "B", values: [1, 1, 1], valueSource: "printed", confidence: 1 }] });
    expect(applyScanResult(createDefaultDocument(), scanOf(multi)).data.series.every((s) => !s.pointColorOverrides)).toBe(true);
  });
  it("is exactly one undo step", () => {
    const store = useDocumentStore;
    const before = store.getState().doc;
    const depth = store.getState().past.length;
    store.getState().replaceDoc(applyScanResult(before, scanOf(chart())));
    expect(store.getState().past.length).toBe(depth + 1);
    store.getState().undo();
    expect(store.getState().doc).toEqual(before);
  });
});

describe("validateExtraction (visual fields)", () => {
  it("reads style, bounds and sample points; bad points keep their index", () => {
    const { chart: c } = validateExtraction({
      labels: ["A", "B"],
      series: [{ name: "S", values: [1, 2] }],
      chartBounds: [100, 50, 900, 950],
      samplePoints: { background: [10, 10], series: [[200, 300]], bars: [[100, 200], "bad"] },
      style: { showGridlines: false, dataLabelPosition: "inside-bottom", textColor: "#abcdef" },
    });
    expect(c?.chartBounds).toEqual([100, 50, 900, 950]);
    expect(c?.samplePoints?.bars[1]).toEqual([-1, -1]);
    expect(c?.style).toMatchObject({ showGridlines: false, dataLabelPosition: "inside-bottom", textColor: "#ABCDEF" });
  });
  it("warns and falls back to the full image on a bad crop box", () => {
    const r = validateExtraction({ labels: ["A"], series: [{ name: "S", values: [1] }], chartBounds: [0, 0, 10, 10] });
    expect(r.chart?.chartBounds).toBeUndefined();
    expect(r.warnings.join(" ")).toMatch(/crop box/);
  });
});
