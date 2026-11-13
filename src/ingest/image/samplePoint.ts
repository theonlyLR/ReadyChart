import type { PixelBuffer } from "./sampleColors";

const toHex = (n: number): string => Math.round(n).toString(16).padStart(2, "0");

/**
 * Average colour of a (2r+1)x(2r+1) pixel window (default 5x5) centred on a normalised point (0..1000 of the
 * buffer). Window and centre are clamped to the image; transparent pixels are ignored. Returns null when the
 * window has no opaque pixels. Averaging hides anti-aliasing and JPEG noise that a single pixel would pick up.
 */
export function sampleAverage(img: PixelBuffer, nx: number, ny: number, radius = 2): string | null {
  if (img.width < 1 || img.height < 1) return null;
  const cx = Math.min(img.width - 1, Math.max(0, Math.round((nx / 1000) * img.width - 0.5)));
  const cy = Math.min(img.height - 1, Math.max(0, Math.round((ny / 1000) * img.height - 0.5)));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = Math.max(0, cy - radius); y <= Math.min(img.height - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(img.width - 1, cx + radius); x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3]! < 128) continue;
      r += img.data[i]!;
      g += img.data[i + 1]!;
      b += img.data[i + 2]!;
      n++;
    }
  }
  return n === 0 ? null : `#${toHex(r / n)}${toHex(g / n)}${toHex(b / n)}`.toUpperCase();
}

export function colorDistance(a: string, b: string): number {
  const c = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = c(a) as [number, number, number];
  const [r2, g2, b2] = c(b) as [number, number, number];
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}
