import { describe, expect, it, vi } from "vitest";
import { createDefaultDocument } from "../model/defaults";
import { createApproxMeasurer } from "../engine/textMeasure";
import { buildScene } from "../engine/scene";
import { fontFaceRule } from "./fontEmbed";
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
