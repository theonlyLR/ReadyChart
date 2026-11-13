import { describe, expect, it } from "vitest";
import { createDefaultDocument } from "../model/defaults";
import type { ChartDocument } from "../model/types";
import { contrastRatio, resolveLogoTreatment } from "./contrast";
import { fitWithin, invertPixels, pixelLuminance, svgUnsafeReason, validateLogoFile } from "./logoIngest";

const docWith = (bg: string, logoLum: number, mode: ChartDocument["brand"]["contrastBackdrop"], transparent = false): ChartDocument => {
  const d = createDefaultDocument();
  d.canvas.background = bg;
  d.canvas.transparent = transparent;
  d.brand = { ...d.brand, logoDataUrl: "data:image/png;base64,AAAA", logoInvertedDataUrl: "data:image/png;base64,BBBB", logoLuminance: logoLum, contrastBackdrop: mode };
  return d;
};

describe("logo file validation", () => {
  it("accepts PNG, SVG, JPG and WebP", () => {
    for (const t of ["image/png", "image/svg+xml", "image/jpeg", "image/webp"]) expect(validateLogoFile(t, 1000)).toBeNull();
  });
  it("rejects other types, empty and oversized files", () => {
    expect(validateLogoFile("image/gif", 1000)).not.toBeNull();
    expect(validateLogoFile("application/pdf", 1000)).not.toBeNull();
    expect(validateLogoFile("image/png", 0)).not.toBeNull();
    expect(validateLogoFile("image/png", 6 * 1024 * 1024)).not.toBeNull();
  });
});

describe("svg safety", () => {
  it("allows a plain SVG with internal refs and data URIs", () => {
    expect(svgUnsafeReason('<svg xmlns="http://www.w3.org/2000/svg"><use href="#a"/><image href="data:image/png;base64,AA"/></svg>')).toBeNull();
  });
  it.each([
    ["script", "<svg><script>alert(1)</script></svg>"],
    ["handler", '<svg onload="x()"></svg>'],
    ["foreignObject", "<svg><foreignObject/></svg>"],
    ["external href", '<svg><image href="https://evil.test/a.png"/></svg>'],
    ["external css url", '<svg><rect style="fill:url(https://evil.test/x)"/></svg>'],
    ["import", "<svg><style>@import 'x.css';</style></svg>"],
    ["not svg", "<html></html>"],
  ])("rejects %s", (_n, svg) => {
    expect(svgUnsafeReason(svg)).not.toBeNull();
  });
});

describe("pixel helpers", () => {
  it("fitWithin downscales the long side and never upscales", () => {
    expect(fitWithin(2000, 1000, 512)).toEqual({ width: 512, height: 256 });
    expect(fitWithin(100, 50, 512)).toEqual({ width: 100, height: 50 });
  });
  it("luminance is alpha-weighted and ignores transparent pixels", () => {
    expect(pixelLuminance([0, 0, 0, 255, 255, 255, 255, 0])).toBeCloseTo(0, 5);
    expect(pixelLuminance([255, 255, 255, 255])).toBeCloseTo(1, 5);
    expect(pixelLuminance([10, 10, 10, 0])).toBe(0.5);
  });
  it("invertPixels flips RGB and keeps alpha", () => {
    const px = new Uint8ClampedArray([0, 100, 255, 128]);
    invertPixels(px);
    expect([...px]).toEqual([255, 155, 0, 128]);
  });
});

describe("resolveLogoTreatment", () => {
  it("returns null without a logo", () => {
    expect(resolveLogoTreatment(createDefaultDocument())).toBeNull();
  });
  it("none leaves the logo untouched", () => {
    expect(resolveLogoTreatment(docWith("#0F172A", 0.02, "none"))).toMatchObject({ pill: null, inverted: false, href: "data:image/png;base64,AAAA" });
  });
  it("frosted-pill uses a light pill behind a dark logo and a dark pill behind a light one", () => {
    expect(resolveLogoTreatment(docWith("#0F172A", 0.02, "frosted-pill"))!.pill!.fill).toBe("#FFFFFF");
    expect(resolveLogoTreatment(docWith("#FFFFFF", 0.9, "frosted-pill"))!.pill!.fill).toBe("#0F172A");
  });
  it("auto-invert swaps a dark logo on a dark background to the inverted copy", () => {
    const t = resolveLogoTreatment(docWith("#0F172A", 0.02, "auto-invert"))!;
    expect(t.inverted).toBe(true);
    expect(t.href).toBe("data:image/png;base64,BBBB");
  });
  it("auto-invert keeps a dark logo on a light background", () => {
    expect(resolveLogoTreatment(docWith("#FFFFFF", 0.02, "auto-invert"))!.inverted).toBe(false);
  });
  it("auto-invert keeps a mid-grey logo on a mid-grey background (inversion cannot help)", () => {
    expect(resolveLogoTreatment(docWith("#BCBCBC", 0.5, "auto-invert"))!.inverted).toBe(false);
  });
  it("auto-invert falls back to a pill on transparent canvases", () => {
    const t = resolveLogoTreatment(docWith("#FFFFFF", 0.02, "auto-invert", true))!;
    expect(t.inverted).toBe(false);
    expect(t.pill).not.toBeNull();
  });
  it("contrastRatio is symmetric and 21:1 for black/white", () => {
    expect(contrastRatio(0, 1)).toBeCloseTo(21, 5);
    expect(contrastRatio(1, 0)).toBeCloseTo(21, 5);
  });
});
