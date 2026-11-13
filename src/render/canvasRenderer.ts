import { FONT_FAMILY } from "../engine/types";
import type { SceneNode } from "../engine/types";

export type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
export type DrawableImage = CanvasImageSource & { width: number; height: number };

export interface DrawOptions {
  /** Export scale (1, 1.5, 2 ...). */
  scale: number;
  /** Pre-decoded logo bitmaps keyed by data URL. Images without an entry are skipped (never fetched). */
  images?: ReadonlyMap<string, DrawableImage>;
  /** Font stack for text (defaults to Inter). */
  fontFamily?: string;
}

const ALIGN = { start: "left", middle: "center", end: "right" } as const;

/** Rasterises the scene model — same nodes the SVG renderer consumes, so output can't drift. */
export function drawScene(ctx: Ctx2D, nodes: SceneNode[], opts: DrawOptions): void {
  ctx.save();
  ctx.scale(opts.scale, opts.scale);
  for (const n of nodes) {
    ctx.save();
    ctx.globalAlpha = n.opacity ?? 1;
    switch (n.kind) {
      case "rect":
        ctx.fillStyle = n.fill;
        ctx.fillRect(n.x, n.y, n.width, n.height);
        break;
      case "path": {
        if (n.tx || n.ty) ctx.translate(n.tx ?? 0, n.ty ?? 0);
        const p = new Path2D(n.d);
        if (n.fill) {
          ctx.fillStyle = n.fill;
          ctx.fill(p);
        }
        if (n.stroke) {
          ctx.strokeStyle = n.stroke;
          ctx.lineWidth = n.strokeWidth ?? 1;
          ctx.lineJoin = n.linejoin ?? "miter";
          ctx.stroke(p);
        }
        break;
      }
      case "line":
        ctx.strokeStyle = n.stroke;
        ctx.lineWidth = n.strokeWidth;
        ctx.beginPath();
        ctx.moveTo(n.x1, n.y1);
        ctx.lineTo(n.x2, n.y2);
        ctx.stroke();
        break;
      case "text":
        ctx.font = `${n.fontWeight} ${n.fontSize}px ${opts.fontFamily ?? FONT_FAMILY}`;
        ctx.fillStyle = n.fill;
        ctx.textAlign = ALIGN[n.anchor];
        ctx.textBaseline = "alphabetic";
        if (n.rotate) {
          ctx.translate(n.x, n.y);
          ctx.rotate((n.rotate * Math.PI) / 180);
          ctx.fillText(n.text, 0, 0);
        } else ctx.fillText(n.text, n.x, n.y);
        break;
      case "image": {
        const img = opts.images?.get(n.href);
        if (!img) break;
        const k = Math.min(n.width / img.width, n.height / img.height);
        const w = img.width * k;
        const h = img.height * k;
        ctx.drawImage(img, n.x + (n.width - w) / 2, n.y + (n.height - h) / 2, w, h);
        break;
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

/** Decode data-URL logos to bitmaps. Anything that isn't a data: URL is refused (tainted-canvas guard). */
export async function loadImages(nodes: SceneNode[]): Promise<Map<string, DrawableImage>> {
  const out = new Map<string, DrawableImage>();
  for (const n of nodes) {
    if (n.kind !== "image" || out.has(n.href) || !n.href.startsWith("data:")) continue;
    const blob = await (await fetch(n.href)).blob();
    out.set(n.href, await createImageBitmap(blob));
  }
  return out;
}
