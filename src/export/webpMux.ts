/**
 * Minimal animated-WebP muxer. jSquash only encodes stills, so each frame is encoded as a still WebP and its
 * bitstream chunks (ALPH + VP8/VP8L) are re-wrapped as ANMF frames inside a VP8X/ANIM container.
 */

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const u24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];

function chunk(fourcc: string, payload: Uint8Array | number[]): Uint8Array {
  const len = payload.length;
  const out = new Uint8Array(8 + len + (len & 1));
  out.set(ascii(fourcc), 0);
  out.set(u32(len), 4);
  out.set(payload, 8);
  return out;
}

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** Raw (header + padded payload) chunks of a still WebP that make up the image data, VP8X dropped. */
export function frameDataChunks(still: Uint8Array): Uint8Array {
  const tag = (o: number) => String.fromCharCode(still[o]!, still[o + 1]!, still[o + 2]!, still[o + 3]!);
  if (still.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WEBP") throw new Error("Not a WebP file");
  const keep: Uint8Array[] = [];
  let o = 12;
  while (o + 8 <= still.length) {
    const len = still[o + 4]! | (still[o + 5]! << 8) | (still[o + 6]! << 16) | (still[o + 7]! * 2 ** 24);
    const end = o + 8 + len + (len & 1);
    const id = tag(o);
    if (id === "ALPH" || id === "VP8 " || id === "VP8L") keep.push(still.subarray(o, Math.min(end, still.length)));
    o = end;
  }
  if (!keep.some((k) => String.fromCharCode(k[0]!, k[1]!, k[2]!, k[3]!).startsWith("VP8"))) throw new Error("WebP has no image data");
  return concat(keep);
}

export interface MuxFrame {
  /** A complete still WebP file. */
  webp: Uint8Array;
  durationMs: number;
}

export function muxAnimatedWebp(frames: MuxFrame[], width: number, height: number, hasAlpha: boolean, loopCount = 0): Uint8Array {
  const vp8x = chunk("VP8X", [(hasAlpha ? 0x10 : 0) | 0x02, 0, 0, 0, ...u24(width - 1), ...u24(height - 1)]);
  const anim = chunk("ANIM", [0, 0, 0, 0, loopCount & 0xff, (loopCount >> 8) & 0xff]); // background colour (transparent), loop count (u16 LE): 0 = forever, 1 = once
  const anmf = frames.map((f) =>
    // x, y offsets (0), frame size, duration, flags: bit1 = do not blend, bit0 = dispose none.
    chunk("ANMF", concat([new Uint8Array([0, 0, 0, 0, 0, 0, ...u24(width - 1), ...u24(height - 1), ...u24(Math.max(0, f.durationMs)), 0b10]), frameDataChunks(f.webp)])),
  );
  const body = concat([new Uint8Array(ascii("WEBP")), vp8x, anim, ...anmf]);
  return concat([new Uint8Array(ascii("RIFF")), new Uint8Array(u32(body.length)), body]);
}
