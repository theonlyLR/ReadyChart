import type { AxisScale, ExtractedChart, NormBounds } from "../../vision/VisionProvider";
import type { PixelRect } from "./crop";

/** Where the plot crop (Image 2) sits inside the full screenshot (Image 1), in full-image pixels. */
export interface PlotFrame {
  rect: PixelRect;
}

/**
 * The geometry-first fields come back normalised to the plot crop when the model was shown one. Everything downstream
 * (box measuring, the value scale, chartBounds) works in the full screenshot's frame, so convert once here.
 * A point at (xn, yn) of the crop is at ((rect.x + xn/1000 * rect.width) / fullWidth) of the full image.
 */
export function plotToFull(chart: ExtractedChart, plot: PlotFrame, full: { width: number; height: number }): ExtractedChart {
  const { rect } = plot;
  const x = (n: number): number => Math.min(1000, Math.max(0, ((rect.x + (n / 1000) * rect.width) / full.width) * 1000));
  const y = (n: number): number => Math.min(1000, Math.max(0, ((rect.y + (n / 1000) * rect.height) / full.height) * 1000));
  const box = (b: NormBounds): NormBounds => [y(b[0]), x(b[1]), y(b[2]), x(b[3])];
  const vertical = chart.chartType !== "horizontal-bar";
  const axis = vertical ? y : x;
  const ax = chart.axisScale;
  const axisScale: AxisScale | undefined = ax
    ? {
        zeroBaselineCoord: ax.zeroBaselineCoord === null ? null : axis(ax.zeroBaselineCoord),
        topTickCoord: ax.topTickCoord === null ? null : axis(ax.topTickCoord),
        topTickValue: ax.topTickValue,
        ticks: ax.ticks?.map((t) => ({ value: t.value, coord: axis(t.coord) })),
      }
    : undefined;
  return {
    ...chart,
    frame: "full",
    plotBox: chart.plotBox ? box(chart.plotBox) : undefined,
    elementBounds: chart.elementBounds?.map((b) => (b ? box(b) : null)),
    axisScale,
  };
}
