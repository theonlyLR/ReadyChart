import { fitWithin } from "../../brand/logoIngest";

export const SCREENSHOT_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const SCREENSHOT_MAX_BYTES = 10 * 1024 * 1024;
/** Longest side of the working bitmap. Keeps sampling fast and the vision upload small. */
export const SCREENSHOT_MAX_DIM = 1600;

/** Returns an error message, or null when the file is acceptable. */
export function validateScreenshot(type: string, size: number): string | null {
  if (!(SCREENSHOT_MIME_TYPES as readonly string[]).includes(type)) return "Screenshot must be a PNG, JPG or WebP image.";
  if (size === 0) return "Image file is empty.";
  if (size > SCREENSHOT_MAX_BYTES) return "Image must be 10 MB or smaller.";
  return null;
}

export interface LoadedScreenshot {
  width: number;
  height: number;
  pixels: ImageData;
  /** Downscaled PNG kept as a local Blob (never an external URL), reused for display and the vision upload. */
  blob: Blob;
}

/** Decode a local file/clipboard blob onto an offscreen canvas, downscaled to SCREENSHOT_MAX_DIM. */
export async function loadScreenshot(file: Blob): Promise<LoadedScreenshot> {
  const err = validateScreenshot(file.type, file.size);
  if (err) throw new Error(err);
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, SCREENSHOT_MAX_DIM);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Couldn't read the image.");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return { width, height, pixels, blob };
  } finally {
    bitmap.close();
  }
}
