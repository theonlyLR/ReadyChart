import type { SceneNode } from "../engine/types";
import { drawScene, loadImages } from "../render/canvasRenderer";

export type RasterFormat = "png" | "jpg" | "webp";

const MIME: Record<RasterFormat, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

export interface RasterOptions {
  format: RasterFormat;
  scale: number;
  /** 0..1 for jpg/webp. */
  quality?: number;
  width: number;
  height: number;
  transparent: boolean;
  fontFamily?: string;
}

/** Offscreen raster export. JPG is always opaque; WebP falls back to the WASM encoder where the browser can't. */
export async function rasterize(nodes: SceneNode[], o: RasterOptions): Promise<Blob> {
  const w = Math.round(o.width * o.scale);
  const h = Math.round(o.height * o.scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");

  if (o.format === "jpg" && o.transparent) {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, w, h);
  }
  drawScene(ctx, nodes, { scale: o.scale, images: await loadImages(nodes), fontFamily: o.fontFamily });

  const quality = o.quality ?? 0.92;
  const blob = await canvas.convertToBlob({ type: MIME[o.format], quality });
  if (o.format === "webp" && blob.type !== MIME.webp) {
    // Safari et al. silently return PNG for webp requests.
    const { default: encode } = await import("@jsquash/webp/encode");
    const out = await encode(ctx.getImageData(0, 0, w, h), { quality: quality * 100 });
    return new Blob([out], { type: MIME.webp });
  }
  return blob;
}
