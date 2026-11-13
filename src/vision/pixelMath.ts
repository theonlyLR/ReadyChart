/** Two reference ticks measured in image pixels, used to turn a bar/point's pixel position into a data value. */
export interface AxisCalibration {
  /** Pixel y of the zero (or other known) baseline. */
  baselinePx: number;
  /** Value at the baseline. Almost always 0. */
  baselineValue: number;
  /** Pixel y of a labelled tick (ideally the top one, for the best precision). */
  topTickPx: number;
  topTickValue: number;
}

export function isValidCalibration(c: AxisCalibration): boolean {
  return [c.baselinePx, c.baselineValue, c.topTickPx, c.topTickValue].every(Number.isFinite) && c.baselinePx !== c.topTickPx && c.baselineValue !== c.topTickValue;
}

/**
 * Deterministic linear interpolation (SPEC §4.3): value = baselineValue + (px - baselinePx) * valuePerPixel.
 * Image y grows downward, so a bar top above the baseline gets a larger value. Rounded to 4 significant figures
 * so pixel jitter doesn't produce 17-digit values.
 */
export function valueAtPixel(cal: AxisCalibration, px: number): number {
  const perPx = (cal.topTickValue - cal.baselineValue) / (cal.topTickPx - cal.baselinePx);
  const v = cal.baselineValue + (px - cal.baselinePx) * perPx;
  return Number(v.toPrecision(4));
}

/** Convert many pixel positions at once. Returns null when the calibration is degenerate. */
export function valuesFromPixels(cal: AxisCalibration, pxs: (number | null)[]): (number | null)[] | null {
  if (!isValidCalibration(cal)) return null;
  return pxs.map((p) => (p === null || !Number.isFinite(p) ? null : valueAtPixel(cal, p)));
}
