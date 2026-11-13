import { contrastRatio } from "../../brand/contrast";
import { luminance } from "../../engine/theme";
import { NO_POINT } from "../../vision/VisionProvider";
import type { ExtractedChart, NormPoint } from "../../vision/VisionProvider";
import { pointToCrop } from "./crop";
import type { PixelRect } from "./crop";
import { colorDistance, sampleAverage } from "./samplePoint";
import type { PixelBuffer } from "./sampleColors";
import type { ScanDesign } from "./scanTypes";

/** Bars whose sampled colour is within this RGB distance of the series colour get no per-bar override. */
const SAME_COLOR = 30;
/** A sample this close to the background is a missed bar (the model's point landed on empty space). */
const NEAR_BACKGROUND = 24;
const MIN_TEXT_CONTRAST = 3;

const ASPECTS = [
  { preset: "16:9", ratio: 16 / 9 },
  { preset: "4:5", ratio: 4 / 5 },
  { preset: "1:1", ratio: 1 },
  { preset: "9:16", ratio: 9 / 16 },
] as const;

/** Nearest preset to a width/height ratio, compared on a log scale so 2:1 and 1:2 are equally far from 1:1. */
export function snapAspect(width: number, height: number): ScanDesign["aspect"] {
  const r = Math.log(width / Math.max(1, height));
  let best: ScanDesign["aspect"] = "16:9";
  let bestD = Infinity;
  for (const a of ASPECTS) {
    const d = Math.abs(Math.log(a.ratio) - r);
    if (d < bestD) ((bestD = d), (best = a.preset));
  }
  return best;
}

export interface DerivedDesign {
  design: ScanDesign;
  /** Sampled colour per series (null where the model gave no usable point). */
  seriesColors: (string | null)[];
}

/**
 * Read the visual design from the cropped screenshot. The vision model only says WHERE to look (normalised
 * coordinates in the full image); the colours themselves are 5x5 pixel averages from the real pixels, never
 * a model-guessed hex.
 */
export function deriveDesign(chart: ExtractedChart, crop: PixelBuffer, rect: PixelRect, full: { width: number; height: number }): DerivedDesign {
  const sample = (p: NormPoint | undefined): string | null => {
    if (!p || p === NO_POINT || p[0] < 0) return null;
    const [x, y] = pointToCrop(p, rect, full.width, full.height);
    return sampleAverage(crop, x, y);
  };
  const sp = chart.samplePoints;

  // Background: the model's point, else a small inset from the crop's top-left corner (always page, never chart ink).
  const background = sample(sp?.background) ?? sampleAverage(crop, 15, 15);

  let textColor: string | null = null;
  const hinted = chart.style.textColor;
  if (hinted && background && contrastRatio(luminance(hinted), luminance(background)) >= MIN_TEXT_CONTRAST) textColor = hinted;

  const seriesColors = chart.series.map((_, i) => {
    const c = sample(sp?.series[i]);
    return c && background && colorDistance(c, background) < NEAR_BACKGROUND ? null : c;
  });

  const barColors: Record<number, string> = {};
  const singleBarSeries = chart.series.length === 1 && (chart.chartType === "bar" || chart.chartType === "horizontal-bar");
  if (singleBarSeries && sp && sp.bars.length > 0) {
    const bars = chart.labels.map((_, i) => {
      const c = sample(sp.bars[i]);
      return c && background && colorDistance(c, background) < NEAR_BACKGROUND ? null : c;
    });
    const base = seriesColors[0] ?? mostCommon(bars.filter((c): c is string => c !== null));
    if (base) {
      seriesColors[0] = base;
      bars.forEach((c, i) => {
        if (c && colorDistance(c, base) > SAME_COLOR) barColors[i] = c;
      });
    }
  }

  const design: ScanDesign = {
    background,
    textColor,
    barColors,
    aspect: snapAspect(rect.width, rect.height),
    showXAxis: chart.style.showXAxis ?? null,
    showYAxis: chart.style.showYAxis ?? null,
    showGridlines: chart.style.showGridlines ?? null,
    showDataLabels: chart.style.showDataLabels ?? null,
    dataLabelPosition: chart.style.dataLabelPosition ?? null,
  };
  return { design, seriesColors };
}

/** Colour shared by the most samples (within SAME_COLOR), used as the series colour when only bars were sampled. */
export function mostCommon(colors: string[]): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const c of colors) {
    const n = colors.filter((o) => colorDistance(o, c) <= SAME_COLOR).length;
    if (n > bestN) ((bestN = n), (best = c));
  }
  return best;
}
