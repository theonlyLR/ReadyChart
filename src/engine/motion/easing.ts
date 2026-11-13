/** Pure easing math. No timers, no state: same input, same output. */

export type Easing = (t: number) => number;

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/** CSS-style cubic-bezier(x1, y1, x2, y2). y1/y2 may leave [0,1] for overshoot. Fixed iteration counts keep it deterministic. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sy = (s: number) => ((ay * s + by) * s + cy) * s;
  const dsx = (s: number) => (3 * ax * s + 2 * bx) * s + cx;

  return (t) => {
    const x = clamp01(t);
    if (x === 0 || x === 1) return x;
    let s = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(s) - x;
      if (Math.abs(err) < 1e-7) return sy(s);
      const d = dsx(s);
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    let lo = 0;
    let hi = 1;
    s = x;
    for (let i = 0; i < 40; i++) {
      const v = sx(s);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return sy(s);
  };
}

/** Spring constants are normalised so a unit mass and a 0 -> 1 step with zero initial velocity are always assumed. */
function springParams(stiffness: number, damping: number) {
  const k = Math.max(1, stiffness);
  const w0 = Math.sqrt(k);
  const zeta = Math.max(0.01, damping) / (2 * w0);
  return { w0, zeta };
}

/**
 * Closed-form damped harmonic oscillator step response (mass 1, x(0)=0, v(0)=0, target 1).
 * Analytic in t, so scrubbing to any time gives the exact value with no integration drift.
 */
export function springProgress(tSec: number, stiffness: number, damping: number): number {
  if (tSec <= 0) return 0;
  const { w0, zeta } = springParams(stiffness, damping);
  if (Math.abs(zeta - 1) < 1e-6) return 1 - Math.exp(-w0 * tSec) * (1 + w0 * tSec);
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const decay = Math.exp(-zeta * w0 * tSec);
    return 1 - decay * (Math.cos(wd * tSec) + ((zeta * w0) / wd) * Math.sin(wd * tSec));
  }
  const s = w0 * Math.sqrt(zeta * zeta - 1);
  const r1 = -zeta * w0 + s;
  const r2 = -zeta * w0 - s;
  return 1 - (r2 * Math.exp(r1 * tSec) - r1 * Math.exp(r2 * tSec)) / (r2 - r1);
}

/** Time of the first overshoot peak for an underdamped spring, or null when it never overshoots. */
export function springPeakSec(stiffness: number, damping: number): number | null {
  const { w0, zeta } = springParams(stiffness, damping);
  if (zeta >= 1) return null;
  return Math.PI / (w0 * Math.sqrt(1 - zeta * zeta));
}

export const SPRING_MIN_SETTLE_MS = 200;
export const SPRING_MAX_SETTLE_MS = 3000;

/** Time for the spring's envelope to fall under 0.1%, clamped to a sane track length. */
export function springSettleMs(stiffness: number, damping: number): number {
  const { w0, zeta } = springParams(stiffness, damping);
  const rate = zeta <= 1 ? zeta * w0 : w0 * (zeta - Math.sqrt(zeta * zeta - 1));
  const ms = (Math.log(1000) / rate) * 1000;
  return Math.round(Math.min(SPRING_MAX_SETTLE_MS, Math.max(SPRING_MIN_SETTLE_MS, ms)));
}
