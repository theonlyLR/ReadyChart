export type Platform = "linkedin" | "x" | "tiktok";

export const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "x", label: "X" },
  { value: "tiktok", label: "TikTok / Reels" },
];

export interface NormRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Largest centred rect of the given aspect (w/h) inside the canvas, normalised 0..1. */
function centeredCrop(canvasW: number, canvasH: number, aspect: number): NormRect {
  if (canvasW / canvasH > aspect) {
    const w = (canvasH * aspect) / canvasW;
    return { x: (1 - w) / 2, y: 0, width: w, height: 1 };
  }
  const h = canvasW / aspect / canvasH;
  return { x: 0, y: (1 - h) / 2, width: 1, height: h };
}

/**
 * Area that stays visible on each platform (everything outside is dimmed in the overlay).
 * LinkedIn feed crops link-style images to ~1.91:1; X timeline previews at 16:9;
 * TikTok/Reels covers the right rail and bottom caption with UI.
 */
export function safeZone(platform: Platform, canvasW: number, canvasH: number): NormRect {
  switch (platform) {
    case "linkedin":
      return centeredCrop(canvasW, canvasH, 1.91);
    case "x":
      return centeredCrop(canvasW, canvasH, 16 / 9);
    case "tiktok": {
      const base = centeredCrop(canvasW, canvasH, 9 / 16);
      const top = 0.1;
      const bottom = 0.22;
      const left = 0.05;
      const right = 0.16;
      return {
        x: base.x + base.width * left,
        y: base.y + base.height * top,
        width: base.width * (1 - left - right),
        height: base.height * (1 - top - bottom),
      };
    }
  }
}
