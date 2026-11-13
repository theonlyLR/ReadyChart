import { describe, expect, it } from "vitest";
import { sampleDominantColors } from "./sampleColors";
import { validateScreenshot } from "./loadImage";

/** Build an RGBA buffer from [x0,x1) column bands of flat colours on a white background. */
function banded(width: number, height: number, bands: { from: number; to: number; rgb: [number, number, number] }[]) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const b = bands.find((k) => x >= k.from && x < k.to);
      if (!b) continue;
      const i = (y * width + x) * 4;
      data[i] = b.rgb[0];
      data[i + 1] = b.rgb[1];
      data[i + 2] = b.rgb[2];
    }
  }
  return { data, width, height };
}

describe("sampleDominantColors", () => {
  it("ranks series colours by area and ignores white/grey/black", () => {
    const img = banded(100, 20, [
      { from: 0, to: 40, rgb: [99, 102, 241] },
      { from: 40, to: 60, rgb: [245, 158, 11] },
      { from: 60, to: 70, rgb: [128, 128, 128] },
      { from: 70, to: 75, rgb: [0, 0, 0] },
    ]);
    const out = sampleDominantColors(img);
    expect(out.map((c) => c.hex)).toEqual(["#6366F1", "#F59E0B"]);
    expect(out[0]!.share).toBeCloseTo(2 / 3, 1);
  });

  it("merges near-duplicate shades (anti-aliasing) into one colour", () => {
    const img = banded(60, 10, [
      { from: 0, to: 30, rgb: [99, 102, 241] },
      { from: 30, to: 60, rgb: [104, 108, 238] },
    ]);
    expect(sampleDominantColors(img)).toHaveLength(1);
  });

  it("returns [] for a monochrome image and drops transparent pixels", () => {
    expect(sampleDominantColors({ data: new Uint8ClampedArray(16).fill(255), width: 2, height: 2 })).toEqual([]);
    const clear = new Uint8ClampedArray([255, 0, 0, 0, 255, 0, 0, 0]);
    expect(sampleDominantColors({ data: clear, width: 2, height: 1 })).toEqual([]);
  });
});

describe("validateScreenshot", () => {
  it("accepts images, rejects others", () => {
    expect(validateScreenshot("image/png", 1000)).toBeNull();
    expect(validateScreenshot("image/gif", 1000)).not.toBeNull();
    expect(validateScreenshot("image/png", 0)).not.toBeNull();
    expect(validateScreenshot("image/png", 11 * 1024 * 1024)).not.toBeNull();
  });
});
