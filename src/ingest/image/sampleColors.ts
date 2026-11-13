export interface PixelBuffer {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

export interface SampledColor {
  hex: string;
  /** Share (0..1) of all chromatic (non-background, non-text) pixels. */
  share: number;
}

export interface SampleOptions {
  /** Max colours returned. */
  max?: number;
  /** Pixels with max(R,G,B) - min(R,G,B) below this are treated as white/black/grey (background, gridlines, text). */
  minChroma?: number;
  /** Clusters whose centres are closer than this (RGB distance) are merged. */
  mergeDistance?: number;
  /** Ignore clusters smaller than this share of chromatic pixels. */
  minShare?: number;
}

const toHex = (n: number): string => Math.round(n).toString(16).padStart(2, "0");

/**
 * Dominant series colours of a chart screenshot. Pure: works on any RGBA buffer, so it is unit tested without a DOM.
 * Greys and near-white/black are dropped (backgrounds, gridlines, axis text), the rest is bucketed at 4 bits per
 * channel, and close buckets are merged into clusters ranked by pixel area.
 */
export function sampleDominantColors(img: PixelBuffer, opts: SampleOptions = {}): SampledColor[] {
  const { max = 6, minChroma = 40, mergeDistance = 56, minShare = 0.01 } = opts;
  const total = img.width * img.height;
  const stride = Math.max(1, Math.floor(total / 250_000));
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  let chromatic = 0;

  for (let p = 0; p < total; p += stride) {
    const i = p * 4;
    const a = img.data[i + 3]!;
    if (a < 200) continue;
    const r = img.data[i]!;
    const g = img.data[i + 1]!;
    const b = img.data[i + 2]!;
    if (Math.max(r, g, b) - Math.min(r, g, b) < minChroma) continue;
    chromatic++;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key);
    if (e) {
      e.n++;
      e.r += r;
      e.g += g;
      e.b += b;
    } else buckets.set(key, { n: 1, r, g, b });
  }
  if (chromatic === 0) return [];

  const sorted = [...buckets.values()].sort((x, y) => y.n - x.n);
  const clusters: { n: number; r: number; g: number; b: number }[] = [];
  for (const bk of sorted) {
    const cr = bk.r / bk.n;
    const cg = bk.g / bk.n;
    const cb = bk.b / bk.n;
    const hit = clusters.find((c) => Math.hypot(c.r / c.n - cr, c.g / c.n - cg, c.b / c.n - cb) < mergeDistance);
    if (hit) {
      hit.n += bk.n;
      hit.r += bk.r;
      hit.g += bk.g;
      hit.b += bk.b;
    } else clusters.push({ ...bk });
  }
  return clusters
    .sort((x, y) => y.n - x.n)
    .filter((c) => c.n / chromatic >= minShare)
    .slice(0, max)
    .map((c) => ({ hex: `#${toHex(c.r / c.n)}${toHex(c.g / c.n)}${toHex(c.b / c.n)}`.toUpperCase(), share: c.n / chromatic }));
}
