import { describe, expect, it } from "vitest";
import { frameDelays, frameTimes } from "./frames";
import type { FrameRenderer } from "./frames";
import { encodeGif } from "./animated/gif";
import { frameDataChunks, muxAnimatedWebp } from "./webpMux";

describe("frame timing", () => {
  it("frameTimes covers one loop evenly and stops before the seam", () => {
    const t = frameTimes(2000, 30);
    expect(t.length).toBe(60);
    expect(t[0]).toBe(0);
    expect(t[59]!).toBeLessThan(2000);
    expect(t[1]! - t[0]!).toBeCloseTo(1000 / 30, 6);
  });
  it("delays sum exactly to the loop length (no cumulative drift)", () => {
    for (const [total, fps, unit] of [[3217, 60, 1], [3217, 24, 1], [3210, 25, 10], [2870, 50, 10]] as const) {
      const n = frameTimes(total, fps).length;
      const d = frameDelays(total, n, unit);
      expect(d.reduce((a, b) => a + b, 0)).toBe(Math.round(total / unit));
    }
  });
});

const still = (payload: number[], fourcc = "VP8 ") => {
  const pad = payload.length & 1 ? [0] : [];
  const body = [...Array.from("WEBP", (c) => c.charCodeAt(0)), ...Array.from(fourcc, (c) => c.charCodeAt(0)), payload.length & 255, 0, 0, 0, ...payload, ...pad];
  const n = body.length;
  return new Uint8Array([...Array.from("RIFF", (c) => c.charCodeAt(0)), n & 255, (n >> 8) & 255, 0, 0, ...body]);
};
const str = (b: Uint8Array, o: number) => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
const le = (b: Uint8Array, o: number, n: number) => Array.from({ length: n }).reduce<number>((a, _, i) => a + b[o + i]! * 2 ** (8 * i), 0);

describe("animated WebP muxer", () => {
  it("builds a RIFF/VP8X/ANIM/ANMF container with exact sizes, odd padding and durations", () => {
    const frames = [
      { webp: still([1, 2, 3]), durationMs: 33 },
      { webp: still([4, 5, 6, 7]), durationMs: 34 },
    ];
    const out = muxAnimatedWebp(frames, 640, 360, true);
    expect(str(out, 0)).toBe("RIFF");
    expect(le(out, 4, 4)).toBe(out.length - 8);
    expect(str(out, 8)).toBe("WEBP");
    expect(str(out, 12)).toBe("VP8X");
    expect(out[20]! & 0x02).toBe(0x02); // animation flag
    expect(out[20]! & 0x10).toBe(0x10); // alpha flag
    expect(le(out, 24, 3) + 1).toBe(640);
    expect(le(out, 27, 3) + 1).toBe(360);
    expect(str(out, 30)).toBe("ANIM");
    // Walk the chunks after VP8X + ANIM.
    let o = 12 + 18 + 14;
    const durations: number[] = [];
    while (o < out.length) {
      expect(str(out, o)).toBe("ANMF");
      const len = le(out, o + 4, 4);
      durations.push(le(out, o + 8 + 12, 3));
      expect(str(out, o + 8 + 16)).toBe("VP8 ");
      o += 8 + len + (len & 1);
    }
    expect(o).toBe(out.length);
    expect(durations).toEqual([33, 34]);
  });
  it("keeps ALPH + VP8 chunks and drops VP8X from stills", () => {
    const body = [...Array.from("WEBP", (c) => c.charCodeAt(0)), ...Array.from("VP8X", (c) => c.charCodeAt(0)), 10, 0, 0, 0, 0x10, 0, 0, 0, 1, 0, 0, 1, 0, 0, ...Array.from("ALPH", (c) => c.charCodeAt(0)), 2, 0, 0, 0, 9, 9, ...Array.from("VP8 ", (c) => c.charCodeAt(0)), 2, 0, 0, 0, 8, 8];
    const f = new Uint8Array([...Array.from("RIFF", (c) => c.charCodeAt(0)), body.length, 0, 0, 0, ...body]);
    const kept = frameDataChunks(f);
    expect(str(kept, 0)).toBe("ALPH");
    expect(str(kept, 10)).toBe("VP8 ");
    expect(kept.length).toBe(20);
  });
  it("rejects non-WebP input", () => {
    expect(() => frameDataChunks(new Uint8Array(20))).toThrow();
  });
});

/** Minimal GIF block walker: counts local colour tables and image frames. */
function inspectGif(b: Uint8Array) {
  const hdr = String.fromCharCode(...b.subarray(0, 6));
  const gct = !!(b[10]! & 0x80);
  let o = 13 + (gct ? 3 * 2 ** ((b[10]! & 7) + 1) : 0);
  let frames = 0;
  let localTables = 0;
  while (b[o] !== 0x3b) {
    if (b[o] === 0x21) {
      o += 2;
      while (b[o] !== 0) o += b[o]! + 1;
      o += 1;
    } else if (b[o] === 0x2c) {
      frames++;
      if (b[o + 9]! & 0x80) localTables++;
      o += 10;
      o += 1;
      while (b[o] !== 0) o += b[o]! + 1;
      o += 1;
    } else throw new Error(`bad block ${b[o]} at ${o}`);
  }
  return { hdr, gct, frames, localTables };
}

function fakeRenderer(w: number, h: number, totalMs: number): FrameRenderer {
  return {
    width: w,
    height: h,
    totalMs,
    settledMs: 500,
    render(t) {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const on = x < (w * Math.min(t, 500)) / 500;
          data.set(on ? [20, 120, 220, 255] : [240, 240, 240, 255], i);
        }
      return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
    },
  };
}

describe("GIF encoder", () => {
  it("writes one global colour table and no local tables, one frame per sample", () => {
    const r = fakeRenderer(16, 8, 1000);
    const times = frameTimes(1000, 25);
    const res = encodeGif(r, { fps: 25, transparent: false, frameTimes: times });
    if (!("bytes" in res)) throw new Error("unexpected abort");
    const info = inspectGif(res.bytes);
    expect(info.hdr).toBe("GIF89a");
    expect(info.gct).toBe(true);
    expect(info.localTables).toBe(0);
    expect(info.frames).toBe(times.length);
  });
  it("aborts early once the byte budget is exceeded", () => {
    const r = fakeRenderer(16, 8, 1000);
    const res = encodeGif(r, { fps: 25, transparent: false, frameTimes: frameTimes(1000, 25), maxBytes: 10 });
    expect("over" in res).toBe(true);
  });
  it("supports transparent canvases with a single global table", () => {
    const r = fakeRenderer(8, 8, 400);
    const res = encodeGif(r, { fps: 25, transparent: true, frameTimes: frameTimes(400, 25) });
    if (!("bytes" in res)) throw new Error("unexpected abort");
    expect(inspectGif(res.bytes).localTables).toBe(0);
  });
});
