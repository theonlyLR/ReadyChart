import { luminance } from "../../engine/theme";
import { extractionToTable, validateExtraction } from "../../vision/VisionProvider";
import type { VisionProvider } from "../../vision/VisionProvider";
import { boundsToRect, cropScreenshot } from "./crop";
import { applyMeasuredColors, deriveDesign } from "./design";
import { verifyGeometry } from "./geometry";
import { loadScreenshot } from "./loadImage";
import type { LoadedScreenshot } from "./loadImage";
import { sampleDominantColors } from "./sampleColors";
import type { ScanResult } from "./scanTypes";

/** 0 = detecting bounds/type (request in flight), 1 = sampling the palette, 2 = reconstructing data. */
export type ScanStage = 0 | 1 | 2;

export class ScanError extends Error {}

/** The text colour the theme would pick on this background (so inside-bar labels can be told apart from fill). */
const autoInk = (background: string): string => (luminance(background) < 0.25 ? "#F8FAFC" : "#0F172A");

export interface ScanOptions {
  provider: VisionProvider;
  signal?: AbortSignal;
  onStage?: (stage: ScanStage) => void;
}

/**
 * Screenshot -> everything needed to rebuild the chart. Ask the vision model what the chart says and where its
 * pixels are, then crop and sample real colours locally. Pure of app state: the caller commits the result with
 * `applyScanResult` in one undoable step.
 */
export async function scanChart(image: Blob | LoadedScreenshot, opts: ScanOptions): Promise<ScanResult> {
  const { provider, signal, onStage } = opts;
  onStage?.(0);
  const loaded = "pixels" in image ? image : await loadScreenshot(image);
  const colors = sampleDominantColors(loaded.pixels);

  const raw = await provider.extractChart(loaded.blob, { width: loaded.width, height: loaded.height, colors: colors.map((c) => c.hex) }, signal);
  signal?.throwIfAborted();
  const { chart, warnings } = validateExtraction(raw);
  if (!chart) throw new ScanError(warnings.join(" ") || "Couldn't read a chart from that image.");

  onStage?.(1);
  const rect = boundsToRect(chart.chartBounds, loaded.width, loaded.height);
  const cropped = await cropScreenshot(loaded, rect);
  const sampled = deriveDesign(chart, cropped.pixels, rect, loaded);

  // Measure the real pixels in every element box: recover unreadable values from bar sizes, double-check OCR'd numbers
  // against them, and take text-safe median fill colours instead of a single sample point.
  const ink = sampled.design.textColor ?? (sampled.design.background ? autoInk(sampled.design.background) : null);
  const geo = verifyGeometry({ chart, crop: cropped.pixels, rect, full: loaded, background: sampled.design.background, ink });
  const { design, seriesColors } = applyMeasuredColors(sampled, geo.chart, geo.colors);

  onStage?.(2);
  const table = extractionToTable(geo.chart, colors);
  table.series.forEach((s, i) => {
    s.color = seriesColors[i] ?? s.color;
  });
  table.warnings.push(...warnings);
  return { chart: geo.chart, table, design, croppedBlob: cropped.blob, warnings: table.warnings };
}
