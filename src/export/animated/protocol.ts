import type { ChartDocument } from "../../model/types";

export type WorkerFormat = "gif" | "awebp";

export interface WorkerRequest {
  doc: ChartDocument;
  format: WorkerFormat;
  fps: number;
  scale: number;
  /** 0..1, WebP only. */
  quality: number;
  /** Abort as soon as the output would exceed this many bytes (used by Fit Under 5 MB). */
  maxBytes?: number;
  /** CSS family name the buffers below are registered under (the doc's brand font). */
  fontFamily: string;
  fonts: { weight: number; data: ArrayBuffer }[];
}

export type WorkerMessage =
  | { type: "progress"; done: number; total: number }
  | { type: "done"; buffer: ArrayBuffer; mime: string }
  | { type: "over"; bytes: number }
  | { type: "error"; message: string };
