import { extractionToTable, validateExtraction } from "../../vision/VisionProvider";
import type { VisionProvider } from "../../vision/VisionProvider";
import { boundsToRect, cropScreenshot } from "./crop";
import { deriveDesign } from "./design";
import { loadScreenshot } from "./loadImage";
import type { LoadedScreenshot } from "./loadImage";
import { sampleDominantColors } from "./sampleColors";
import type { ScanResult } from "./scanTypes";

/** 0 = detecting bounds/type (request in flight), 1 = sampling the palette, 2 = reconstructing data. */
export type ScanStage = 0 | 1 | 2;

export class ScanError extends Error {}

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
  const { design, seriesColors } = deriveDesign(chart, cropped.pixels, rect, loaded);

  onStage?.(2);
  const table = extractionToTable(chart, colors);
  table.series.forEach((s, i) => {
    s.color = seriesColors[i] ?? s.color;
  });
  table.warnings.push(...warnings);
  return { chart, table, design, croppedBlob: cropped.blob, warnings: table.warnings };
}
