import type { ChartDocument } from "../model/types";
import { computeFrameState } from "../engine/motion/frameState";
import { buildTimeline } from "../engine/motion/timeline";
import { computeLayout } from "../engine/layout";
import { buildSceneFromLayout } from "../engine/scene";
import type { TextMeasurer } from "../engine/textMeasure";
import { fontStack } from "../engine/fonts";
import { drawScene, loadImages } from "../render/canvasRenderer";
import type { DrawableImage } from "../render/canvasRenderer";

/**
 * Evenly spaced sample times covering one loop [0, totalMs). The last frame sits one step before the loop
 * seam, so playing the file end-to-start repeats exactly like the live timeline.
 */
export function frameTimes(totalMs: number, fps: number): number[] {
  const count = Math.max(1, Math.round((totalMs * fps) / 1000));
  return Array.from({ length: count }, (_, i) => (i * totalMs) / count);
}

/** Per-frame delays that sum exactly to the loop length once rounded to `unitMs` (cumulative rounding, no drift). */
export function frameDelays(totalMs: number, count: number, unitMs: number): number[] {
  const edge = (i: number) => Math.round(((i * totalMs) / count) / unitMs);
  return Array.from({ length: count }, (_, i) => edge(i + 1) - edge(i));
}

export interface FrameRenderer {
  width: number;
  height: number;
  totalMs: number;
  /** t at which every hero track has settled: the palette sample point for GIF. */
  settledMs: number;
  /** Draws computeFrameState(doc, t) and returns its pixels. The returned buffer is fresh: drop it after encoding. */
  render(tMs: number): ImageData;
}

/**
 * Offscreen frame source shared by the export worker and tests. Layout is time-invariant, so it is computed once;
 * every frame is buildSceneFromLayout(computeFrameState(doc, t)) drawn onto one reused OffscreenCanvas.
 */
export async function createFrameRenderer(doc: ChartDocument, scale: number, measurer: TextMeasurer): Promise<FrameRenderer> {
  const w = Math.round(doc.canvas.width * scale);
  const h = Math.round(doc.canvas.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas unavailable");
  const layout = computeLayout(doc, measurer);
  const finalNodes = buildSceneFromLayout(doc, layout, measurer);
  const images: ReadonlyMap<string, DrawableImage> = await loadImages(finalNodes);
  const tl = buildTimeline(doc);
  return {
    width: w,
    height: h,
    totalMs: tl.totalMs,
    settledMs: tl.heroEndMs,
    render(tMs) {
      ctx.clearRect(0, 0, w, h);
      drawScene(ctx, buildSceneFromLayout(doc, layout, measurer, computeFrameState(doc, tMs)), { scale, images, fontFamily: fontStack(doc.brand.fontFamily) });
      return ctx.getImageData(0, 0, w, h);
    },
  };
}
