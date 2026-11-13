import { describe, expect, it, vi } from "vitest";
import { createDefaultDocument } from "../model/defaults";
import { createApproxMeasurer } from "../engine/textMeasure";
import { buildScene } from "../engine/scene";
import { fontFaceRule } from "./fontEmbed";
import { fontDef, fontStack } from "../engine/fonts";
import { getMeasurer } from "../render/measurer";
import { serializeSvg } from "./svgSerialize";
import { fileNameFor } from "./download";
import { drawScene } from "../render/canvasRenderer";
import type { SceneNode } from "../engine/types";
import { safeZone } from "../components/FlightCheck/safeZones";

const m = createApproxMeasurer();

describe("SVG export", () => {
  it("embeds Base64 WOFF2 and references no external URLs", () => {
    const doc = createDefaultDocument();
    const { nodes } = buildScene(doc, m);
    nodes.push({ kind: "image", x: 0, y: 0, width: 10, height: 10, href: "https://evil.example/logo.png" });
    const svg = serializeSvg(nodes, doc.canvas.width, doc.canvas.height, fontFaceRule(400, "AAAA"));
    expect(svg).toContain("@font-face");
    expect(svg).toContain("data:font/woff2;base64,AAAA");
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(svg.startsWith("<?xml")).toBe(true);
  });
});

describe("canvas renderer", () => {
  it("draws each node and never draws images without a decoded data-URL bitmap", () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, prop: string) => (...args: unknown[]) => void calls.push(`${prop}:${args.length}`),
      set: () => true,
    });
    const nodes: SceneNode[] = [
      { kind: "rect", x: 0, y: 0, width: 10, height: 10, fill: "#fff" },
      { kind: "line", x1: 0, y1: 0, x2: 5, y2: 5, stroke: "#000", strokeWidth: 1 },
      { kind: "text", x: 1, y: 1, text: "hi", fontSize: 12, fontWeight: 400, fill: "#000", anchor: "start" },
      { kind: "image", x: 0, y: 0, width: 4, height: 4, href: "https://example.com/x.png" },
    ];
    vi.stubGlobal("Path2D", class {});
    drawScene(ctx as unknown as CanvasRenderingContext2D, nodes, { scale: 2 });
    expect(calls.filter((c) => c.startsWith("fillRect"))).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith("fillText"))).toHaveLength(1);
    expect(calls.some((c) => c.startsWith("drawImage"))).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("misc export helpers", () => {
  it("builds file names", () => {
    expect(fileNameFor("Q3 Revenue!", "png", 2)).toBe("q3-revenue@2x.png");
    expect(fileNameFor("", "svg", 1)).toBe("chart.svg");
  });
  it("safe zones stay inside the canvas", () => {
    for (const p of ["linkedin", "x", "tiktok"] as const) {
      const z = safeZone(p, 1920, 1080);
      expect(z.x).toBeGreaterThanOrEqual(0);
      expect(z.y).toBeGreaterThanOrEqual(0);
      expect(z.x + z.width).toBeLessThanOrEqual(1.0001);
      expect(z.y + z.height).toBeLessThanOrEqual(1.0001);
    }
  });
});

describe("brand logo in the scene and exports", () => {
  const LOGO = "data:image/png;base64,DARKLOGO";
  const INVERTED = "data:image/png;base64,LIGHTLOGO";
  const brandDoc = (bg: string, mode: "none" | "frosted-pill" | "auto-invert") => {
    const doc = createDefaultDocument();
    doc.canvas.background = bg;
    doc.brand = { ...doc.brand, logoDataUrl: LOGO, logoInvertedDataUrl: INVERTED, logoLuminance: 0.02, contrastBackdrop: mode };
    return doc;
  };
  const images = (nodes: SceneNode[]) => nodes.filter((n): n is Extract<SceneNode, { kind: "image" }> => n.kind === "image");

  it("auto-invert draws the inverted copy for a dark logo on a dark background, the original on light", () => {
    expect(images(buildScene(brandDoc("#0F172A", "auto-invert"), m).nodes)[0]!.href).toBe(INVERTED);
    expect(images(buildScene(brandDoc("#FFFFFF", "auto-invert"), m).nodes)[0]!.href).toBe(LOGO);
  });

  it("frosted-pill draws a translucent rounded rect directly before the image", () => {
    const { nodes } = buildScene(brandDoc("#0F172A", "frosted-pill"), m);
    const i = nodes.findIndex((n) => n.kind === "image");
    const pill = nodes[i - 1]!;
    expect(pill).toMatchObject({ kind: "path", fill: "#FFFFFF" });
    expect((pill as { opacity?: number }).opacity).toBeLessThan(1);
  });

  it("no logo, no image or pill nodes", () => {
    expect(images(buildScene(createDefaultDocument(), m).nodes)).toHaveLength(0);
  });

  it("SVG export embeds the logo as a data URL and drops remote images", () => {
    const doc = brandDoc("#0F172A", "auto-invert");
    const { nodes } = buildScene(doc, m);
    nodes.push({ kind: "image", x: 0, y: 0, width: 5, height: 5, href: "https://evil.example/x.png" });
    const svg = serializeSvg(nodes, doc.canvas.width, doc.canvas.height, "");
    expect(svg).toContain(INVERTED);
    expect(svg).not.toContain("evil.example");
  });
});

describe("brand fonts", () => {
  it("falls back to Inter for unknown ids and exposes stacks", () => {
    expect(fontDef("nope").id).toBe("inter");
    expect(fontStack("lora")).toContain("Lora");
    expect(fontDef("space-grotesk").family).toBe("Space Grotesk");
  });
  it("embeds the chosen family in @font-face and on the SVG root", () => {
    const doc = createDefaultDocument();
    const { nodes } = buildScene(doc, m);
    const css = fontFaceRule(600, "AAAA", "Lora");
    const svg = serializeSvg(nodes, doc.canvas.width, doc.canvas.height, css, fontStack("lora"));
    expect(svg).toContain("font-family:Lora");
    expect(svg).toMatch(/font-family="Lora, Georgia, serif"/);
  });
  it("canvas text uses the requested font stack", () => {
    const fonts: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: () => () => undefined,
      set: (_t, prop: string, v: unknown) => (prop === "font" && fonts.push(String(v)), true),
    });
    drawScene(ctx as unknown as CanvasRenderingContext2D, [{ kind: "text", x: 0, y: 0, text: "x", fontSize: 10, fontWeight: 600, fill: "#000", anchor: "start" }], { scale: 1, fontFamily: fontStack("lora") });
    expect(fonts).toEqual(["600 10px Lora, Georgia, serif"]);
  });
  it("measurers are per-family so widths never leak between fonts", () => {
    expect(getMeasurer("lora")).toBe(getMeasurer("lora"));
    expect(getMeasurer("lora")).not.toBe(getMeasurer("inter"));
  });
});
