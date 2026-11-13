import type { ChartDocument } from "../model/types";
import { buildScene } from "../engine/scene";
import { getMeasurer } from "../render/measurer";
import { getEmbeddedFontCss } from "./fontEmbed";
import { rasterize } from "./raster";
import { serializeSvg } from "./svgSerialize";

export type ExportFormat = "svg" | "png" | "jpg" | "webp";

export interface ExportOptions {
  format: ExportFormat;
  scale: number;
}

async function ensureFonts(): Promise<void> {
  await Promise.all([document.fonts.load("400 16px Inter"), document.fonts.load("600 16px Inter")]);
}

/**
 * The single static export path: Flight Check previews, file-size estimates and downloads all come from here,
 * built from the same buildScene() the live canvas uses.
 */
export async function renderStatic(doc: ChartDocument, opts: ExportOptions): Promise<Blob> {
  await ensureFonts();
  const { nodes } = buildScene(doc, getMeasurer());
  const { width, height, transparent } = doc.canvas;
  if (opts.format === "svg") {
    const svg = serializeSvg(nodes, width, height, await getEmbeddedFontCss());
    return new Blob([svg], { type: "image/svg+xml" });
  }
  return rasterize(nodes, { format: opts.format, scale: opts.scale, width, height, transparent });
}
