import { describe, expect, it } from "vitest";
import { createDefaultDocument } from "../model/defaults";
import type { ChartDocument } from "../model/types";
import { serializeSvg } from "../export/svgSerialize";
import { computeLayout } from "./layout";
import { buildScene } from "./scene";
import { inkOn, themeFor } from "./theme";
import { createApproxMeasurer } from "./textMeasure";
import type { SceneNode } from "./types";

const m = createApproxMeasurer();
const texts = (nodes: SceneNode[]) => nodes.filter((n): n is Extract<SceneNode, { kind: "text" }> => n.kind === "text");
// Bar value labels are the semibold "$42M"-style texts (the title is semibold too, ticks are regular weight).
const valueLabels = (doc: ChartDocument) => texts(buildScene(doc, m).nodes).filter((t) => t.fontWeight === 600 && /^\$\d+M$/.test(t.text));

describe("axis visibility", () => {
  it("hides value ticks with showYAxis=false and category labels with showXAxis=false, and reclaims the space", () => {
    const doc = createDefaultDocument();
    const full = computeLayout(doc, m);
    const noY = structuredClone(doc);
    noY.geometry.showYAxis = false;
    const noX = structuredClone(doc);
    noX.geometry.showXAxis = false;
    expect(texts(buildScene(noY, m).nodes).some((t) => t.text === "$20M")).toBe(false);
    expect(texts(buildScene(noX, m).nodes).some((t) => t.text === "Q1")).toBe(false);
    expect(texts(buildScene(doc, m).nodes).some((t) => t.text === "Q1")).toBe(true);
    expect(computeLayout(noY, m).plot.width).toBeGreaterThan(full.plot.width);
    expect(computeLayout(noX, m).plot.height).toBeGreaterThan(full.plot.height);
  });
  it("applies to horizontal bars too", () => {
    const doc = createDefaultDocument();
    doc.geometry.type = "horizontal-bar";
    doc.geometry.showXAxis = false;
    expect(texts(buildScene(doc, m).nodes).some((t) => t.text === "Q1")).toBe(false);
    expect(computeLayout(doc, m).yAxisWidth).toBe(0);
  });
});

describe("textColor", () => {
  it("overrides ink and derives a fainter secondary colour", () => {
    const t = themeFor("#0F172A", false, "#FFFFFF");
    expect(t.ink).toBe("#FFFFFF");
    expect(t.muted).not.toBe("#FFFFFF");
    expect(themeFor("#FFFFFF", false, null).ink).toBe("#0F172A");
    expect(themeFor("#FFFFFF", false, "not-a-colour").ink).toBe("#0F172A");
  });
  it("reaches the drawn title", () => {
    const doc = createDefaultDocument();
    doc.canvas.textColor = "#112233";
    expect(texts(buildScene(doc, m).nodes).find((t) => t.text === doc.title)?.fill).toBe("#112233");
  });
});

describe("dataLabelPosition", () => {
  const base = () => {
    const d = createDefaultDocument();
    d.geometry.barGapRatio = 0.2;
    return d;
  };
  const barTops = (doc: ChartDocument) => {
    const L = computeLayout(doc, m);
    return L.plot;
  };

  it("outside-top sits above the bar; inside-top and inside-bottom sit within it", () => {
    const doc = base();
    const outside = valueLabels(doc)[0]!;
    doc.geometry.dataLabelPosition = "inside-top";
    const top = valueLabels(doc)[0]!;
    doc.geometry.dataLabelPosition = "inside-bottom";
    const bottom = valueLabels(doc)[0]!;
    expect(top.y).toBeGreaterThan(outside.y);
    expect(bottom.y).toBeGreaterThan(top.y);
    expect(bottom.y).toBeLessThanOrEqual(barTops(doc).y + barTops(doc).height);
  });
  it("inside labels use a contrasting ink and per-bar colours", () => {
    const doc = base();
    doc.geometry.dataLabelPosition = "inside-top";
    doc.data.series[0]!.color = "#F8F0A0"; // light bar -> dark label
    doc.data.series[0]!.pointColorOverrides = { 1: "#101820" }; // dark bar -> light label
    const labels = valueLabels(doc);
    expect(labels[0]!.fill).toBe(inkOn("#F8F0A0"));
    expect(labels[1]!.fill).toBe(inkOn("#101820"));
    expect(labels[0]!.fill).not.toBe(labels[1]!.fill);
  });
  it("falls back to outside when the label can't fit inside the bar", () => {
    const doc = base();
    doc.data.series[0]!.values = [1, 100, 100, 100];
    doc.geometry.dataLabelPosition = "inside-top";
    const [first, second] = valueLabels(doc);
    // the tiny first bar can't hold its label, so it sits above the bar (lower y than the tall bar's inside label)
    expect(first!.y).toBeGreaterThan(second!.y);
    const outsideDoc = structuredClone(doc);
    outsideDoc.geometry.dataLabelPosition = "outside-top";
    expect(valueLabels(outsideDoc)[0]!.y).toBe(first!.y);
  });
  it("horizontal bars: inside-top = end of the bar, inside-bottom = the base", () => {
    const doc = base();
    doc.geometry.type = "horizontal-bar";
    const outside = valueLabels(doc)[3]!;
    doc.geometry.dataLabelPosition = "inside-top";
    const end = valueLabels(doc)[3]!;
    doc.geometry.dataLabelPosition = "inside-bottom";
    const baseLabel = valueLabels(doc)[3]!;
    expect(end.anchor).toBe("end");
    expect(end.x).toBeLessThan(outside.x);
    expect(baseLabel.anchor).toBe("start");
    expect(baseLabel.x).toBeLessThan(end.x);
  });
});

describe("export parity", () => {
  it("per-bar colours and label positions land in the SVG export exactly as in the scene", () => {
    const doc = createDefaultDocument();
    doc.data.series[0]!.pointColorOverrides = { 3: "#F59E0B" };
    doc.geometry.dataLabelPosition = "inside-top";
    const { nodes } = buildScene(doc, m);
    const svg = serializeSvg(nodes, doc.canvas.width, doc.canvas.height, "");
    expect(svg).toContain('fill="#F59E0B"');
    for (const t of valueLabels(doc)) expect(svg).toContain(`y="${t.y}"`);
  });
});
