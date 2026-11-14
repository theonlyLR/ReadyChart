import type { AxisScale, ExtractedChart, NormBounds } from "../../vision/VisionProvider";
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
/** OCR vs geometry disagreement above 10% means the geometric value wins (and is flagged for review). */
export const CONTRADICTION_RATIO = 0.1;
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
  /** Bar styling read from the pixels: gap as a share of the bar pitch, corner radius as a share of the bar width. */
  barStyle?: { barGapRatio: number | null; barRadiusRatio: number | null };
}

interface Mark {
  /** Edges along the bar's length, in crop pixels. */
  near: number;
  far: number;
}

/** A linear map from a coordinate along the value axis (crop px) to a data value, plus where value 0 sits. */
export interface AxisMap {
  value: (coord: number) => number;
  zeroCoord: number | null;
}

/**
 * Build the value scale from the model's axis reading. Two or more ticks give a least-squares line (exact for linear
 * axes, works even when the axis doesn't start at 0). One tick (or the legacy top tick) plus the zero baseline gives a
 * line through (zero, 0). Coordinates arrive normalised to the full image and are converted into crop pixels.
 */
export function buildAxisMap(ax: AxisScale | undefined, axisDim: number, axisOffset: number): AxisMap | null {
  if (!ax) return null;
  const px = (c: number) => (c / 1000) * axisDim - axisOffset;
  const zero = ax.zeroBaselineCoord == null ? null : px(ax.zeroBaselineCoord);
  const pts = (ax.ticks ?? []).map((t) => ({ c: px(t.coord), v: t.value }));
  if (pts.length === 0 && ax.topTickCoord != null && ax.topTickValue != null) pts.push({ c: px(ax.topTickCoord), v: ax.topTickValue });
  if (pts.length >= 2) {
    const mc = pts.reduce((a, p) => a + p.c, 0) / pts.length;
    const mv = pts.reduce((a, p) => a + p.v, 0) / pts.length;
    const varC = pts.reduce((a, p) => a + (p.c - mc) ** 2, 0);
    if (varC > 1e-9) {
      const b = pts.reduce((a, p) => a + (p.c - mc) * (p.v - mv), 0) / varC;
      if (b !== 0) {
        const a0 = mv - b * mc;
        return { value: (c) => a0 + b * c, zeroCoord: -a0 / b };
      }
    }
  }
  if (pts.length >= 1 && zero !== null) {
    const t = pts.reduce((best, p) => (Math.abs(p.c - zero) > Math.abs(best.c - zero) ? p : best), pts[0]!);
    if (t.c !== zero && t.v !== 0) {
      const b = t.v / (t.c - zero);
      return { value: (c) => (c - zero) * b, zeroCoord: zero };
    }
  }
  return null;
}

/**
 * Bar styling from pixels. Gap: 1 - bar thickness / pitch from the (cross-axis) box widths. Corner radius: how many rows
 * it takes for the left edge of a tall bar to reach full width at its top, relative to the bar width (0 = sharp).
 */
function measureBarStyle(crop: PixelBuffer, rects: (PixelRect | null)[], fills: (RGB | null)[], marks: (Mark | null)[], vertical: boolean): { barGapRatio: number | null; barRadiusRatio: number | null } {
  const ok = rects.map((r, i) => (r ? { r, i } : null)).filter((x): x is { r: PixelRect; i: number } => x !== null);
  let gap: number | null = null;
  if (ok.length >= 2) {
    const centre = (r: PixelRect) => (vertical ? r.x + r.width / 2 : r.y + r.height / 2);
    const thick = (r: PixelRect) => (vertical ? r.width : r.height);
    const pitch = median(ok.slice(1).map((o, k) => Math.abs(centre(o.r) - centre(ok[k]!.r))));
    if (pitch > 0) gap = Math.round(Math.min(0.9, Math.max(0, 1 - median(ok.map((o) => thick(o.r))) / pitch)) * 100) / 100;
  }

  let radius: number | null = null;
  if (vertical) {
    const tall = ok.find((o) => fills[o.i] && marks[o.i] && marks[o.i]!.far - marks[o.i]!.near >= 24 && o.r.width >= 12);
    if (tall) {
      const fill = fills[tall.i]!;
      const top = Math.round(marks[tall.i]!.near);
      const y0 = Math.min(crop.height - 1, top + Math.max(2, Math.round((marks[tall.i]!.far - marks[tall.i]!.near) * 0.5)));
      const edgeAt = (y: number): number | null => {
        for (let x = Math.max(0, tall.r.x - 3); x < Math.min(crop.width, tall.r.x + tall.r.width / 2); x++) {
          const p = at(crop, x, y);
          if (p && rgbDistance(p, fill) < NOT_FILL_DISTANCE) return x;
        }
        return null;
      };
      const fullEdge = edgeAt(y0);
      if (fullEdge !== null) {
        const maxRows = Math.min(24, Math.floor(tall.r.width / 2));
        let rows = 0;
        for (let r = 0; r < maxRows; r++) {
          const e = edgeAt(top + r);
          if (e !== null && e - fullEdge <= 0) break;
          rows++;
        }
        radius = rows <= 1 ? 0 : Math.round((rows / tall.r.width) * 100) / 100;
      }
    }
  }
  return { barGapRatio: gap, barRadiusRatio: radius };
}

/**
 * Verify and fill in values from pixel geometry, for single-series bar / horizontal-bar (bar size) and line / area (vertex
 * height) charts with one box per label. Anything else is returned untouched.
 *  - A null value (unreadable sliver), or any value in a chart with no printed labels, is computed from the measured
 *    geometry using the axis scale (ticks / zero baseline) or the scale implied by the other bars, and tagged estimated.
 *  - A printed/OCR value that disagrees with the geometry by more than 10% is replaced by the geometric value and
 *    marked low-confidence for review (only when the scale is trustworthy: an axis, or 3+ bars that mostly agree).
 */
export function verifyGeometry(o: GeometryOptions): GeometryResult {
  const { chart, crop, rect, full } = o;
  const series = chart.series[0];
  const boxes = chart.elementBounds;
  const type = chart.chartType;
  const isBar = type === "bar" || type === "horizontal-bar";
  const isLine = type === "line" || type === "area";
  if (!boxes || chart.series.length !== 1 || !series || (!isBar && !isLine)) return { chart, colors: [] };
  const vertical = type !== "horizontal-bar";
  const bg = parseRgb(o.background);
  const ink = parseRgb(o.ink);

  const colors: (string | null)[] = [];
  const rects: (PixelRect | null)[] = boxes.map((box) => (box ? boxToCropRect(box, rect, full, crop.width, crop.height) : null));
  const fills: (RGB | null)[] = rects.map((r) => (r && isBar ? medianFillColor(crop, r, bg, ink, vertical) : null));
  fills.forEach((f) => colors.push(f ? rgbToHex(f) : null));
  const marks: (Mark | null)[] = rects.map((r, i) => {
    if (!r) return null;
    if (isLine) return { near: vertical ? r.y + r.height / 2 : r.x + r.width / 2, far: vertical ? r.y + r.height / 2 : r.x + r.width / 2 };
    const fill = fills[i];
    const ext = fill ? measureExtent(crop, r, fill, vertical) : null;
    return ext ?? (vertical ? { near: r.y, far: r.y + r.height } : { near: r.x, far: r.x + r.width });
  });
  const barStyle = isBar ? measureBarStyle(crop, rects, fills, marks, vertical) : undefined;

  // Legacy pixel-calibrated charts (local scanner axis) are handled by extractionToTable; only colours / style are taken here.
  if (chart.axis) return { chart, colors, barStyle };

  const n = chart.labels.length;
  const values = [...series.values];
  const est: (boolean | null)[] = Array.from({ length: n }, (_, i) => series.estimated?.[i] ?? null);
  const conf: (number | null)[] = Array.from({ length: n }, (_, i) => series.confidences?.[i] ?? null);
  const printed = series.valueSource === "printed";
  let changed = false;

  const map = buildAxisMap(chart.axisScale, vertical ? full.height : full.width, vertical ? rect.y : rect.x);

  // Bars: the end of the bar farther from the zero line carries the value. Line vertices: their own coordinate.
  const size = marks.map((m) => (m && isBar ? Math.max(1, m.far - m.near) : m ? 1 : null));
  const fromAxis = marks.map((m) => {
    if (!m || !map) return null;
    if (isLine) return map.value(m.near);
    const z = map.zeroCoord ?? (vertical ? m.far : m.near);
    const tip = Math.abs(m.near - z) >= Math.abs(m.far - z) ? m.near : m.far;
    return map.value(tip);
  });

  const apply = (i: number, v: number, lowConf: boolean) => {
    values[i] = sig4(v);
    if (lowConf) conf[i] = LOW_CONF;
    else est[i] = true;
    changed = true;
  };
  const differs = (v: number, d: number) => Math.abs(v - d) / Math.max(Math.abs(d), 1e-9) > CONTRADICTION_RATIO;

  if (map) {
    // Axis-calibrated: the scale is known, so geometry fills gaps and checks every printed number.
    marks.forEach((m, i) => {
      const d = fromAxis[i];
      if (!m || d === null || d === undefined) return;
      const v = values[i];
      if (v === null || v === undefined || !printed) apply(i, d, false);
      else if (size[i]! >= (isBar ? MIN_ADJUDICATE_PX : 0) && differs(v, d)) apply(i, d, true);
    });
  } else if (isBar) {
    const anchors = values.map((v, i) => (v !== null && v !== undefined && v !== 0 && size[i] !== null && size[i]! >= MIN_ADJUDICATE_PX ? { i, ratio: Math.abs(v) / size[i]! } : null)).filter((a): a is { i: number; ratio: number } => a !== null);
    if (anchors.length > 0) {
      const k = median(anchors.map((a) => a.ratio));
      const sign = (i: number) => (values[i]! < 0 ? -1 : 1);
      // Gaps: unreadable values come from the scale of the readable ones.
      values.forEach((v, i) => {
        if ((v === null || v === undefined) && size[i] !== null) apply(i, size[i]! * k, false);
      });
      // Contradictions: only with 3+ anchors that mostly agree.
      const inliers = anchors.filter((a) => !differs(a.ratio, k));
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

  if (!changed) return { chart, colors, barStyle };
  const allFlagged = values.every((v, i) => v === null || v === undefined || est[i] === true || printed);
  return {
    chart: { ...chart, series: [{ ...series, values, estimated: est, confidences: conf, valueSource: allFlagged ? "printed" : series.valueSource }] },
    colors,
    barStyle,
  };
}
