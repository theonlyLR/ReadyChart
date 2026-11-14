import { validateExtraction } from "./VisionProvider";
import type { VisionProvider } from "./VisionProvider";

const isAbort = (e: unknown): boolean => e instanceof Error && e.name === "AbortError";

/**
 * Never a dead end: if the primary provider fails for ANY reason (missing key, offline, rate limit, upstream error)
 * or answers with something unreadable, run the fallback inside the same scan. Only the user's own Cancel stops it.
 * The primary's error is logged for debugging but never shown to the user.
 */
export function withFallback(primary: VisionProvider, fallback: VisionProvider, onFallback?: () => void): VisionProvider {
  return {
    name: primary.name,
    usesPlotImage: primary.usesPlotImage,
    async extractChart(image, hints, signal) {
      try {
        const raw = await primary.extractChart(image, hints, signal);
        if (validateExtraction(raw).chart) return raw;
        console.warn(`[scan] ${primary.name} returned no usable chart; using the on-device scan`);
      } catch (e) {
        if (signal?.aborted || isAbort(e)) throw e;
        console.warn(`[scan] ${primary.name} failed; using the on-device scan`, e);
      }
      onFallback?.();
      return fallback.extractChart(image, hints, signal);
    },
  };
}
