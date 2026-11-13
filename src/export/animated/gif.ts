import { GIFEncoder, applyPalette, quantize } from "gifenc";
import type { Palette } from "gifenc";
import { frameDelays } from "../frames";
import type { FrameRenderer } from "../frames";

export interface GifOptions {
  fps: number;
  transparent: boolean;
  frameTimes: number[];
  maxBytes?: number;
  onProgress?: (done: number, total: number) => void;
}

export type GifResult = { bytes: Uint8Array } | { over: number };

/**
 * Streaming GIF: one locked 256-colour palette is sampled once from the fully built frame (t = settledMs),
 * then every frame is `render -> applyPalette -> writeFrame -> drop`. Only the encoded bytes accumulate.
 */
export function encodeGif(r: FrameRenderer, o: GifOptions): GifResult {
  const { width, height } = r;
  const times = o.frameTimes;
  const delaysCs = frameDelays(r.totalMs, times.length, 10).map((cs) => Math.max(2, cs));
  const fmt = o.transparent ? "rgba4444" : "rgb565";

  // Lock the palette. Opaque charts reserve the last slot for "unchanged pixel" transparency between frames.
  const sample = r.render(r.settledMs);
  const palette: Palette = quantize(sample.data, 255, o.transparent ? { format: "rgba4444", oneBitAlpha: true, clearAlpha: true, clearAlphaThreshold: 0 } : { format: "rgb565" });
  let clearIdx = palette.findIndex((c) => c.length > 3 && c[3] === 0);
  if (clearIdx < 0) {
    palette.push(o.transparent ? [0, 0, 0, 0] : [0, 0, 0]);
    clearIdx = palette.length - 1;
  }
  const rgbPalette: Palette = palette.map((c) => [c[0]!, c[1]!, c[2]!]);

  const enc = GIFEncoder({ initialCapacity: 1 << 16 });
  let prev: Uint8Array | null = null;
  for (let i = 0; i < times.length; i++) {
    const idx = applyPalette(r.render(times[i]!).data, palette, fmt);
    const delay = delaysCs[i]! * 10;
    if (o.transparent) {
      // Index `clearIdx` is real transparency here, so each frame replaces the last (dispose = restore to background).
      enc.writeFrame(idx, width, height, { palette: i === 0 ? rgbPalette : undefined, delay, transparent: true, transparentIndex: clearIdx, dispose: 2 });
    } else {
      let out = idx;
      if (prev) {
        // Pixels identical to the previous frame become transparent and compress to nothing (dispose = leave in place).
        out = new Uint8Array(idx.length);
        for (let p = 0; p < idx.length; p++) out[p] = idx[p] === prev[p] ? clearIdx : idx[p]!;
      }
      enc.writeFrame(out, width, height, { palette: i === 0 ? rgbPalette : undefined, delay, transparent: i > 0, transparentIndex: clearIdx, dispose: 1 });
      prev = idx;
    }
    const size = enc.bytesView().length;
    if (o.maxBytes !== undefined && size > o.maxBytes) return { over: size };
    o.onProgress?.(i + 1, times.length);
  }
  enc.finish();
  return { bytes: enc.bytes() };
}
