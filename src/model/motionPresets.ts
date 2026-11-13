import type { ChartDocument } from "./types";

export type MotionSettings = ChartDocument["motion"];
export type MotionPresetId = "editorial-crisp" | "social-pop" | "domino-cascade";

/** Signature motion presets. Applied through the document store, so each is one undo step. */
export const MOTION_PRESETS: { id: MotionPresetId; label: string; hint: string; motion: MotionSettings }[] = [
  {
    id: "editorial-crisp",
    label: "Editorial Crisp",
    hint: "Fast ease-out, tight left-to-right stagger, long readable hold",
    motion: {
      enabled: true,
      physicsMode: "bezier",
      durationMs: 900,
      easing: [0.22, 1, 0.36, 1],
      springStiffness: 170,
      springDamping: 22,
      staggerMs: 40,
      maxTotalStaggerMs: 400,
      staggerDirection: "left-to-right",
      numberRollUp: true,
      holdEndMs: 1500,
      loopResetMs: 300,
    },
  },
  {
    id: "social-pop",
    label: "Social Pop",
    hint: "Bouncy underdamped spring, smallest bars pop first",
    motion: {
      enabled: true,
      physicsMode: "spring",
      durationMs: 1200,
      easing: [0.22, 1, 0.36, 1],
      springStiffness: 260,
      springDamping: 16,
      staggerMs: 70,
      maxTotalStaggerMs: 500,
      staggerDirection: "smallest-to-largest",
      numberRollUp: true,
      holdEndMs: 1200,
      loopResetMs: 400,
    },
  },
  {
    id: "domino-cascade",
    label: "Domino Cascade",
    hint: "Soft spring with a long, deliberate left-to-right cascade",
    motion: {
      enabled: true,
      physicsMode: "spring",
      durationMs: 1200,
      easing: [0.22, 1, 0.36, 1],
      springStiffness: 170,
      springDamping: 26,
      staggerMs: 140,
      maxTotalStaggerMs: 1400,
      staggerDirection: "left-to-right",
      numberRollUp: true,
      holdEndMs: 1200,
      loopResetMs: 400,
    },
  },
];

export function matchingPreset(m: MotionSettings): MotionPresetId | null {
  return MOTION_PRESETS.find((p) => JSON.stringify(p.motion) === JSON.stringify(m))?.id ?? null;
}
