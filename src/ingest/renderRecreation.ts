import { renderStatic } from "../export/pipeline";
import type { ChartDocument } from "../model/types";

/** Longest side of the images sent to the critique pass. */
const MAX_SIDE = 1000;

/**
 * Render the reconstructed chart offscreen with the exact export pipeline (same scene as the live canvas), then fit it
 * to the cropped original's pixel size. The document snaps to a preset aspect ratio, so this stretches it back to the
 * original's proportions: both images then line up element for element, like the Compare Original overlay does.
 */
export async function renderRecreation(doc: ChartDocument, original: { width: number; height: number }): Promise<Blob> {
  const png = await renderStatic(doc, { format: "png", scale: Math.min(1, MAX_SIDE / Math.max(doc.canvas.width, doc.canvas.height)) });
  const k = Math.min(1, MAX_SIDE / Math.max(original.width, original.height));
  const w = Math.max(1, Math.round(original.width * k));
  const h = Math.max(1, Math.round(original.height * k));
  const bitmap = await createImageBitmap(png);
  try {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, w, h);
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    bitmap.close();
  }
}
