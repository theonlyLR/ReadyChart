import type { ExtractedChart, NormBounds } from "../../vision/VisionProvider";
import { rgbDistance, rgbToHex } from "./barDetect";
import type { PixelRect } from "./crop";
import type { PixelBuffer } from "./sampleColors";

/**
 * Pixel-geometry verification. The vision model says WHERE every bar is (elementBounds); this measures the real
 * pixels inside each box, so values the model couldn't read (a 1% sliver, a chart with no printed labels) and numbers
 * OCR got wrong are recovered from bar sizes, and bar colours come from fill pixels instead of a single sample point.
 * Pure: works on any RGBA buffer, so it is unit tested without a DOM.
 */

type RGB = [number, number, number];

/** Pixels this close (RGB distance) to the background or text colour are not bar fill. */
export const NOT_FILL_DISTANCE = 45;
/** OCR vs geometry disagreement above this ratio means the geometric value wins. */
export const CONTRADICTION_RATIO = 0.15;
/** Bars shorter than this (px) are too coarse to adjudicate a printed value with. */
const MIN_ADJUDICATE_PX = 6;
/** A bar-size scale needs most anchors to agree, or the axis is truncated / non-linear and we don't "correct" anything. */
const MIN_INLIER_SHARE = 0.6;
const LOW_CONF = 0.5;

const parseRgb = (hex: string | null | undefined): RGB | null => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const sig4 = (v: number): number => Number(v.toPrecision(4));

/** A normalised (0..1000 of the FULL image) box -> whole pixels of the cropped image, or null when it misses the crop. */
export function boxToCropRect(box: NormBounds, rect: PixelRect, full: { width: number; height: number }, cropW: number, cropH: number): PixelRect | null {
  const [ymin, xmin, ymax, xmax] = box;
  const x0 = Math.max(0, Math.floor((xmin / 1000) * full.width - rect.x));
  const y0 = Math.max(0, Math.floor((ymin / 1000) * full.height - rect.y));
  const x1 = Math.min(cropW, Math.ceil((xmax / 1000) * full.width - rect.x));
  const y1 = Math.min(cropH, Math.ceil((ymax / 1000) * full.height - rect.y));
  if (x1 <= 0 || y1 <= 0 || x0 >= cropW || y0 >= cropH) return null;
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

const at = (img: PixelBuffer, x: number, y: number): RGB | null => {
  const i = (y * img.width + x) * 4;
  return img.data[i + 3]! < 200 ? null : [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
};

/** Middle 60% of a box on both axes (at least one pixel each), so edges and anti-aliasing are left out. */
function middle60(r: PixelRect): PixelRect {
  const mx = Math.min(Math.floor(r.width * 0.2), Math.floor((r.width - 1) / 2));
  const my = Math.min(Math.floor(r.height * 0.2), Math.floor((r.height - 1) / 2));
  return { x: r.x + mx, y: r.y + my, width: Math.max(1, r.width - 2 * mx), height: Math.max(1, r.height - 2 * my) };
}

/** A bar shorter than this (px) along its length is a sliver: the middle 60% would be 1-2 px of mostly edge. */
export const THIN_BAR_PX = 8;
/** How much of a sliver's end (px) is sampled. */
const SLIVER_STRIP_PX = 4;

/**
 * Where to sample a bar's fill. Normal bars: the middle 60% (edges and anti-aliasing excluded). Slivers under 8 px
 * (a 1% bar): a strip across the bar's whole width, 2-4 px deep at its free end, so the thin bar still yields its own
 * colour instead of nothing. For vertical bars that is the top of the box, for horizontal bars the right end.
 */
export function sampleRegion(box: PixelRect, vertical: boolean): PixelRect {
  const len = vertical ? box.height : box.width;
  if (len >= THIN_BAR_PX) return middle60(box);
  const depth = Math.max(1, Math.min(SLIVER_STRIP_PX, len));
  return vertical ? { x: box.x, y: box.y, width: box.width, height: depth } : { x: box.x + box.width - depth, y: box.y, width: depth, height: box.height };
}

/**
 * Text-safe median fill colour: every pixel in the sample region (middle 60% of the box, or the end strip of a sliver), minus pixels within NOT_FILL_DISTANCE of the
 * background or the text colour (value labels printed inside a bar), then the per-channel median of what's left.
 * Null when nothing is left (the box holds only background / text).
 */
export function medianFillColor(img: PixelBuffer, box: PixelRect, bg: RGB | null, ink: RGB | null, vertical = true): RGB | null {
  const m = sampleRegion(box, vertical);
  const step = Math.max(1, Math.floor(Math.sqrt((m.width * m.height) / 4000)));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = m.y; y < Math.min(img.height, m.y + m.height); y += step) {
    for (let x = m.x; x < Math.min(img.width, m.x + m.width); x += step) {
      const c = at(img, x, y);
      if (!c) continue;
      if ((bg && rgbDistance(c, bg) < NOT_FILL_DISTANCE) || (ink && rgbDistance(c, ink) < NOT_FILL_DISTANCE)) continue;
      rs.push(c[0]);
      gs.push(c[1]);
      bs.push(c[2]);
    }
  }
  return rs.length === 0 ? null : [median(rs), median(gs), median(bs)];
}

/**
 * Exact extent of a bar along its length: starting from the model's box, find the run of fill-coloured pixels (gaps
 * from inside labels tolerated) in the middle 60% of the bar's width and take the median edges. Null when the fill
 * can't be found, so the caller falls back to the model's box.
 */
export function measureExtent(img: PixelBuffer, box: PixelRect, fill: RGB, vertical: boolean): { near: number; far: number } | null {
  const start = vertical ? box.y : box.x;
  const len = vertical ? box.height : box.width;
  const axisMax = vertical ? img.height : img.width;
  const margin = Math.max(4, Math.round(len * 0.25));
  const lo = Math.max(0, start - margin);
  const hi = Math.min(axisMax, start + len + margin);
  const gapTol = Math.max(2, Math.round(len * 0.15));
  const cross = middle60(box);
  const c0 = vertical ? cross.x : cross.y;
  const cn = vertical ? cross.width : cross.height;
  const cStep = Math.max(1, Math.floor(cn / 24));
  const mid = start + len / 2;
  const nears: number[] = [];
  const fars: number[] = [];
  let tried = 0;
  for (let c = c0; c < c0 + cn; c += cStep) {
    tried++;
    let best: { near: number; far: number } | null = null;
    let runStart = -1;
    let last = -1;
    const close = () => {
      if (runStart < 0) return;
      const run = { near: runStart, far: last + 1 };
      const dist = (r: { near: number; far: number }) => (mid >= r.near && mid <= r.far ? 0 : Math.min(Math.abs(mid - r.near), Math.abs(mid - r.far)));
      if (!best || dist(run) < dist(best) || (dist(run) === dist(best) && run.far - run.near > best.far - best.near)) best = run;
      runStart = -1;
    };
    for (let t = lo; t < hi; t++) {
      const p = vertical ? at(img, c, t) : at(img, t, c);
      if (p && rgbDistance(p, fill) < NOT_FILL_DISTANCE) {
        if (runStart >= 0 && t - last > gapTol + 1) close();
        if (runStart < 0) runStart = t;
        last = t;
      } else if (runStart >= 0 && t - last > gapTol) close();
    }
    close();
    const b = best as { near: number; far: number } | null;
    if (b) {
      nears.push(b.near);
      fars.push(b.far);
    }
  }
  return nears.length > 0 && nears.length >= tried / 2 ? { near: median(nears), far: median(fars) } : null;
}

export interface GeometryOptions {
  chart: ExtractedChart;
  crop: PixelBuffer;
  /** The crop's rectangle inside the full image (same frame the model's normalised coordinates use). */
  rect: PixelRect;
  full: { width: number; height: number };
  background: string | null;
  /** Text colour (hex) so label pixels inside bars are excluded from the fill colour. */
  ink: string | null;
}

export interface GeometryResult {
  chart: ExtractedChart;
  /** Text-safe median fill colour per mark (hex), null where unmeasurable. */
  colors: (string | null)[];
}

interface Mark {
  /** Edges along the bar's length, in crop pixels. */
  near: number;
  far: number;
}

/**
 * Verify and fill in a single-series bar chart from pixel geometry. Applies to "bar" and "horizontal-bar" with one
 * box per label; anything else is returned untouched.
 *  - A null value (unreadable sliver), or any value in a chart with no printed labels, is computed from the bar's
 *    measured size using the axis scale (axisScale) or the scale implied by the other bars, and tagged estimated.
 *  - A printed/OCR value that disagrees with its bar's size by more than 15% is replaced by the geometric value and
 *    marked low-confidence (only when the other bars agree on a consistent scale).
 */
export function verifyGeometry(o: GeometryOptions): GeometryResult {
  const { chart, crop, rect, full } = o;
  const series = chart.series[0];
  const boxes = chart.elementBounds;
  const type = chart.chartType;
  if (!boxes || chart.series.length !== 1 || !series || (type !== "bar" && type !== "horizontal-bar")) return { chart, colors: [] };
  const vertical = type === "bar";
  const bg = parseRgb(o.background);
  const ink = parseRgb(o.ink);

  const colors: (string | null)[] = [];
  const marks: (Mark | null)[] = boxes.map((box) => {
    if (!box) {
      colors.push(null);
      return null;
    }
    const r = boxToCropRect(box, rect, full, crop.width, crop.height);
    if (!r) {
      colors.push(null);
      return null;
    }
    const fill = medianFillColor(crop, r, bg, ink, vertical);
    colors.push(fill ? rgbToHex(fill) : null);
    const ext = fill ? measureExtent(crop, r, fill, vertical) : null;
    return ext ?? (vertical ? { near: r.y, far: r.y + r.height } : { near: r.x, far: r.x + r.width });
  });

  // Legacy pixel-calibrated charts (local scanner) are handled by extractionToTable; only colours are taken here.
  if (chart.axis) return { chart, colors };

  const n = chart.labels.length;
  const values = [...series.values];
  const est: (boolean | null)[] = Array.from({ length: n }, (_, i) => series.estimated?.[i] ?? null);
  const conf: (number | null)[] = Array.from({ length: n }, (_, i) => series.confidences?.[i] ?? null);
  const printed = series.valueSource === "printed";
  let changed = false;

  const ax = chart.axisScale;
  const axisDim = vertical ? full.height : full.width;
  const axisOffset = vertical ? rect.y : rect.x;
  const zeroPx = ax?.zeroBaselineCoord == null ? null : (ax.zeroBaselineCoord / 1000) * axisDim - axisOffset;
  const topPx = ax?.topTickCoord == null ? null : (ax.topTickCoord / 1000) * axisDim - axisOffset;
  const topValue = ax?.topTickValue ?? null;
  const axisK = zeroPx !== null && topPx !== null && topValue !== null && topValue !== 0 && zeroPx !== topPx ? topValue / (vertical ? zeroPx - topPx : topPx - zeroPx) : null;

  // Size of each bar in px (always >= 0) and, with an axis, its signed value-per-k distance from the zero baseline.
  const size = marks.map((m) => (m ? Math.max(1, m.far - m.near) : null));
  const signed = marks.map((m) => {
    if (!m || zeroPx === null) return null;
    const tip = Math.abs(m.near - zeroPx) >= Math.abs(m.far - zeroPx) ? m.near : m.far;
    return vertical ? zeroPx - tip : tip - zeroPx;
  });

  const apply = (i: number, v: number, lowConf: boolean) => {
    values[i] = sig4(v);
    if (lowConf) conf[i] = LOW_CONF;
    else est[i] = true;
    changed = true;
  };

  if (axisK !== null) {
    // Axis-calibrated: the scale is known, so geometry fills gaps and checks every printed number.
    marks.forEach((m, i) => {
      if (!m || signed[i] === null) return;
      const d = signed[i]! * axisK;
      const v = values[i];
      if (v === null || v === undefined || !printed) apply(i, d, false);
      else if (size[i]! >= MIN_ADJUDICATE_PX && Math.abs(v - d) / Math.max(Math.abs(d), 1e-9) > CONTRADICTION_RATIO) apply(i, d, true);
    });
  } else {
    const anchors = values.map((v, i) => (v !== null && v !== undefined && v !== 0 && size[i] !== null && size[i]! >= MIN_ADJUDICATE_PX ? { i, ratio: Math.abs(v) / size[i]! } : null)).filter((a): a is { i: number; ratio: number } => a !== null);
    if (anchors.length > 0) {
      const k = median(anchors.map((a) => a.ratio));
      const sign = (i: number) => (values[i]! < 0 ? -1 : 1);
      // Gaps: unreadable values come from the scale of the readable ones.
      values.forEach((v, i) => {
        if ((v === null || v === undefined) && size[i] !== null) apply(i, size[i]! * k, false);
      });
      // Contradictions: only with 3+ anchors that mostly agree.
      const inliers = anchors.filter((a) => Math.abs(a.ratio - k) / k <= CONTRADICTION_RATIO);
      if (anchors.length >= 3 && inliers.length / anchors.length >= MIN_INLIER_SHARE) {
        for (const a of anchors) if (!inliers.includes(a)) apply(a.i, sign(a.i) * size[a.i]! * k, true);
      }
    } else if (values.every((v) => v === null || v === undefined) && size.some((s) => s !== null)) {
      // Nothing readable and no axis: relative sizes only (largest = 100), clearly marked as estimated.
      const max = Math.max(...size.map((s) => s ?? 0));
      size.forEach((s, i) => {
        if (s !== null) apply(i, (s / max) * 100, false);
      });
    }
  }

  if (!changed) return { chart, colors };
  const allFlagged = values.every((v, i) => v === null || v === undefined || est[i] === true || printed);
  return {
    chart: { ...chart, series: [{ ...series, values, estimated: est, confidences: conf, valueSource: allFlagged ? "printed" : series.valueSource }] },
    colors,
  };
}
