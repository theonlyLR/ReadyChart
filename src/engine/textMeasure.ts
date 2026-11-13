import { FONT_FAMILY } from "./types";

export interface TextMeasurer {
  width(text: string, fontSize: number, fontWeight?: number): number;
}

/** Deterministic measurer for unit tests and as a no-canvas fallback. */
export function createApproxMeasurer(): TextMeasurer {
  return { width: (text, fontSize) => text.length * fontSize * 0.56 };
}

/** Real measureText on an OffscreenCanvas (same font stack as the render). */
export function createCanvasMeasurer(stack: string = FONT_FAMILY): TextMeasurer {
  if (typeof OffscreenCanvas === "undefined") return createApproxMeasurer();
  const ctx = new OffscreenCanvas(1, 1).getContext("2d");
  if (!ctx) return createApproxMeasurer();
  const memo = new Map<string, number>();
  return {
    width(text, fontSize, fontWeight = 400) {
      const key = `${fontWeight}|${fontSize}|${text}`;
      let w = memo.get(key);
      if (w === undefined) {
        ctx.font = `${fontWeight} ${fontSize}px ${stack}`;
        w = ctx.measureText(text).width;
        memo.set(key, w);
      }
      return w;
    },
  };
}
