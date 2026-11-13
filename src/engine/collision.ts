import type { TextMeasurer } from "./textMeasure";

export interface LabelStrategy {
  rotation: 0 | -45;
  /** Show every Nth label. */
  step: number;
  /** Vertical space the label row needs below the axis. */
  height: number;
  /** Widest shown label (unrotated). */
  maxWidth: number;
}

const SIN45 = Math.SQRT1_2;

/**
 * SPEC §2 label collision solver: 0deg -> -45deg tilt -> skip every Nth.
 * Tilted labels run parallel, so they collide when bandWidth*sin45 < line height.
 */
export function solveXLabels(labels: string[], bandWidth: number, measurer: TextMeasurer, fontSize: number): LabelStrategy {
  const lineH = fontSize * 1.2;
  const widths = labels.map((l) => measurer.width(l, fontSize));
  const maxAll = widths.reduce((m, w) => Math.max(m, w), 0);
  const gap = Math.max(8, fontSize * 0.5);

  if (labels.length === 0 || maxAll + gap <= bandWidth) {
    return { rotation: 0, step: 1, height: lineH, maxWidth: maxAll };
  }

  const perpendicular = Math.max(bandWidth * SIN45, 1);
  const step = Math.max(1, Math.ceil((lineH * 1.1) / perpendicular));
  const maxShown = widths.reduce((m, w, i) => (i % step === 0 ? Math.max(m, w) : m), 0);
  return { rotation: -45, step, height: (maxShown + lineH) * SIN45, maxWidth: maxShown };
}

/** Horizontal-bar category labels never rotate; they only thin out when bands get shorter than a line. */
export function solveYLabelStep(bandHeight: number, fontSize: number): number {
  return Math.max(1, Math.ceil((fontSize * 1.3) / Math.max(bandHeight, 1)));
}
