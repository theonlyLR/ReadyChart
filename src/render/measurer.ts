import { createCanvasMeasurer } from "../engine/textMeasure";
import type { TextMeasurer } from "../engine/textMeasure";
import { fontStack } from "../engine/fonts";

const cache = new Map<string, TextMeasurer>();

/** Shared canvas measurer per font family (memoised). Reset once webfonts load so cached widths aren't stale. */
export function getMeasurer(fontFamily?: string): TextMeasurer {
  const stack = fontStack(fontFamily);
  let m = cache.get(stack);
  if (!m) {
    m = createCanvasMeasurer(stack);
    cache.set(stack, m);
  }
  return m;
}

export function resetMeasurer(): void {
  cache.clear();
}
