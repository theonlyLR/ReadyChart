import type { ChartDocument } from "../../model/types";
import { cubicBezier, springPeakSec, springProgress } from "./easing";
import { buildTimeline } from "./timeline";

/**
 * Everything the geometry builders need to draw one instant. Plain serialisable data (no functions,
 * no layout, no measurer) so it can be computed anywhere, including inside the export WebWorker.
 */
export interface FrameState {
  timeMs: number;
  totalMs: number;
  /** Stage Set progress 0..1 (already multiplied by the loop-reset fade). */
  grid: number;
  /** Hero progress per item; may overshoot 1 for springs / back-easing. Empty = every item at 1. */
  items: number[];
  /** Number roll-up fraction per item, clamped 0..1. Empty = final values. */
  roll: number[];
  /** Hero-layer opacity multiplier (loop-reset fade), 0..1. */
  fade: number;
}

export const FINAL_FRAME: FrameState = { timeMs: 0, totalMs: 0, grid: 1, items: [], roll: [], fade: 1 };

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const stageEase = cubicBezier(0.22, 1, 0.36, 1);
const fadeEase = cubicBezier(0.4, 0, 0.2, 1);

export const itemProgress = (f: FrameState, i: number): number => f.items[i] ?? 1;
export const itemRoll = (f: FrameState, i: number): number => f.roll[i] ?? 1;
/** Labels and markers fade in over the first quarter of an item's own growth. */
export const itemAlpha = (f: FrameState, i: number): number => clamp01(itemProgress(f, i) * 4) * f.fade;
/** Spread into a node: only sets `opacity` when below 1, so static frames stay byte-identical to the M1 scene. */
export const opacityProp = (a: number): { opacity?: number } => (a < 1 ? { opacity: a } : {});
/** Rolling number value: exact at roll >= 1. */
export const rollValue = (v: number, roll: number): number => (roll >= 1 ? v : v * roll);
/** Per-tick gridline opacity factor with a small stagger from the first tick to the last. */
export const gridAlpha = (f: FrameState, j: number, n: number): number => clamp01(f.grid * 1.5 - (n > 1 ? 0.5 * (j / (n - 1)) : 0));

/**
 * The single source of motion. Pure: (doc, timeMs) -> FrameState. Live scrubbing, playback and GIF/WebP
 * frame stepping all call this with a time, so they cannot drift. t >= totalMs wraps (loop seam).
 */
export function computeFrameState(doc: ChartDocument, timeMs: number): FrameState {
  const m = doc.motion;
  if (!m.enabled) return FINAL_FRAME;
  const tl = buildTimeline(doc);
  const total = Math.max(1, tl.totalMs);
  const t = timeMs >= total ? timeMs % total : Math.max(0, timeMs);

  const ease = m.physicsMode === "spring" ? (x: number) => springProgress((x * tl.trackMs) / 1000, m.springStiffness, m.springDamping) : cubicBezier(...m.easing);
  const items = tl.delays.map((d) => {
    const local = (t - tl.heroStartMs - d) / tl.trackMs;
    return local <= 0 ? 0 : local >= 1 ? 1 : ease(local);
  });

  // Numbers must never dip back below their final value after a spring's first peak, so freeze the roll at 1 from there.
  const peakSec = m.physicsMode === "spring" ? springPeakSec(m.springStiffness, m.springDamping) : null;
  const peakLocal = peakSec === null ? Infinity : (peakSec * 1000) / tl.trackMs;
  const roll = tl.delays.map((d, i) => {
    const local = (t - tl.heroStartMs - d) / tl.trackMs;
    return !m.numberRollUp || local >= peakLocal ? 1 : clamp01(items[i]!);
  });

  const resetMs = total - tl.holdEndMs;
  const fade = resetMs > 0 && t > tl.holdEndMs ? 1 - fadeEase((t - tl.holdEndMs) / resetMs) : 1;
  const grid = (tl.stageMs > 0 ? stageEase(t / tl.stageMs) : 1) * fade;

  return { timeMs: t, totalMs: total, grid, items, roll, fade };
}
