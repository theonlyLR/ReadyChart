import type { NormBounds, NormPoint } from "../../vision/VisionProvider";
import type { LoadedScreenshot } from "./loadImage";

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Normalised [ymin,xmin,ymax,xmax] (0..1000) -> whole-pixel rectangle inside a width x height image.
 * Rounds outward so a bar edge is never clipped; undefined bounds mean the full image.
 */
export function boundsToRect(bounds: NormBounds | undefined, width: number, height: number): PixelRect {
  if (!bounds) return { x: 0, y: 0, width, height };
  const [ymin, xmin, ymax, xmax] = bounds;
  const x0 = Math.max(0, Math.floor((xmin / 1000) * width));
  const y0 = Math.max(0, Math.floor((ymin / 1000) * height));
  const x1 = Math.min(width, Math.ceil((xmax / 1000) * width));
  const y1 = Math.min(height, Math.ceil((ymax / 1000) * height));
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

/** A point in the full image (0..1000) -> the same spot in the cropped image (0..1000). May fall outside 0..1000. */
export function pointToCrop(p: NormPoint, rect: PixelRect, fullWidth: number, fullHeight: number): NormPoint {
  return [(((p[0] / 1000) * fullWidth - rect.x) / rect.width) * 1000, (((p[1] / 1000) * fullHeight - rect.y) / rect.height) * 1000];
}

export interface CroppedScreenshot {
  rect: PixelRect;
  width: number;
  height: number;
  pixels: ImageData;
  /** Local PNG of the crop: reused as the onion-skin overlay. */
  blob: Blob;
}

/** Crop on an offscreen canvas (no external URLs, so the canvas is never tainted). */
export async function cropScreenshot(loaded: LoadedScreenshot, rect: PixelRect): Promise<CroppedScreenshot> {
  const canvas = new OffscreenCanvas(rect.width, rect.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Couldn't crop the image.");
  ctx.putImageData(loaded.pixels, -rect.x, -rect.y, rect.x, rect.y, rect.width, rect.height);
  const pixels = ctx.getImageData(0, 0, rect.width, rect.height);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return { rect, width: rect.width, height: rect.height, pixels, blob };
}
