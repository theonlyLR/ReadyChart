import type { ChartDocument, ContrastBackdrop, FontFamilyId } from "../model/types";
import { FONT_IDS } from "../engine/fonts";
import { clamp } from "../model/validate";

export const KIT_STORAGE_KEY = "readychart.brandKits.v1";
export const MAX_KITS = 12;
const MAX_PALETTE = 12;
const MAX_NAME = 60;

export type Brand = ChartDocument["brand"];

/** A reusable look: logo + palette + typography + background. Never contains chart data. */
export interface BrandKit {
  id: string;
  name: string;
  brand: Brand;
  palette: string[];
  background: string;
}

const ANCHORS: Brand["anchor"][] = ["top-left", "top-right", "bottom-left", "bottom-right"];
const BACKDROPS: ContrastBackdrop[] = ["none", "frosted-pill", "auto-invert"];
const HEX = /^#[0-9a-f]{6}$/i;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : fallback);
/** Only local image Data URLs survive: a tampered kit must never smuggle in a remote URL (tainted canvas). */
const dataImage = (v: unknown): string | null => (typeof v === "string" && v.startsWith("data:image/") ? v : null);

/** Coerces untrusted JSON into a valid kit, or null if it is unusable. */
export function sanitizeKit(raw: unknown): BrandKit | null {
  if (!isObj(raw) || typeof raw.id !== "string" || !raw.id || typeof raw.name !== "string") return null;
  const b = isObj(raw.brand) ? raw.brand : {};
  const logo = dataImage(b.logoDataUrl);
  const palette = Array.isArray(raw.palette) ? raw.palette.filter((c): c is string => typeof c === "string" && HEX.test(c)).slice(0, MAX_PALETTE) : [];
  const background = typeof raw.background === "string" && HEX.test(raw.background) ? raw.background : "#FFFFFF";
  return {
    id: raw.id,
    name: raw.name.trim().slice(0, MAX_NAME) || "Untitled kit",
    palette,
    background,
    brand: {
      logoDataUrl: logo,
      logoInvertedDataUrl: logo ? dataImage(b.logoInvertedDataUrl) : null,
      logoAspect: logo ? num(b.logoAspect, 0.05, 20, 1) : 1,
      logoLuminance: logo ? num(b.logoLuminance, 0, 1, 0.5) : 0.5,
      anchor: ANCHORS.includes(b.anchor as Brand["anchor"]) ? (b.anchor as Brand["anchor"]) : "top-right",
      sizePx: num(b.sizePx, 24, 320, 64),
      opacity: num(b.opacity, 0.1, 1, 1),
      contrastBackdrop: BACKDROPS.includes(b.contrastBackdrop as ContrastBackdrop) ? (b.contrastBackdrop as ContrastBackdrop) : "none",
      fontFamily: FONT_IDS.includes(b.fontFamily as FontFamilyId) ? (b.fontFamily as FontFamilyId) : "inter",
    },
  };
}

/** Never throws: missing/corrupt/old-version storage yields an empty vault. */
export function parseKits(json: string | null): BrandKit[] {
  if (!json) return [];
  try {
    const data: unknown = JSON.parse(json);
    if (!isObj(data) || data.version !== 1 || !Array.isArray(data.kits)) return [];
    const seen = new Set<string>();
    const kits: BrandKit[] = [];
    for (const raw of data.kits) {
      const k = sanitizeKit(raw);
      if (k && !seen.has(k.id)) {
        seen.add(k.id);
        kits.push(k);
      }
    }
    return kits.slice(0, MAX_KITS);
  } catch {
    return [];
  }
}

export const serializeKits = (kits: BrandKit[]): string => JSON.stringify({ version: 1, kits });

/** Snapshot the document's current brand, series colours and background into a kit. */
export function kitFromDoc(doc: ChartDocument, name: string, id: string): BrandKit {
  return {
    id,
    name: name.trim().slice(0, MAX_NAME) || "Untitled kit",
    brand: structuredClone(doc.brand),
    palette: doc.data.series.map((s) => s.color),
    background: doc.canvas.background,
  };
}

/**
 * Immer recipe body: applies a kit to a document draft. Touches only /brand, /canvas/background and series
 * *colours* (never labels or values), so applying a kit can't alter the data. Extra series reuse the palette cyclically.
 */
export function applyKitToDraft(d: ChartDocument, kit: BrandKit): void {
  d.brand = structuredClone(kit.brand);
  d.canvas.background = kit.background;
  if (kit.palette.length > 0) {
    d.data.series.forEach((s, i) => {
      s.color = kit.palette[i % kit.palette.length]!;
    });
  }
}
