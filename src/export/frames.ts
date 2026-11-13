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

/** Delays (in `unitMs` steps) for frames starting at `times`; the last frame lasts until `endMs`. Cumulative rounding, no drift. */
export function delaysFor(times: number[], endMs: number, unitMs: number): number[] {
  const edge = (i: number) => Math.round((i < times.length ? times[i]! : endMs) / unitMs);
  return times.map((_, i) => edge(i + 1) - edge(i));
}

/**
 * Frame plan for an export. Loop: one full cycle [0, totalMs). No loop: plays once and stops, matching live
 * playback (which halts at holdEndMs), so the file ends on the held final frame and never shows the loop-reset fade.
 */
export function playbackPlan(totalMs: number, holdEndMs: number, fps: number, loop: boolean): { times: number[]; endMs: number } {
  if (loop) return { times: frameTimes(totalMs, fps), endMs: totalMs };
  const last = holdEndMs >= totalMs ? totalMs - 1e-3 : holdEndMs; // t = totalMs would wrap to 0
  const count = Math.max(2, Math.round((last * fps) / 1000) + 1);
  return { times: Array.from({ length: count }, (_, i) => (i * last) / (count - 1)), endMs: last + 1000 / fps };
}

export interface FrameRenderer {
  width: number;
  height: number;
  totalMs: number;
  /** End of the hold phase: where non-looping playback stops. */
  holdEndMs: number;
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
    holdEndMs: tl.holdEndMs,
    settledMs: tl.heroEndMs,
    render(tMs) {
      ctx.clearRect(0, 0, w, h);
      drawScene(ctx, buildSceneFromLayout(doc, layout, measurer, computeFrameState(doc, tMs)), { scale, images, fontFamily: fontStack(doc.brand.fontFamily) });
      return ctx.getImageData(0, 0, w, h);
    },
  };
}
