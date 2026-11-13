import inter400 from "@fontsource/inter/files/inter-latin-400-normal.woff2?url";
import inter600 from "@fontsource/inter/files/inter-latin-600-normal.woff2?url";

let cached: Promise<string> | null = null;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fontFaceRule(weight: number, base64: string): string {
  // No quotes in the CSS so it survives XML/HTML entity escaping untouched.
  return `@font-face{font-family:Inter;font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${base64}) format(woff2);}`;
}

/** @font-face rules with the bundled Inter WOFF2 files inlined as Base64 (local Vite assets, never remote). */
export function getEmbeddedFontCss(): Promise<string> {
  cached ??= Promise.all(
    ([[400, inter400], [600, inter600]] as const).map(async ([weight, url]) => fontFaceRule(weight, toBase64(await (await fetch(url)).arrayBuffer()))),
  ).then((rules) => rules.join(""));
  return cached;
}

/** Raw WOFF2 bytes for the export worker. Fresh copies each call, because transferring detaches the buffer. */
export async function getFontBuffers(): Promise<{ weight: number; data: ArrayBuffer }[]> {
  return Promise.all(([[400, inter400], [600, inter600]] as const).map(async ([weight, url]) => ({ weight, data: await (await fetch(url)).arrayBuffer() })));
}
