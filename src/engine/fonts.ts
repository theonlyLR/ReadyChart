import type { FontFamilyId } from "../model/types";

export interface FontDef {
  id: FontFamilyId;
  label: string;
  /** CSS family name used by @font-face / FontFace registration. */
  family: string;
  /** Full font stack used for measuring, SVG and canvas drawing. */
  stack: string;
}

/** The curated, bundled typefaces. Every one ships as local WOFF2 (400 + 600), so exports never fetch fonts. */
export const FONTS: Record<FontFamilyId, FontDef> = {
  inter: { id: "inter", label: "Inter", family: "Inter", stack: "Inter, system-ui, sans-serif" },
  lora: { id: "lora", label: "Lora (serif)", family: "Lora", stack: "Lora, Georgia, serif" },
  "space-grotesk": { id: "space-grotesk", label: "Space Grotesk", family: "Space Grotesk", stack: "Space Grotesk, system-ui, sans-serif" },
  // The uploaded font's bytes live in doc.brand.customFont; this entry only names the registered family.
  custom: { id: "custom", label: "Custom upload", family: "RCCustomFont", stack: "RCCustomFont, Inter, system-ui, sans-serif" },
};

/** The curated presets (everything except the upload slot). */
export const FONT_IDS = (Object.keys(FONTS) as FontFamilyId[]).filter((id) => id !== "custom");

/** Unknown ids (e.g. a stale saved kit) fall back to Inter. */
export const fontDef = (id: string | undefined): FontDef => (id && id in FONTS ? FONTS[id as FontFamilyId] : FONTS.inter);
export const fontStack = (id: string | undefined): string => fontDef(id).stack;
