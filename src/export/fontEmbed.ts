import inter400 from "@fontsource/inter/files/inter-latin-400-normal.woff2?url";
import inter600 from "@fontsource/inter/files/inter-latin-600-normal.woff2?url";
import lora400 from "@fontsource/lora/files/lora-latin-400-normal.woff2?url";
import lora600 from "@fontsource/lora/files/lora-latin-600-normal.woff2?url";
import grotesk400 from "@fontsource/space-grotesk/files/space-grotesk-latin-400-normal.woff2?url";
import grotesk600 from "@fontsource/space-grotesk/files/space-grotesk-latin-600-normal.woff2?url";
import { fontDef } from "../engine/fonts";
import type { FontFamilyId } from "../model/types";

const FILES: Record<FontFamilyId, readonly [string, string]> = {
  inter: [inter400, inter600],
  lora: [lora400, lora600],
  "space-grotesk": [grotesk400, grotesk600],
};

const cache = new Map<FontFamilyId, Promise<string>>();

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fontFaceRule(weight: number, base64: string, family = "Inter"): string {
  // No quotes in the CSS so it survives XML/HTML entity escaping untouched.
  return `@font-face{font-family:${family};font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${base64}) format(woff2);}`;
}

const filesFor = (id: string | undefined): [number, string][] => {
  const urls = FILES[fontDef(id).id];
  return [[400, urls[0]], [600, urls[1]]];
};

/** @font-face rules for the active family with its WOFF2 files inlined as Base64 (local Vite assets, never remote). */
export function getEmbeddedFontCss(fontFamily?: string): Promise<string> {
  const def = fontDef(fontFamily);
  let p = cache.get(def.id);
  if (!p) {
    p = Promise.all(filesFor(def.id).map(async ([weight, url]) => fontFaceRule(weight, toBase64(await (await fetch(url)).arrayBuffer()), def.family))).then((rules) => rules.join(""));
    cache.set(def.id, p);
  }
  return p;
}

/** Raw WOFF2 bytes for the export worker. Fresh copies each call, because transferring detaches the buffer. */
export async function getFontBuffers(fontFamily?: string): Promise<{ weight: number; data: ArrayBuffer }[]> {
  return Promise.all(filesFor(fontFamily).map(async ([weight, url]) => ({ weight, data: await (await fetch(url)).arrayBuffer() })));
}
