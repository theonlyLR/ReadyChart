import type { ChartDocument } from "../model/types";
import { buildScene } from "../engine/scene";
import { getMeasurer } from "../render/measurer";
import { getEmbeddedFontCss, getFontBuffers } from "./fontEmbed";
import type { WorkerMessage, WorkerRequest } from "./animated/protocol";
import { rasterize } from "./raster";
import { serializeSvg } from "./svgSerialize";

export type StaticFormat = "svg" | "png" | "jpg" | "webp";
export type AnimatedFormat = "gif" | "awebp";
export type ExportFormat = StaticFormat | AnimatedFormat;
export const isAnimated = (f: ExportFormat): f is AnimatedFormat => f === "gif" || f === "awebp";

export interface ExportOptions {
  format: StaticFormat;
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

export interface AnimatedOptions {
  format: AnimatedFormat;
  fps: number;
  scale: number;
  /** 0..1, WebP only. */
  quality?: number;
  /** Stop early (result.over) once the output would exceed this. */
  maxBytes?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export type AnimatedResult = { blob: Blob } | { over: number };

/**
 * Animated export: the frame loop and encoders run in a WebWorker (renderFrame(t) -> encodeFrame -> release),
 * so the UI thread never holds more than one frame. Aborting terminates the worker.
 */
export async function renderAnimated(doc: ChartDocument, o: AnimatedOptions): Promise<AnimatedResult> {
  const fonts = await getFontBuffers();
  if (o.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const worker = new Worker(new URL("./animated/worker.ts", import.meta.url), { type: "module" });
  return new Promise<AnimatedResult>((resolve, reject) => {
    const finish = () => {
      o.signal?.removeEventListener("abort", onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      finish();
      reject(new DOMException("Aborted", "AbortError"));
    };
    o.signal?.addEventListener("abort", onAbort);
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.type === "progress") return o.onProgress?.(m.done, m.total);
      finish();
      if (m.type === "done") resolve({ blob: new Blob([m.buffer], { type: m.mime }) });
      else if (m.type === "over") resolve({ over: m.bytes });
      else reject(new Error(m.message));
    };
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message || "Export worker failed"));
    };
    const req: WorkerRequest = { doc, format: o.format, fps: o.fps, scale: o.scale, quality: o.quality ?? 0.8, maxBytes: o.maxBytes, fonts };
    worker.postMessage(req, fonts.map((f) => f.data));
  });
}
