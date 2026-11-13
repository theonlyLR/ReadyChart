import type { AnimatedFormat } from "../pipeline";

export const BUDGET_BYTES = 5 * 1024 * 1024;

/** GIF delays are whole centiseconds and browsers read 0-1 cs as 10 cs, so 50 fps is the real ceiling. */
export const FPS_OPTIONS: Record<AnimatedFormat, number[]> = { gif: [50, 25, 20], awebp: [60, 30, 24] };
export const DEFAULT_FPS: Record<AnimatedFormat, number> = { gif: 25, awebp: 30 };

/** Fit-under-budget ladder: step FPS down first, then scale (spec: FPS 60 -> 24, scale 2x -> 1.5x). */
export const FIT_LADDER: Record<AnimatedFormat, { fps: number; scale: number }[]> = {
  awebp: [
    { fps: 60, scale: 2 },
    { fps: 30, scale: 2 },
    { fps: 24, scale: 2 },
    { fps: 24, scale: 1.5 },
    { fps: 24, scale: 1 },
  ],
  gif: [
    { fps: 50, scale: 2 },
    { fps: 25, scale: 2 },
    { fps: 20, scale: 2 },
    { fps: 20, scale: 1.5 },
    { fps: 20, scale: 1 },
  ],
};
