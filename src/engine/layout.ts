import type { ChartDocument } from "../model/types";
import { SERIES_PALETTE } from "../model/defaults";
import { hasNegatives } from "../model/validate";
import type { Rect } from "./types";
import type { TextMeasurer } from "./textMeasure";
import { formatValue } from "./format";
import { resolveDomain, resolveTicks } from "./scales";
import { solveXLabels, solveYLabelStep } from "./collision";
import type { LabelStrategy } from "./collision";
import { buildSlices } from "./geometry/pie";
import { pieGuard } from "./guards";

export interface TextBlock {
  lines: string[];
  x: number;
  /** Baseline of the first line. */
  y: number;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
}

export interface LegendItem {
  x: number;
  y: number;
  textX: number;
  label: string;
  color: string;
}

export type Orientation = "vertical" | "horizontal" | "radial";

export interface LayoutResult {
  width: number;
  height: number;
  /** Resolution-independent unit: min(canvas side)/1080. */
  u: number;
  fonts: { title: number; subtitle: number; footer: number; label: number; value: number };
  orientation: Orientation;
  title: TextBlock;
  subtitle: TextBlock;
  footer: TextBlock;
  legend: { items: LegendItem[]; swatch: number; rect: Rect } | null;
  logoBox: Rect | null;
  plot: Rect;
  /** Text/legend regions the plot must never intersect (safe-zone reflow checks use these). */
  regions: { text: Rect; legend: Rect | null; footer: Rect; logo: Rect | null };
  domain: [number, number];
  ticks: number[];
  /** Category-axis label strategy (x labels for vertical charts, y labels for horizontal). */
  categoryLabels: LabelStrategy;
  yAxisWidth: number;
}

const SIN45 = Math.SQRT1_2;

export function wrapText(text: string, maxWidth: number, fontSize: number, weight: number, m: TextMeasurer, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && m.width(next, fontSize, weight) > maxWidth) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1] + " " + lines.slice(maxLines).join(" ");
    while (last.length > 1 && m.width(last + "…", fontSize, weight) > maxWidth) last = last.slice(0, -1);
    kept[maxLines - 1] = last.trimEnd() + "…";
    return kept;
  }
  return lines;
}

const orientationOf = (t: ChartDocument["geometry"]["type"]): Orientation =>
  t === "horizontal-bar" ? "horizontal" : t === "pie" || t === "donut" ? "radial" : "vertical";

export function computeLayout(doc: ChartDocument, m: TextMeasurer): LayoutResult {
  const { width: W, height: H, padding } = doc.canvas;
  const [pt, pr, pb, pl] = padding;
  const u = Math.min(W, H) / 1080;
  const fonts = { title: 44 * u, subtitle: 24 * u, footer: 18 * u, label: 20 * u, value: 20 * u };
  const content: Rect = { x: pl, y: pt, width: Math.max(1, W - pl - pr), height: Math.max(1, H - pt - pb) };
  const orientation = orientationOf(doc.geometry.type);
  const gap = 24 * u;

  // --- Brand logo safe zone -------------------------------------------------------------------
  const { brand } = doc;
  let logoBox: Rect | null = null;
  if (brand.logoDataUrl) {
    const size = Math.min(brand.sizePx, content.width / 3, content.height / 3);
    const left = brand.anchor.endsWith("left");
    const top = brand.anchor.startsWith("top");
    logoBox = {
      x: left ? content.x : content.x + content.width - size,
      y: top ? content.y : content.y + content.height - size,
      width: size,
      height: size,
    };
  }
  const logoTop = logoBox !== null && brand.anchor.startsWith("top");
  const logoBottom = logoBox !== null && brand.anchor.startsWith("bottom");
  const logoLeft = logoBox !== null && brand.anchor.endsWith("left");

  const shrink = (active: boolean): [number, number] => {
    let x0 = content.x;
    let x1 = content.x + content.width;
    if (active && logoBox) {
      if (logoLeft) x0 += logoBox.width + gap;
      else x1 -= logoBox.width + gap;
    }
    return [x0, x1];
  };

  // --- Header text ----------------------------------------------------------------------------
  const [hx0, hx1] = shrink(logoTop);
  const headerW = Math.max(40, hx1 - hx0);
  const lh = (fs: number) => fs * 1.25;
  const baseline = (top: number, fs: number) => top + lh(fs) / 2 + fs * 0.35;

  let cursor = content.y;
  const titleLines = wrapText(doc.title, headerW, fonts.title, 600, m, 2);
  const title: TextBlock = { lines: titleLines, x: hx0, y: baseline(cursor, fonts.title), fontSize: fonts.title, fontWeight: 600, lineHeight: lh(fonts.title) };
  cursor += titleLines.length * lh(fonts.title);
  if (titleLines.length) cursor += 8 * u;
  const subLines = wrapText(doc.subtitle, headerW, fonts.subtitle, 400, m, 2);
  const subtitle: TextBlock = { lines: subLines, x: hx0, y: baseline(cursor, fonts.subtitle), fontSize: fonts.subtitle, fontWeight: 400, lineHeight: lh(fonts.subtitle) };
  cursor += subLines.length * lh(fonts.subtitle);
  const textBottom = cursor;
  const textRect: Rect = { x: hx0, y: content.y, width: headerW, height: Math.max(0, textBottom - content.y) };
  let headerBottom = textBottom;
  if (logoTop && logoBox) headerBottom = Math.max(headerBottom, logoBox.y + logoBox.height);

  // --- Footer ---------------------------------------------------------------------------------
  const [fx0, fx1] = shrink(logoBottom);
  const footerW = Math.max(40, fx1 - fx0);
  const footLines = wrapText(doc.sourceFooter, footerW, fonts.footer, 400, m, 2);
  const footH = footLines.length * lh(fonts.footer);
  const contentBottom = content.y + content.height;
  const footTop = contentBottom - footH;
  const footer: TextBlock = { lines: footLines, x: fx0, y: baseline(footTop, fonts.footer), fontSize: fonts.footer, fontWeight: 400, lineHeight: lh(fonts.footer) };
  const footerRect: Rect = { x: fx0, y: footTop, width: footerW, height: footH };
  let bodyBottom = footLines.length ? footTop - gap * 0.75 : contentBottom;
  if (logoBottom && logoBox) bodyBottom = Math.min(bodyBottom, logoBox.y - gap * 0.75);

  // --- Legend ---------------------------------------------------------------------------------
  const legendEntries: { label: string; color: string }[] =
    orientation === "radial"
      ? pieGuard(doc).blocked
        ? []
        : buildSlices(doc).map((s) => ({ label: s.label, color: s.color }))
      : doc.data.series.length > 1
        ? doc.data.series.map((s) => ({ label: s.name, color: s.color }))
        : [];
  let legend: LayoutResult["legend"] = null;
  let bodyTop = headerBottom + (headerBottom > content.y ? gap * 0.8 : 0);
  if (legendEntries.length) {
    const swatch = 14 * u;
    const rowH = 30 * u;
    const items: LegendItem[] = [];
    let x = content.x;
    let y = bodyTop;
    let maxX = content.x;
    for (const e of legendEntries) {
      const w = swatch + 8 * u + m.width(e.label, fonts.label) + 28 * u;
      if (x > content.x && x + w - 28 * u > content.x + content.width) {
        x = content.x;
        y += rowH;
      }
      items.push({ x, y, textX: x + swatch + 8 * u, label: e.label, color: e.color });
      x += w;
      maxX = Math.max(maxX, x - 28 * u);
    }
    const rect: Rect = { x: content.x, y: bodyTop, width: Math.max(1, maxX - content.x), height: y + rowH - bodyTop };
    legend = { items, swatch, rect };
    bodyTop = y + rowH + gap * 0.6;
  }

  // --- Plot area ------------------------------------------------------------------------------
  const domain = resolveDomain(doc);
  const ticks = resolveTicks(domain, 5);
  const labelPad = doc.geometry.showDataLabels ? 30 * u : 0;
  const negLabels = doc.geometry.showDataLabels && hasNegatives(doc);
  const n = Math.max(1, doc.data.labels.length);
  let plot: Rect;
  let categoryLabels: LabelStrategy = { rotation: 0, step: 1, height: 0, maxWidth: 0 };
  let yAxisWidth = 0;
  const availH = Math.max(20, bodyBottom - bodyTop);

  if (orientation === "radial") {
    plot = { x: content.x, y: bodyTop, width: content.width, height: availH };
  } else if (orientation === "vertical") {
    const tickW = ticks.reduce((mx, t) => Math.max(mx, m.width(formatValue(doc.data, t), fonts.label)), 0);
    yAxisWidth = tickW + 16 * u;
    let plotX = content.x + yAxisWidth;
    let plotW = content.x + content.width - plotX;
    categoryLabels = solveXLabels(doc.data.labels, plotW / n, m, fonts.label);
    if (categoryLabels.rotation === -45) {
      // The first tilted label extends left of its tick; widen the left inset instead of clipping.
      const overflow = categoryLabels.maxWidth * SIN45 - (yAxisWidth + plotW / n / 2);
      if (overflow > 0) {
        plotX += overflow;
        plotW -= overflow;
        categoryLabels = solveXLabels(doc.data.labels, plotW / n, m, fonts.label);
      }
    }
    const axisH = categoryLabels.height + 14 * u;
    const topPad = labelPad;
    const botPad = negLabels ? labelPad : 0;
    plot = { x: plotX, y: bodyTop + topPad, width: Math.max(1, plotW), height: Math.max(20, availH - axisH - topPad - botPad) };
  } else {
    const catW = doc.data.labels.reduce((mx, l) => Math.max(mx, m.width(l, fonts.label)), 0);
    yAxisWidth = Math.min(catW, content.width * 0.35) + 16 * u;
    const valueLabelW = doc.geometry.showDataLabels
      ? ticks.reduce((mx, t) => Math.max(mx, m.width(formatValue(doc.data, t), fonts.value)), 0) + 14 * u
      : 0;
    const axisH = lh(fonts.label) + 14 * u;
    const plotX = content.x + yAxisWidth + (negLabels ? valueLabelW : 0);
    const plotW = content.x + content.width - valueLabelW - plotX;
    const plotH = Math.max(20, availH - axisH);
    categoryLabels = { rotation: 0, step: solveYLabelStep(plotH / n, fonts.label), height: lh(fonts.label), maxWidth: catW };
    plot = { x: plotX, y: bodyTop, width: Math.max(1, plotW), height: plotH };
  }

  return {
    width: W,
    height: H,
    u,
    fonts,
    orientation,
    title,
    subtitle,
    footer,
    legend,
    logoBox,
    plot,
    regions: { text: textRect, legend: legend?.rect ?? null, footer: footerRect, logo: logoBox },
    domain,
    ticks,
    categoryLabels,
    yAxisWidth,
  };
}

export const seriesColor = (doc: ChartDocument, i: number): string => doc.data.series[i]?.color ?? SERIES_PALETTE[i % SERIES_PALETTE.length]!;
