import { describe, expect, it } from "vitest";
import { validateExtraction } from "../../vision/VisionProvider";
import { boundsToRect } from "./crop";
import { deriveDesign } from "./design";
import { OCR_BUDGET_MS, buildLocalExtraction, withBudget } from "./localScan";
import type { OcrLine } from "./localScan";
import { chartRegion, detectBars, estimateBackground } from "./barDetect";

type RGB = [number, number, number];
const BG: RGB = [15, 23, 42];
const INDIGO: RGB = [99, 102, 241];
const AMBER: RGB = [245, 158, 11];

function paint(w: number, h: number, bg: RGB, rects: [number, number, number, number, RGB][]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) data.set([...bg, 255], p * 4);
  for (const [x0, y0, x1, y1, c] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set([...c, 255], (y * w + x) * 4);
  return { data, width: w, height: h };
}
const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
const word = (text: string, b: ReturnType<typeof box>, conf = 0.95) => ({ text, conf, box: b });
const line = (text: string, b: ReturnType<typeof box>, conf = 0.95): OcrLine => ({ text, conf, box: b, words: text.split(" ").map((t) => word(t, b, conf)) });

// 400x300 dark card, 4 bars on a baseline at y=230: tops 80, 110, 50, 140.
const BARS = [[60, 80], [140, 110], [220, 50], [300, 140]] as const;
const vertical = () => paint(400, 300, BG, BARS.map(([x, top], i) => [x, top, x + 40, 230, i === 2 ? AMBER : INDIGO] as [number, number, number, number, RGB]));
const labels = ["North", "South", "East", "West"];
const ocrFull = (): OcrLine[] => [
  line("Sales by region", box(60, 4, 230, 26)),
  line("FY2025", box(60, 28, 120, 40)),
  ...BARS.map(([x, top], i) => line(String([48, 62, 91, 35][i]), box(x + 8, top - 22, x + 32, top - 6))),
  ...BARS.map(([x], i) => line(labels[i]!, box(x - 2, 238, x + 42, 254))),
  line("Source: Internal data", box(60, 270, 200, 286)),
];

describe("detectBars", () => {
  it("finds coloured bars, their baseline and the background", () => {
    const d = detectBars(vertical())!;
    expect(d.orientation).toBe("vertical");
    expect(d.bars.map((b) => [b.left, b.right, b.top, b.bottom])).toEqual(BARS.map(([x, top]) => [x, x + 40, top, 230]));
    expect(d.bars[2]!.rgb).toEqual(AMBER);
    expect(estimateBackground(vertical()).map(Math.round)).toEqual(BG);
  });
  it("finds horizontal bars", () => {
    const img = paint(400, 300, BG, [[80, 40, 300, 80, INDIGO], [80, 110, 200, 150, INDIGO], [80, 180, 340, 220, INDIGO]]);
    const d = detectBars(img)!;
    expect(d.orientation).toBe("horizontal");
    expect(d.bars.map((b) => [b.top, b.right])).toEqual([[40, 300], [110, 200], [180, 340]]);
  });
  it("ignores grey chrome, single blobs and empty images", () => {
    expect(detectBars(paint(400, 300, BG, []))).toBeNull();
    expect(detectBars(paint(400, 300, BG, [[0, 0, 400, 40, [222, 225, 230]]]))).toBeNull();
    expect(detectBars(paint(400, 300, BG, [[100, 50, 160, 250, INDIGO]]))).toBeNull();
  });
  it("tolerates a value label drawn inside a bar", () => {
    const img = vertical();
    for (let y = 90; y < 100; y++) for (let x = 70; x < 90; x++) img.data.set([255, 255, 255, 255], (y * 400 + x) * 4);
    expect(detectBars(img)!.bars[0]!.top).toBe(80);
  });
  it("stops the chart region at the card edge, not at the image edge", () => {
    const page: RGB = [229, 231, 235];
    const img = paint(500, 400, page, [[50, 50, 450, 350, BG], ...BARS.map(([x, top]) => [x + 50, top + 50, x + 90, 280, INDIGO] as [number, number, number, number, RGB])]);
    const d = detectBars(img)!;
    const r = chartRegion(img, d.background, d.bars);
    expect(r.left).toBeGreaterThanOrEqual(49);
    expect(r.left).toBeLessThanOrEqual(52);
    expect(r.top).toBeGreaterThanOrEqual(49);
    expect(r.right).toBeLessThanOrEqual(451);
    expect(r.bottom).toBeLessThanOrEqual(351);
  });
});

describe("buildLocalExtraction", () => {
  it("reads title, labels, printed values, source and layout from pixels + OCR", () => {
    const raw = buildLocalExtraction(vertical(), ocrFull())!;
    expect(raw).toMatchObject({ chartType: "bar", title: "Sales by region", subtitle: "FY2025", sourceNote: "Source: Internal data", labels });
    const s = (raw.series as Record<string, unknown>[])[0]!;
    expect(s).toMatchObject({ values: [48, 62, 91, 35], valueSource: "printed" });
    expect((raw.style as Record<string, unknown>).showDataLabels).toBe(true);
    expect((raw.style as Record<string, unknown>).dataLabelPosition).toBe("outside-top");
    expect((raw.samplePoints as { bars: unknown[] }).bars).toHaveLength(4);
    expect(raw.elementBounds).toHaveLength(4); // one box per bar, so geometry verification also checks OCR digits
  });
  it("produces JSON the shared pipeline accepts, and sampling recovers exact colours", () => {
    const img = vertical();
    const { chart, warnings } = validateExtraction(buildLocalExtraction(img, ocrFull()));
    expect(warnings).toEqual([]);
    const rect = boundsToRect(chart!.chartBounds, img.width, img.height);
    const crop = img; // whole card is the chart here
    const { design, seriesColors } = deriveDesign(chart!, crop, { x: 0, y: 0, width: rect.width + rect.x, height: rect.height + rect.y }, { width: img.width, height: img.height });
    expect(design.background).toBe("#0F172A");
    expect(seriesColors[0]).toBe("#6366F1");
    expect(design.barColors).toEqual({ 2: "#F59E0B" });
  });
  it("falls back to 'Item n' labels and relative sizes when OCR gives nothing", () => {
    const raw = buildLocalExtraction(vertical(), [])!;
    expect(raw.labels).toEqual(["Item 1", "Item 2", "Item 3", "Item 4"]);
    const s = (raw.series as Record<string, unknown>[])[0]!;
    expect(s.values).toEqual([83.3, 66.7, 100, 50]); // lengths 150,120,180,90 of max 180
    expect(s.confidence).toBeLessThan(0.85);
  });
  it("calibrates from y-axis ticks when bars have no printed values", () => {
    const ocr = [line("0", box(30, 222, 46, 238)), line("100", box(22, 42, 50, 58)), line("Reach", box(60, 12, 140, 40))];
    const raw = buildLocalExtraction(vertical(), ocr)!;
    expect(raw.axis).toEqual({ baselinePx: 230, baselineValue: 0, topTickPx: 50, topTickValue: 100 });
    expect((raw.series as { topsPx: number[] }[])[0]!.topsPx).toEqual([80, 110, 50, 140]);
    expect((raw.style as Record<string, unknown>).showYAxis).toBe(true);
  });
  it("detects value labels inside bars and unit symbols", () => {
    const ocr = BARS.map(([x, top], i) => line(`${[12, 18, 25, 9][i]}%`, box(x + 8, top + 6, x + 32, top + 20)));
    const raw = buildLocalExtraction(vertical(), ocr)!;
    expect(raw.units).toEqual({ prefix: "", suffix: "%" });
    expect((raw.style as Record<string, unknown>).dataLabelPosition).toBe("inside-top");
  });
  it("returns null when there is no bar chart", () => {
    expect(buildLocalExtraction(paint(300, 200, BG, []), [])).toBeNull();
  });
});

describe("withBudget (OCR never blocks the scan)", () => {
  it("returns the fallback when the work is slower than the budget", async () => {
    const slow = new Promise<string>((r) => setTimeout(() => r("late"), 200));
    const started = Date.now();
    expect(await withBudget(slow, 30, "fallback")).toBe("fallback");
    expect(Date.now() - started).toBeLessThan(150);
  });
  it("returns the work's result when it finishes in time", async () => {
    expect(await withBudget(Promise.resolve("done"), 500, "fallback")).toBe("done");
  });
  it("propagates the work's own failure when it fails in time, and ignores one that fails after the budget", async () => {
    await expect(withBudget(Promise.reject(new Error("boom")), 500, "x")).rejects.toThrow("boom");
    const lateFail = new Promise<string>((_, rej) => setTimeout(() => rej(new Error("late")), 60));
    expect(await withBudget(lateFail, 10, "fallback")).toBe("fallback");
    await new Promise((r) => setTimeout(r, 100)); // no unhandled rejection
  });
  it("has a budget short enough to sit well inside the 12 s cloud guardrail", () => {
    expect(OCR_BUDGET_MS).toBeLessThanOrEqual(5000);
  });
});
