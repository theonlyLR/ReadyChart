import type { ChartDocument } from "../model/types";
import { luminance } from "../engine/theme";

/** Minimum WCAG-style contrast between logo and background before auto-invert kicks in. */
export const MIN_LOGO_CONTRAST = 3;
/** Frosted-pill padding around the logo, as a fraction of the logo's longest side. */
export const PILL_PAD_RATIO = 0.2;

export interface LogoTreatment {
  /** Image to draw: the original or the baked inverted copy. */
  href: string;
  /** Rounded backdrop behind the logo, or null. */
  pill: { fill: string; opacity: number } | null;
  inverted: boolean;
}

export function contrastRatio(l1: number, l2: number): number {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Pure: decides how the logo is drawn from the document alone, so live canvas, SVG, PNG and GIF/WebP
 * all agree. The logo sits in a reserved safe zone, so what is behind it is the canvas background.
 * A transparent canvas has no known backdrop: auto-invert falls back to a pill (safe on any surface).
 * The inverted copy's luminance is approximated as 1 - L (exact for greys, close enough for brand marks).
 */
export function resolveLogoTreatment(doc: ChartDocument): LogoTreatment | null {
  const b = doc.brand;
  if (!b.logoDataUrl) return null;
  const plain: LogoTreatment = { href: b.logoDataUrl, pill: null, inverted: false };
  const pill = (): { fill: string; opacity: number } =>
    b.logoLuminance < 0.5 ? { fill: "#FFFFFF", opacity: 0.72 } : { fill: "#0F172A", opacity: 0.62 };

  switch (b.contrastBackdrop) {
    case "none":
      return plain;
    case "frosted-pill":
      return { ...plain, pill: pill() };
    case "auto-invert": {
      if (doc.canvas.transparent) return { ...plain, pill: pill() };
      const bg = luminance(doc.canvas.background);
      const current = contrastRatio(b.logoLuminance, bg);
      const flipped = contrastRatio(1 - b.logoLuminance, bg);
      if (current < MIN_LOGO_CONTRAST && flipped > current && b.logoInvertedDataUrl) {
        return { href: b.logoInvertedDataUrl, pill: null, inverted: true };
      }
      return plain;
    }
  }
}
