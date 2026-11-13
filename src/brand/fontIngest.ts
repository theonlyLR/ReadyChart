import type { CustomFont, CustomFontFormat } from "../model/types";

export const FONT_EXTENSIONS = [".woff2", ".woff", ".ttf", ".otf"] as const;
export const FONT_ACCEPT = FONT_EXTENSIONS.join(",");
/** Absolute ceiling for an uploaded font (it lives in the document as a Data URL). */
export const FONT_MAX_BYTES = 5 * 1024 * 1024;
/** Above this a font is still usable in the studio and exports, but is never written to localStorage (Brand Kits). */
export const FONT_STORAGE_LIMIT_BYTES = 1.5 * 1024 * 1024;
/** The one CSS family name every uploaded font is registered under (no spaces/quotes, so it survives SVG/CSS escaping). */
export const CUSTOM_FONT_FAMILY = "RCCustomFont";

const MIME: Record<CustomFontFormat, string> = { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf" };
const CSS_FORMAT: Record<CustomFontFormat, string> = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };

export const fontMime = (f: CustomFontFormat): string => MIME[f];
export const fontCssFormat = (f: CustomFontFormat): string => CSS_FORMAT[f];

/** Identify a font by its magic bytes rather than trusting the extension or MIME type. */
export function detectFontFormat(bytes: Uint8Array): CustomFontFormat | null {
  if (bytes.length < 4) return null;
  const tag = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (tag === "wOF2") return "woff2";
  if (tag === "wOFF") return "woff";
  if (tag === "OTTO") return "otf";
  if (tag === "true" || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)) return "ttf";
  return null;
}

/** Returns an error message, or null when the file looks acceptable by name and size. */
export function validateFontFile(name: string, size: number): string | null {
  const lower = name.toLowerCase();
  if (!FONT_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "Font must be a .woff2, .woff, .ttf or .otf file.";
  if (size === 0) return "Font file is empty.";
  if (size > FONT_MAX_BYTES) return `Font must be ${FONT_MAX_BYTES / 1024 / 1024} MB or smaller.`;
  return null;
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

/** Decodes a `data:` URL to an ArrayBuffer. Anything that isn't a base64 data URL is refused (never fetches). */
export function dataUrlToBuffer(dataUrl: string): ArrayBuffer {
  const m = /^data:[^;,]*;base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error("Custom font is not a base64 data URL.");
  const bin = atob(m[1]!);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export interface IngestedFont {
  font: CustomFont;
  /** Non-blocking notice, e.g. the font is too large to be saved in a Brand Kit. */
  warning: string | null;
}

/**
 * Reads a local font file into a Data URL after proving the browser can actually parse it. Throws a readable
 * Error on any problem, leaving the document untouched.
 */
export async function ingestFont(file: File): Promise<IngestedFont> {
  const bad = validateFontFile(file.name, file.size);
  if (bad) throw new Error(bad);
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const format = detectFontFormat(bytes);
  if (!format) throw new Error("That file isn't a valid WOFF2, WOFF, TTF or OTF font.");
  try {
    await new FontFace(`${CUSTOM_FONT_FAMILY}Check`, buf.slice(0)).load();
  } catch {
    throw new Error("The browser couldn't read that font file.");
  }
  const name = file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Custom font";
  const font: CustomFont = { name, format, bytes: bytes.length, dataUrl: bytesToDataUrl(bytes, fontMime(format)) };
  const warning =
    bytes.length > FONT_STORAGE_LIMIT_BYTES
      ? `This font is ${(bytes.length / 1024 / 1024).toFixed(1)} MB. It works here and in exports, but is too large to save in a Brand Kit (limit ${FONT_STORAGE_LIMIT_BYTES / 1024 / 1024} MB).`
      : null;
  return { font, warning };
}
