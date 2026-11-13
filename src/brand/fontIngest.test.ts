import { describe, expect, it, vi } from "vitest";
import { bytesToDataUrl, dataUrlToBuffer, detectFontFormat, FONT_MAX_BYTES, FONT_STORAGE_LIMIT_BYTES, validateFontFile } from "./fontIngest";
import { applyKitToDraft, customFontTooLargeForKit, kitFromDoc, sanitizeKit } from "./kits";
import { createDefaultDocument } from "../model/defaults";
import { customFontRule, getEmbeddedFontCss, getFontBuffers } from "../export/fontEmbed";
import type { CustomFont } from "../model/types";

const tag = (s: string) => new Uint8Array([...Array.from(s, (c) => c.charCodeAt(0)), 0, 0, 0, 0]);
const font = (bytes: number): CustomFont => ({ name: "Brand Sans", format: "woff2", bytes, dataUrl: bytesToDataUrl(tag("wOF2"), "font/woff2") });

describe("font ingest helpers", () => {
  it("detects formats by magic bytes", () => {
    expect(detectFontFormat(tag("wOF2"))).toBe("woff2");
    expect(detectFontFormat(tag("wOFF"))).toBe("woff");
    expect(detectFontFormat(tag("OTTO"))).toBe("otf");
    expect(detectFontFormat(new Uint8Array([0, 1, 0, 0, 9]))).toBe("ttf");
    expect(detectFontFormat(tag("<svg"))).toBeNull();
  });
  it("validates name and size", () => {
    expect(validateFontFile("a.woff2", 100)).toBeNull();
    expect(validateFontFile("a.exe", 100)).not.toBeNull();
    expect(validateFontFile("a.ttf", 0)).not.toBeNull();
    expect(validateFontFile("a.otf", FONT_MAX_BYTES + 1)).not.toBeNull();
  });
  it("round-trips bytes through a Data URL and refuses non-data URLs", () => {
    const src = new Uint8Array([1, 2, 3, 250, 251]);
    expect(Array.from(new Uint8Array(dataUrlToBuffer(bytesToDataUrl(src, "font/ttf"))))).toEqual(Array.from(src));
    expect(() => dataUrlToBuffer("https://example.com/x.woff2")).toThrow();
  });
});

describe("custom font in kits", () => {
  it("keeps a small font and drops one over the localStorage limit", () => {
    const doc = createDefaultDocument();
    doc.brand.fontFamily = "custom";
    doc.brand.customFont = font(1000);
    const kit = kitFromDoc(doc, "k", "id1");
    expect(kit.brand.fontFamily).toBe("custom");
    expect(sanitizeKit(JSON.parse(JSON.stringify(kit)))!.brand.customFont?.name).toBe("Brand Sans");

    doc.brand.customFont = font(FONT_STORAGE_LIMIT_BYTES + 1);
    expect(customFontTooLargeForKit(doc)).toBe(true);
    const big = kitFromDoc(doc, "k", "id2");
    expect(big.brand.fontFamily).toBe("inter");
    expect(big.brand.customFont).toBeUndefined();
  });
  it("sanitize rejects remote or oversized fonts", () => {
    const base = { id: "a", name: "n", brand: { fontFamily: "custom", customFont: { name: "x", format: "woff2", bytes: 10, dataUrl: "https://evil/x.woff2" } } };
    expect(sanitizeKit(base)!.brand.fontFamily).toBe("inter");
    const huge = { ...base, brand: { fontFamily: "custom", customFont: { ...font(FONT_STORAGE_LIMIT_BYTES + 1) } } };
    expect(sanitizeKit(huge)!.brand.customFont).toBeUndefined();
  });
  it("applying a preset-font kit removes the uploaded font from the doc", () => {
    const doc = createDefaultDocument();
    const kit = kitFromDoc(doc, "plain", "id3");
    doc.brand.fontFamily = "custom";
    doc.brand.customFont = font(10);
    applyKitToDraft(doc, kit);
    expect(doc.brand.customFont).toBeUndefined();
    expect(doc.brand.fontFamily).toBe("inter");
  });
});

describe("custom font export embedding", () => {
  it("SVG css inlines the data URL; worker buffers decode it", async () => {
    vi.stubGlobal("fetch", async () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }));
    const f = font(10);
    const css = await getEmbeddedFontCss("custom", f);
    expect(css).toContain(customFontRule(f, "RCCustomFont"));
    expect(css).toContain("data:font/woff2;base64,");
    expect(css).not.toMatch(/url\(https?:/);
    const bufs = await getFontBuffers("custom", f);
    expect(bufs).toHaveLength(1);
    expect(bufs[0]!.weightRange).toBe("100 900");
    expect(bufs[0]!.data.byteLength).toBe(8);
  });
});
