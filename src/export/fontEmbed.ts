import inter400 from "@fontsource/inter/files/inter-latin-400-normal.woff2?url";
import inter600 from "@fontsource/inter/files/inter-latin-600-normal.woff2?url";
import lora400 from "@fontsource/lora/files/lora-latin-400-normal.woff2?url";
import lora600 from "@fontsource/lora/files/lora-latin-600-normal.woff2?url";
import grotesk400 from "@fontsource/space-grotesk/files/space-grotesk-latin-400-normal.woff2?url";
import grotesk600 from "@fontsource/space-grotesk/files/space-grotesk-latin-600-normal.woff2?url";
import { fontDef } from "../engine/fonts";
import { dataUrlToBuffer, fontCssFormat } from "../brand/fontIngest";
import type { CustomFont, FontFamilyId } from "../model/types";

const FILES: Record<Exclude<FontFamilyId, "custom">, readonly [string, string]> = {
  inter: [inter400, inter600],
  lora: [lora400, lora600],
  "space-grotesk": [grotesk400, grotesk600],
};

const cache = new Map<string, Promise<string>>();

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

const bundledId = (id: string | undefined): Exclude<FontFamilyId, "custom"> => {
  const resolved = fontDef(id).id;
  return resolved === "custom" ? "inter" : resolved;
};

const filesFor = (id: string | undefined): [number, string][] => {
  const urls = FILES[bundledId(id)];
  return [[400, urls[0]], [600, urls[1]]];
};

const isCustom = (fontFamily: string | undefined, custom: CustomFont | undefined): custom is CustomFont => fontFamily === "custom" && custom !== undefined;

/** One @font-face covering every weight, with the uploaded file inlined as its original Data URL. */
export function customFontRule(custom: CustomFont, family: string): string {
  return `@font-face{font-family:${family};font-style:normal;font-weight:100 900;src:url(${custom.dataUrl}) format(${fontCssFormat(custom.format)});}`;
}

/** @font-face rules for the active family with its WOFF2 files inlined as Base64 (local Vite assets, never remote). */
export function getEmbeddedFontCss(fontFamily?: string, customFont?: CustomFont): Promise<string> {
  const def = fontDef(fontFamily);
  if (isCustom(fontFamily, customFont)) {
    // The stack falls back to Inter, so ship Inter too in case a glyph is missing from the upload.
    return getEmbeddedFontCss("inter").then((inter) => customFontRule(customFont, def.family) + inter);
  }
  const key = bundledId(fontFamily);
  let p = cache.get(key);
  if (!p) {
    const family = fontDef(key).family;
    p = Promise.all(filesFor(key).map(async ([weight, url]) => fontFaceRule(weight, toBase64(await (await fetch(url)).arrayBuffer()), family))).then((rules) => rules.join(""));
    cache.set(key, p);
  }
  return p;
}

/** Raw WOFF2 bytes for the export worker. Fresh copies each call, because transferring detaches the buffer. */
export async function getFontBuffers(fontFamily?: string, customFont?: CustomFont): Promise<{ weight: number; data: ArrayBuffer; weightRange?: string }[]> {
  if (isCustom(fontFamily, customFont)) return [{ weight: 400, weightRange: "100 900", data: dataUrlToBuffer(customFont.dataUrl) }];
  return Promise.all(filesFor(fontFamily).map(async ([weight, url]) => ({ weight, data: await (await fetch(url)).arrayBuffer() })));
}
