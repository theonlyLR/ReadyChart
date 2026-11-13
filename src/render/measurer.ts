import { createCanvasMeasurer } from "../engine/textMeasure";
import type { TextMeasurer } from "../engine/textMeasure";

let current: TextMeasurer | null = null;

/** Shared canvas measurer (memoised). Reset once webfonts finish loading so cached widths aren't stale. */
export function getMeasurer(): TextMeasurer {
  return (current ??= createCanvasMeasurer());
}

export function resetMeasurer(): void {
  current = null;
}
