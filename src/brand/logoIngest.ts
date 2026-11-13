import { rgbLuminance } from "../engine/theme";

export const LOGO_MIME_TYPES = ["image/png", "image/svg+xml", "image/jpeg", "image/webp"] as const;
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;
/** Longest side of the stored bitmap. Keeps Data URLs small enough for localStorage kits. */
export const LOGO_MAX_DIM = 512;

export interface LogoAsset {
  dataUrl: string;
  invertedDataUrl: string;
  aspect: number;
  luminance: number;
}

// ---------------------------------------------------------------------------------------------
// Pure helpers (unit tested, no DOM)
// ---------------------------------------------------------------------------------------------

/** Returns an error message, or null when the file is acceptable. */
export function validateLogoFile(type: string, size: number): string | null {
  if (!(LOGO_MIME_TYPES as readonly string[]).includes(type)) return "Logo must be a PNG, SVG, JPG or WebP file.";
  if (size > LOGO_MAX_BYTES) return "Logo must be 5 MB or smaller.";
  if (size === 0) return "Logo file is empty.";
  return null;
}

/**
 * SVG logos are rasterised through an <img> (scripts never run, nothing external loads), but we still refuse
 * markup that could carry active or remote content so a malicious file fails loudly instead of silently.
 */
export function svgUnsafeReason(svg: string): string | null {
  if (!/<svg[\s>]/i.test(svg)) return "Not a valid SVG file.";
  if (/<script[\s>/]/i.test(svg)) return "SVG contains a script.";
  if (/<foreignObject[\s>/]/i.test(svg)) return "SVG contains foreignObject content.";
  if (/\son[a-z]+\s*=/i.test(svg)) return "SVG contains event handlers.";
  if (/(?:href|src)\s*=\s*["']\s*(?!#|data:)[^"']/i.test(svg)) return "SVG references external resources.";
  if (/url\(\s*["']?\s*(?!#|data:)[a-z][a-z0-9+.-]*:/i.test(svg)) return "SVG references external resources.";
  if (/@import/i.test(svg)) return "SVG imports external stylesheets.";
  return null;
}

/** Scale (w, h) so the longest side is at most `max`. Never upscales. */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** Alpha-weighted mean relative luminance of RGBA pixels. Fully transparent images return 0.5 (unknown). */
export function pixelLuminance(rgba: ArrayLike<number>): number {
  let sum = 0;
  let weight = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const a = rgba[i + 3]! / 255;
    if (a === 0) continue;
    sum += rgbLuminance(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!) * a;
    weight += a;
  }
  return weight === 0 ? 0.5 : sum / weight;
}

/** In place: invert RGB, keep alpha. */
export function invertPixels(rgba: Uint8ClampedArray): void {
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    rgba[i] = 255 - rgba[i]!;
    rgba[i + 1] = 255 - rgba[i + 1]!;
    rgba[i + 2] = 255 - rgba[i + 2]!;
  }
}

// ---------------------------------------------------------------------------------------------
// Browser ingest: File -> local Data URLs (never an external URL, so exported canvases can't taint)
// ---------------------------------------------------------------------------------------------

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read the logo file."));
    r.readAsDataURL(file);
  });
}

function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode the logo image."));
    img.src = src;
  });
}

/**
 * Validate, decode, downscale and bake a logo into local Data URLs. Everything is rasterised to PNG
 * (preserving alpha) so SVG/JPG/WebP all take the same safe path through SVG, canvas and worker exports.
 */
export async function ingestLogo(file: File): Promise<LogoAsset> {
  const bad = validateLogoFile(file.type, file.size);
  if (bad) throw new Error(bad);
  if (file.type === "image/svg+xml") {
    const reason = svgUnsafeReason(await file.text());
    if (reason) throw new Error(reason);
  }
  const img = await decode(await readAsDataUrl(file));
  // SVGs without intrinsic size report 0; fall back to a square.
  const nw = img.naturalWidth || 256;
  const nh = img.naturalHeight || 256;
  const { width, height } = fitWithin(nw, nh, LOGO_MAX_DIM);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.drawImage(img, 0, 0, width, height);
  const dataUrl = canvas.toDataURL("image/png");
  const pixels = ctx.getImageData(0, 0, width, height);
  const luminance = pixelLuminance(pixels.data);
  invertPixels(pixels.data);
  ctx.putImageData(pixels, 0, 0);
  return { dataUrl, invertedDataUrl: canvas.toDataURL("image/png"), aspect: width / height, luminance };
}
