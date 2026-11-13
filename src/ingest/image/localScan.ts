import { parseUnitCell } from "../parseTable";
import { VisionError } from "../../vision/prompt";
import type { VisionProvider } from "../../vision/VisionProvider";
import { chartRegion, detectBars, hasGridlines, inkColor, rgbToHex } from "./barDetect";
import type { Box, DetectedBar } from "./barDetect";
import { loadScreenshot } from "./loadImage";
import type { PixelBuffer } from "./sampleColors";

/**
 * Offline scanner: when no vision service answers, read the screenshot on-device. Pixels give the bars (position,
 * colour, relative size) and the chart's own area; tesseract.js OCR gives the title, labels and printed numbers.
 * It emits the SAME JSON shape the vision models do, so crop, 5x5 colour sampling and the atomic document update run
 * unchanged. Bars only (vertical or horizontal): that is what it can recover reliably without a model.
 */

export interface OcrWord {
  text: string;
  /** 0..1 */
  conf: number;
  box: Box;
}
export interface OcrLine {
  text: string;
  conf: number;
  box: Box;
  words: OcrWord[];
}
export type OcrFn = (image: Blob, signal?: AbortSignal) => Promise<OcrLine[]>;

/** tesseract.js OCR in a throwaway worker (WASM + English data are fetched on first use, then cached by the browser). */
export const tesseractOcr: OcrFn = async (image, signal) => {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  const stop = () => void worker.terminate();
  signal?.addEventListener("abort", stop, { once: true });
  try {
    const { data } = await worker.recognize(image, {}, { blocks: true });
    const box = (b: { x0: number; y0: number; x1: number; y1: number }): Box => ({ left: b.x0, top: b.y0, right: b.x1, bottom: b.y1 });
    return (data.blocks ?? [])
      .flatMap((b) => b.paragraphs)
      .flatMap((p) => p.lines)
      .map((l) => ({
        text: l.text.trim(),
        conf: l.confidence / 100,
        box: box(l.bbox),
        words: l.words.map((w) => ({ text: w.text.trim(), conf: w.confidence / 100, box: box(w.bbox) })).filter((w) => w.text !== ""),
      }))
      .filter((l) => l.text !== "");
  } finally {
    signal?.removeEventListener("abort", stop);
    await worker.terminate().catch(() => {});
  }
};

const cx = (b: Box): number => (b.left + b.right) / 2;
const cy = (b: Box): number => (b.top + b.bottom) / 2;
const height = (b: Box): number => b.bottom - b.top;
const inside = (b: Box, r: Box): boolean => cx(b) >= r.left && cx(b) <= r.right && cy(b) >= r.top && cy(b) <= r.bottom;
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const numeric = (w: OcrWord) => (/\d/.test(w.text) ? parseUnitCell(w.text) : null);
const hasNumber = (w: OcrWord): boolean => typeof numeric(w)?.value === "number";
const hasLetters = (t: string): boolean => /[A-Za-z]{2,}/.test(t);

function mostCommon(xs: string[]): string {
  const n = new Map<string, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

/** Words on the first text line of a region, left to right (a wrapped second line is the footer, not the label). */
function firstLine(ws: OcrWord[]): string {
  if (ws.length === 0) return "";
  const sorted = [...ws].sort((a, b) => cy(a.box) - cy(b.box));
  const first = sorted[0]!;
  return sorted
    .filter((w) => Math.abs(cy(w.box) - cy(first.box)) <= height(first.box) * 0.7)
    .sort((a, b) => a.box.left - b.box.left)
    .map((w) => w.text)
    .join(" ");
}

const norm = (v: number, size: number): number => Math.round(Math.min(1000, Math.max(0, (v / size) * 1000)));

/** Pixels + OCR lines -> the vision JSON shape, or null when no bar chart is found. Pure and unit tested. */
export function buildLocalExtraction(img: PixelBuffer, lines: OcrLine[]): Record<string, unknown> | null {
  const det = detectBars(img);
  if (!det) return null;
  const { bars, orientation, background: bg } = det;
  const vertical = orientation === "vertical";
  const { width: W, height: H } = img;
  const n = bars.length;
  const region = chartRegion(img, bg, bars);

  const len = (b: DetectedBar) => (vertical ? b.bottom - b.top : b.right - b.left);
  const thick = (b: DetectedBar) => (vertical ? b.right - b.left : b.bottom - b.top);
  const centre = (b: DetectedBar) => (vertical ? (b.left + b.right) / 2 : (b.top + b.bottom) / 2);
  const baseline = vertical ? Math.max(...bars.map((b) => b.bottom)) : Math.min(...bars.map((b) => b.left));
  const pitch = n > 1 ? median(bars.slice(1).map((b, i) => centre(b) - centre(bars[i]!))) : thick(bars[0]!) * 1.5;

  const words = lines.flatMap((l) => l.words).filter((w) => inside(w.box, region));
  const textLines = lines.filter((l) => inside(l.box, region));

  // --- category labels -------------------------------------------------------------------------
  const labels = bars.map((b, i) => {
    const near = words.filter((w) => {
      const along = vertical ? cx(w.box) : cy(w.box);
      if (Math.abs(along - centre(b)) > pitch / 2) return false;
      return vertical ? cy(w.box) > baseline && cy(w.box) < baseline + Math.max(height(w.box) * 3, H * 0.12) : cx(w.box) < baseline;
    });
    return firstLine(near) || `Item ${i + 1}`;
  });
  const labelled = bars.filter((_, i) => !labels[i]!.startsWith("Item ")).length;

  // --- printed value labels ---------------------------------------------------------------------
  const usedAsValue = new Set<OcrWord>();
  const printed = bars.map((b) => {
    const slack = thick(b) * 0.3;
    const cands = words.filter((w) => {
      if (!hasNumber(w)) return false;
      if (vertical) return cx(w.box) >= b.left - slack && cx(w.box) <= b.right + slack && cy(w.box) >= b.top - H * 0.1 && cy(w.box) <= b.top + len(b) * 0.4;
      return cy(w.box) >= b.top - slack && cy(w.box) <= b.bottom + slack && cx(w.box) >= b.right - len(b) * 0.4 && cx(w.box) <= b.right + W * 0.2;
    });
    const end = vertical ? b.top : b.right;
    const best = [...cands].sort((a, c) => Math.abs((vertical ? cy(a.box) : cx(a.box)) - end) - Math.abs((vertical ? cy(c.box) : cx(c.box)) - end))[0];
    if (best) usedAsValue.add(best);
    return best ?? null;
  });
  const printedCount = printed.filter(Boolean).length;
  const allPrinted = printedCount === n;
  const insideLabels = printed.filter((w, i) => w && (vertical ? cy(w.box) > bars[i]!.top : cx(w.box) < bars[i]!.right)).length;

  // --- value axis ticks (vertical charts) ---------------------------------------------------------
  const left = Math.min(...bars.map((b) => b.left));
  const ticks = vertical
    ? words.filter((w) => hasNumber(w) && !usedAsValue.has(w) && cx(w.box) < left && cy(w.box) >= region.top && cy(w.box) <= baseline + 12).sort((a, b) => cy(a.box) - cy(b.box))
    : [];
  const axis = ticks.length >= 2 && cy(ticks[ticks.length - 1]!.box) !== cy(ticks[0]!.box) ? { baselinePx: cy(ticks[ticks.length - 1]!.box), baselineValue: numeric(ticks[ticks.length - 1]!)!.value as number, topTickPx: cy(ticks[0]!.box), topTickValue: numeric(ticks[0]!)!.value as number } : undefined;

  // --- values -------------------------------------------------------------------------------------
  const maxLen = Math.max(...bars.map(len));
  let series: Record<string, unknown>;
  const cells = (allPrinted ? printed : ticks).map((w) => numeric(w!)!);
  if (allPrinted) {
    series = {
      name: "Value",
      values: printed.map((w) => numeric(w!)!.value),
      valueSource: "printed",
      confidence: Math.min(...printed.map((w) => w!.conf)),
      confidences: printed.map((w) => Math.min(0.97, Math.max(0, w!.conf))),
    };
  } else if (axis) {
    series = { name: "Value", values: bars.map(() => null), valueSource: "estimated", confidence: 0.9, topsPx: bars.map((b) => b.top) };
  } else {
    // No printed numbers and no axis: only relative sizes are knowable. Marked low-confidence so the user checks them.
    series = { name: "Relative size", values: bars.map((b) => Math.round((len(b) / maxLen) * 1000) / 10), valueSource: "estimated", confidence: 0.5 };
  }
  series.color = rgbToHex(bars[0]!.rgb);

  // --- text ---------------------------------------------------------------------------------------
  const minTop = Math.min(...bars.map((b) => b.top));
  const above = textLines.filter((l) => l.box.bottom <= minTop - 2 && hasLetters(l.text));
  const title = [...above].sort((a, b) => height(b.box) - height(a.box))[0];
  const subtitle = title
    ? above.filter((l) => l !== title && l.box.top >= title.box.bottom - 2 && height(l.box) <= height(title.box) && l.box.top - title.box.bottom <= height(title.box) * 3).sort((a, b) => a.box.top - b.box.top)[0]
    : undefined;
  const belowBars = Math.max(...bars.map((b) => b.bottom));
  const source = textLines.find((l) => l.box.top >= belowBars && /\b(source|via)\b/i.test(l.text));

  // --- units --------------------------------------------------------------------------------------
  const unitCells = cells.length ? cells : [];
  const prefix = mostCommon(unitCells.map((c) => c.prefix).filter(Boolean)).slice(0, 3);
  const suffix = mostCommon(unitCells.map((c) => `${c.sym}${c.mag}`).filter(Boolean)).slice(0, 3);

  // --- where to look, for the shared crop + 5x5 colour sampling ---------------------------------------
  const spot = (b: DetectedBar): [number, number] => {
    const [x, y] = vertical ? [(b.left + b.right) / 2, b.top + len(b) * 0.65] : [b.left + len(b) * 0.35, (b.top + b.bottom) / 2];
    return [norm(x, W), norm(y, H)];
  };
  const ink = inkColor(img, (title ?? textLines.find((l) => hasLetters(l.text)))?.box ?? { left: 0, top: 0, right: 0, bottom: 0 }, bg);

  return {
    chartType: vertical ? "bar" : "horizontal-bar",
    title: title?.text ?? "",
    subtitle: subtitle?.text ?? "",
    sourceNote: source?.text ?? "",
    labels,
    units: { prefix, suffix },
    series: [series],
    axis,
    chartBounds: [norm(region.top, H), norm(region.left, W), norm(region.bottom, H), norm(region.right, W)],
    samplePoints: { background: [norm(region.left + 6, W), norm(region.top + 6, H)], series: [spot(bars[0]!)], bars: bars.map(spot) },
    style: {
      showXAxis: labelled >= Math.ceil(n / 2),
      showYAxis: !!axis,
      showGridlines: vertical ? hasGridlines(img, bg, bars) : undefined,
      showDataLabels: printedCount >= Math.ceil(n / 2),
      dataLabelPosition: insideLabels > printedCount / 2 ? "inside-top" : "outside-top",
      textColor: ink ? rgbToHex(ink) : undefined,
    },
  };
}

/** VisionProvider that never leaves the device. OCR trouble (offline, blocked) degrades to pixels-only, never throws. */
export function createLocalProvider(ocr: OcrFn = tesseractOcr): VisionProvider {
  return {
    name: "On-device",
    async extractChart(image, _hints, signal) {
      const loaded = await loadScreenshot(image);
      signal?.throwIfAborted();
      let lines: OcrLine[] = [];
      try {
        lines = await ocr(loaded.blob, signal);
      } catch (e) {
        if (signal?.aborted) throw e;
        console.warn("[scan] on-device OCR unavailable; reading bars from pixels only", e);
      }
      const raw = buildLocalExtraction(loaded.pixels, lines);
      if (!raw) throw new VisionError("We couldn't find bars in that screenshot. Try a clearer crop, or paste the numbers with ⌘V.", "no_chart");
      return raw;
    },
  };
}
