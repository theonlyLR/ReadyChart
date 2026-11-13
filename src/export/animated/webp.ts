import encode from "@jsquash/webp/encode";
import { delaysFor } from "../frames";
import type { FrameRenderer } from "../frames";
import { muxAnimatedWebp } from "../webpMux";
import type { MuxFrame } from "../webpMux";

export interface AnimatedWebpOptions {
  quality: number;
  transparent: boolean;
  frameTimes: number[];
  endMs?: number;
  /** false = ANIM loop count 1 (play once). Default true. */
  loop?: boolean;
  maxBytes?: number;
  onProgress?: (done: number, total: number) => void;
}

export type WebpResult = { bytes: Uint8Array } | { over: number };

/** `render -> jSquash still encode -> release`, then one RIFF mux pass. Exact millisecond durations (cumulative rounding). */
export async function encodeAnimatedWebp(r: FrameRenderer, o: AnimatedWebpOptions): Promise<WebpResult> {
  const times = o.frameTimes;
  const durations = delaysFor(times, o.endMs ?? r.totalMs, 1);
  const frames: MuxFrame[] = [];
  let bytes = 0;
  for (let i = 0; i < times.length; i++) {
    const still = new Uint8Array(await encode(r.render(times[i]!), { quality: Math.round(o.quality * 100) }));
    frames.push({ webp: still, durationMs: durations[i]! });
    bytes += still.length;
    if (o.maxBytes !== undefined && bytes > o.maxBytes) return { over: bytes };
    o.onProgress?.(i + 1, times.length);
  }
  return { bytes: muxAnimatedWebp(frames, r.width, r.height, o.transparent, o.loop === false ? 1 : 0) };
}
