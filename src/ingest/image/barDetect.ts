import type { PixelBuffer } from "./sampleColors";

/** Pure pixel analysis for the offline scanner: no DOM, no OCR, fully unit tested on synthetic buffers. */

export interface Box {
  left: number;
  top: number;
  /** Exclusive. */
  right: number;
  /** Exclusive. */
  bottom: number;
}

export interface DetectedBar extends Box {
  /** Colour sampled inside the bar (away from its end, where value labels sit). */
  rgb: [number, number, number];
}

export interface BarDetection {
  orientation: "vertical" | "horizontal";
  /** Left-to-right (vertical) or top-to-bottom (horizontal). */
  bars: DetectedBar[];
  background: [number, number, number];
}

type RGB = [number, number, number];

const rgbAt = (img: PixelBuffer, x: number, y: number): RGB => {
  const i = (y * img.width + x) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
};
export const rgbDistance = (a: RGB, b: RGB): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const chroma = (c: RGB): number => Math.max(...c) - Math.min(...c);
export const rgbToHex = (c: RGB): string => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/** Most common colour (4 bits per channel buckets, then averaged): the chart's page / card background. */
export function estimateBackground(img: PixelBuffer): RGB {
  const total = img.width * img.height;
  const stride = Math.max(1, Math.floor(total / 200_000));
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let p = 0; p < total; p += stride) {
    const i = p * 4;
    if (img.data[i + 3]! < 200) continue;
    const r = img.data[i]!;
    const g = img.data[i + 1]!;
    const b = img.data[i + 2]!;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key);
    if (e) {
      e.n++;
      e.r += r;
      e.g += g;
      e.b += b;
    } else buckets.set(key, { n: 1, r, g, b });
  }
  let best: { n: number; r: number; g: number; b: number } | undefined;
  for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
  return best ? [best.r / best.n, best.g / best.n, best.b / best.n] : [255, 255, 255];
}

const INK_DISTANCE = 70;
const INK_CHROMA = 45;

interface Seg {
  c0: number;
  c1: number;
  t0: number;
  t1: number;
  rgb: RGB;
}

/**
 * Find bars as runs of "ink" along one axis. `at(c, t)`: is this pixel bar-coloured (c = across the bars,
 * t = along them); `rgb(c, t)` reads its colour. Runs tolerate small gaps so value labels drawn inside a bar
 * don't cut it in two.
 */
function findSegments(across: number, along: number, at: (c: number, t: number) => boolean, rgb: (c: number, t: number) => RGB): Seg[] {
  const gapTol = Math.max(3, Math.round(along * 0.035));
  const minLen = Math.max(4, Math.round(along * 0.06));
  const cols: ({ t0: number; t1: number; rgb: RGB } | null)[] = [];
  for (let c = 0; c < across; c++) {
    let best: { t0: number; t1: number } | null = null;
    let start = -1;
    let last = -1;
    const close = () => {
      if (start >= 0 && (!best || last + 1 - start > best.t1 - best.t0)) best = { t0: start, t1: last + 1 };
      start = -1;
    };
    for (let t = 0; t < along; t++) {
      if (at(c, t)) {
        if (start < 0) start = t;
        else if (t - last > gapTol) {
          close();
          start = t;
        }
        last = t;
      } else if (start >= 0 && t - last > gapTol) close();
    }
    close();
    const b = best as { t0: number; t1: number } | null;
    cols.push(b && b.t1 - b.t0 >= minLen ? { ...b, rgb: rgb(c, Math.min(along - 1, Math.round(b.t0 + (b.t1 - b.t0) * 0.65))) } : null);
  }

  const segs: Seg[] = [];
  const minWidth = Math.max(3, Math.round(across * 0.012));
  let run: { c: number; col: NonNullable<(typeof cols)[number]> }[] = [];
  const flush = () => {
    if (run.length >= minWidth) {
      // Trim the rounded edges: use the middle half of the columns.
      const mid = run.slice(Math.floor(run.length / 4), Math.ceil((run.length * 3) / 4) || 1);
      segs.push({ c0: run[0]!.c, c1: run[run.length - 1]!.c + 1, t0: median(mid.map((m) => m.col.t0)), t1: median(mid.map((m) => m.col.t1)), rgb: mid[Math.floor(mid.length / 2)]!.col.rgb });
    }
    run = [];
  };
  cols.forEach((col, c) => {
    if (!col) return flush();
    const prev = run[run.length - 1];
    if (prev && rgbDistance(prev.col.rgb, col.rgb) > 40) flush(); // touching bars of different colours
    run.push({ c, col });
  });
  flush();
  return segs;
}

/** Keep the bars that share a baseline and a similar thickness. Needs at least two. */
function pickBars(segs: Seg[], along: number, baseAtEnd: boolean): Seg[] {
  const base = (s: Seg) => (baseAtEnd ? s.t1 : s.t0);
  const tol = Math.max(3, along * 0.025);
  let bestGroup: Seg[] = [];
  for (const s of segs) {
    const group = segs.filter((o) => Math.abs(base(o) - base(s)) <= tol);
    if (group.length > bestGroup.length) bestGroup = group;
  }
  if (bestGroup.length < 2) return [];
  const w = median(bestGroup.map((s) => s.c1 - s.c0));
  return bestGroup.filter((s) => s.c1 - s.c0 >= w * 0.5 && s.c1 - s.c0 <= w * 2);
}

/**
 * Find a bar chart in a screenshot: vertical and horizontal are both tried and the one with more bars wins.
 * Bars must be coloured (chroma) against the dominant background; greyscale bars aren't detected. Browser chrome and
 * page margins are grey, so they never register as bars.
 */
export function detectBars(img: PixelBuffer): BarDetection | null {
  const { width: W, height: H } = img;
  const bg = estimateBackground(img);
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (img.data[(y * W + x) * 4 + 3]! < 200) continue;
      const c = rgbAt(img, x, y);
      if (chroma(c) >= INK_CHROMA && rgbDistance(c, bg) >= INK_DISTANCE) mask[y * W + x] = 1;
    }
  }

  const vert = pickBars(findSegments(W, H, (c, t) => mask[t * W + c] === 1, (c, t) => rgbAt(img, c, t)), H, true);
  const horiz = pickBars(findSegments(H, W, (c, t) => mask[c * W + t] === 1, (c, t) => rgbAt(img, t, c)), W, false);

  if (vert.length >= 2 && vert.length >= horiz.length) {
    return { orientation: "vertical", background: bg, bars: vert.map((s) => ({ left: s.c0, right: s.c1, top: s.t0, bottom: s.t1, rgb: s.rgb })).sort((a, b) => a.left - b.left) };
  }
  if (horiz.length >= 2) {
    return { orientation: "horizontal", background: bg, bars: horiz.map((s) => ({ top: s.c0, bottom: s.c1, left: s.t0, right: s.t1, rgb: s.rgb })).sort((a, b) => a.top - b.top) };
  }
  return null;
}

const BG_NEAR = 40;
const BG_LINE_FRACTION = 0.6;
const FAIL_RUN = 6;

/**
 * The chart's own area: grow a box outward from the bars while rows / columns are still mostly background, and
 * stop at the card edge or page chrome (several failing lines in a row; a title's glyphs only fail a line or two).
 */
export function chartRegion(img: PixelBuffer, bg: RGB, bars: Box[]): Box {
  const { width: W, height: H } = img;
  const box: Box = {
    left: Math.min(...bars.map((b) => b.left)),
    top: Math.min(...bars.map((b) => b.top)),
    right: Math.max(...bars.map((b) => b.right)),
    bottom: Math.max(...bars.map((b) => b.bottom)),
  };
  const bgFraction = (fixed: number, from: number, to: number, horizontalLine: boolean): number => {
    let n = 0;
    let total = 0;
    const step = Math.max(1, Math.floor((to - from) / 200));
    for (let v = from; v < to; v += step) {
      const c = horizontalLine ? rgbAt(img, v, fixed) : rgbAt(img, fixed, v);
      total++;
      if (rgbDistance(c, bg) < BG_NEAR) n++;
    }
    return total === 0 ? 0 : n / total;
  };
  const grow = (start: number, limit: number, dir: 1 | -1, ok: (v: number) => boolean): number => {
    let edge = start;
    let fails = 0;
    for (let v = start + dir; dir === 1 ? v < limit : v >= limit; v += dir) {
      if (ok(v)) {
        edge = v;
        fails = 0;
      } else if (++fails >= FAIL_RUN) break;
    }
    return edge;
  };
  const xs: [number, number] = [box.left, box.right];
  box.top = grow(box.top, 0, -1, (y) => bgFraction(y, xs[0], xs[1], true) >= BG_LINE_FRACTION);
  box.bottom = grow(box.bottom - 1, H, 1, (y) => bgFraction(y, xs[0], xs[1], true) >= BG_LINE_FRACTION) + 1;
  const ys: [number, number] = [box.top, box.bottom];
  box.left = grow(box.left, 0, -1, (x) => bgFraction(x, ys[0], ys[1], false) >= BG_LINE_FRACTION);
  box.right = grow(box.right - 1, W, 1, (x) => bgFraction(x, ys[0], ys[1], false) >= BG_LINE_FRACTION) + 1;
  return box;
}

/** Mean colour of the pixels in a box that stand out most from the background (the text ink colour). */
export function inkColor(img: PixelBuffer, box: Box, bg: RGB): RGB | null {
  let maxD = 0;
  const pts: { c: RGB; d: number }[] = [];
  for (let y = Math.max(0, box.top); y < Math.min(img.height, box.bottom); y++) {
    for (let x = Math.max(0, box.left); x < Math.min(img.width, box.right); x++) {
      const c = rgbAt(img, x, y);
      const d = rgbDistance(c, bg);
      pts.push({ c, d });
      if (d > maxD) maxD = d;
    }
  }
  if (maxD < 60) return null;
  const strong = pts.filter((p) => p.d >= maxD * 0.75);
  const sum = strong.reduce((a, p) => [a[0] + p.c[0], a[1] + p.c[1], a[2] + p.c[2]] as RGB, [0, 0, 0] as RGB);
  return [sum[0] / strong.length, sum[1] / strong.length, sum[2] / strong.length];
}

/** Do faint full-width lines cross the gaps between bars (gridlines)? Vertical charts only. */
export function hasGridlines(img: PixelBuffer, bg: RGB, bars: DetectedBar[]): boolean {
  if (bars.length < 2) return false;
  const gaps: [number, number][] = [];
  for (let i = 0; i + 1 < bars.length; i++) if (bars[i + 1]!.left - bars[i]!.right >= 4) gaps.push([bars[i]!.right + 1, bars[i + 1]!.left - 1]);
  if (gaps.length === 0) return false;
  const top = Math.min(...bars.map((b) => b.top)) - 4;
  const bottom = Math.max(...bars.map((b) => b.bottom));
  const frac = (y: number): number => {
    let n = 0;
    let total = 0;
    for (const [a, b] of gaps) {
      for (let x = a; x <= b; x++) {
        total++;
        if (rgbDistance(rgbAt(img, x, y), bg) >= 8) n++;
      }
    }
    return total === 0 ? 0 : n / total;
  };
  let lines = 0;
  for (let y = Math.max(1, top); y < Math.min(img.height - 1, bottom); y++) if (frac(y) >= 0.7 && frac(y - 3) < 0.7 && frac(y + 3) < 0.7) lines++;
  return lines >= 2;
}
