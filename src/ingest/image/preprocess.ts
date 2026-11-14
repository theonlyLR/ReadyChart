import { chartRegion, detectBars } from "./barDetect";
import type { PixelRect } from "./crop";
import type { LoadedScreenshot } from "./loadImage";

/** Longest side of the upscaled plot image. */
export const PLOT_MAX_DIM = 2400;
export const PLOT_UPSCALE = 2;
/** The plot crop never gets smaller than this on either side (tiny crops add nothing). */
const MIN_PLOT_PX = 80;
/** Breathing room around the detected chart area, as a share of its size. */
const PLOT_MARGIN = 0.03;

/**
 * Unsharp mask on RGB (alpha untouched): out = p + amount * (p - boxBlur3x3(p)). Brings back edge definition that
 * upscaling softens, so thin bars and small digits stay crisp for the vision model. Pure: works on plain RGBA data.
 */
export function sharpen(img: { data: Uint8ClampedArray; width: number; height: number }, amount = 0.7): void {
  const { width: w, height: h, data } = img;
  const src = new Uint8ClampedArray(data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            sum += src[(yy * w + xx) * 4 + c]!;
            n++;
          }
        }
        data[i + c] = Math.round(src[i + c]! + amount * (src[i + c]! - sum / n));
      }
    }
  }
}

/** The chart region to zoom into (detected locally from the bars), padded and clamped to the image. Null for non-bar charts. */
export function plotRegion(loaded: LoadedScreenshot): PixelRect | null {
  const det = detectBars(loaded.pixels);
  if (!det) return null;
  const r = chartRegion(loaded.pixels, det.background, det.bars);
  const mx = Math.round((r.right - r.left) * PLOT_MARGIN);
  const my = Math.round((r.bottom - r.top) * PLOT_MARGIN);
  const x = Math.max(0, r.left - mx);
  const y = Math.max(0, r.top - my);
  const width = Math.min(loaded.width, r.right + mx) - x;
  const height = Math.min(loaded.height, r.bottom + my) - y;
  return width < MIN_PLOT_PX || height < MIN_PLOT_PX ? null : { x, y, width, height };
}

export interface PlotImage {
  blob: Blob;
  /** Where the crop sits in the full screenshot, in full-image pixels. */
  rect: PixelRect;
  /** Output pixel size (after upscaling). */
  width: number;
  height: number;
}

/**
 * Image 2 for the vision model: a high-resolution, sharpened crop of the chart region, upscaled 2x with the browser's
 * high-quality (bicubic-class) resampling on an offscreen canvas. Dense labels, tiny percentages and 1-2 px slivers become
 * legible. Null when no chart region can be found (the full image alone is sent).
 */
export async function makePlotImage(loaded: LoadedScreenshot): Promise<PlotImage | null> {
  const rect = plotRegion(loaded);
  if (!rect) return null;
  const small = new OffscreenCanvas(rect.width, rect.height);
  const sctx = small.getContext("2d");
  if (!sctx) return null;
  sctx.putImageData(loaded.pixels, -rect.x, -rect.y, rect.x, rect.y, rect.width, rect.height);

  const scale = Math.min(PLOT_UPSCALE, PLOT_MAX_DIM / Math.max(rect.width, rect.height));
  const width = Math.max(1, Math.round(rect.width * scale));
  const height = Math.max(1, Math.round(rect.height * scale));
  const big = new OffscreenCanvas(width, height);
  const bctx = big.getContext("2d", { willReadFrequently: true });
  if (!bctx) return null;
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = "high";
  bctx.drawImage(small, 0, 0, width, height);
  const data = bctx.getImageData(0, 0, width, height);
  sharpen(data);
  bctx.putImageData(data, 0, 0);
  return { blob: await big.convertToBlob({ type: "image/png" }), rect, width, height };
}
