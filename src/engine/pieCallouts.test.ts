import { describe, expect, it } from "vitest";
import { createDocumentFromColumns } from "../model/defaults";
import type { ChartDocument } from "../model/types";
import { serializeSvg } from "../export/svgSerialize";
import { CALLOUT_SHARE, planCallouts, spreadY } from "./geometry/pieCallouts";
import { buildSlices } from "./geometry/pie";
import { computeLayout } from "./layout";
import { buildScene } from "./scene";
import { createApproxMeasurer } from "./textMeasure";
import type { SceneNode } from "./types";
import { formatPercent } from "./format";

const m = createApproxMeasurer();
const pieDoc = (values: number[], type: "pie" | "donut" = "pie"): ChartDocument => {
  const d = createDocumentFromColumns(values.map((_, i) => `S${i + 1}`), values, "Mix", type);
  d.geometry.groupSmallSlicesBelowPct = 0; // keep every slice so callouts are what handles the small ones
  return d;
};
const texts = (nodes: SceneNode[]) => nodes.filter((n): n is Extract<SceneNode, { kind: "text" }> => n.kind === "text");
const lines = (nodes: SceneNode[]) => nodes.filter((n): n is Extract<SceneNode, { kind: "line" }> => n.kind === "line");
const pctTexts = (nodes: SceneNode[]) => texts(nodes).filter((t) => t.fontWeight === 600 && /^\d+(\.\d)?%$/.test(t.text));
const pct = (v: number, total: number) => formatPercent(v / total);

describe("spreadY", () => {
  it("keeps the gap, order and bounds", () => {
    const out = spreadY([100, 101, 102, 103], 20, 0, 400);
    for (let i = 1; i < out.length; i++) expect(out[i]! - out[i - 1]!).toBeGreaterThanOrEqual(20 - 1e-9);
  });
  it("pushes stacks back up from the bottom bound", () => {
    const out = spreadY([390, 395, 399], 20, 0, 400);
    expect(out[2]).toBe(400);
    expect(out[0]!).toBeLessThanOrEqual(360);
  });
  it("shares the room evenly when the gap can't fit", () => {
    expect(spreadY([5, 6, 7], 100, 0, 40)).toEqual([0, 20, 40]);
  });
});

describe("pie / donut callout labels", () => {
  it("keeps large slice labels inside the wedge and moves narrow ones outside with a two-segment leader", () => {
    const doc = pieDoc([60, 30, 6, 4]);
    const { nodes, layout } = buildScene(doc, m);
    const t = texts(nodes);
    const big = t.find((x) => x.text === pct(60, 100))!;
    const small = t.find((x) => x.text === pct(6, 100))!;
    expect(big.anchor).toBe("middle");
    expect(big.fill).toBe("#FFFFFF"); // onAccent: inside the wedge
    expect(small.anchor).not.toBe("middle");
    expect(small.fill).not.toBe("#FFFFFF"); // ink: outside on the page
    const cx = layout.plot.x + layout.plot.width / 2;
    const cy = layout.plot.y + layout.plot.height / 2;
    const L = lines(nodes);
    expect(L).toHaveLength(4); // two segments x two callouts
    // the shelf of each leader is horizontal, the tick starts on the pie edge
    for (let k = 0; k < L.length; k += 2) {
      expect(L[k + 1]!.y1).toBe(L[k + 1]!.y2);
      const r = Math.hypot(L[k]!.x1 - cx, L[k]!.y1 - cy);
      expect(r).toBeGreaterThan(0);
    }
  });
  it("uses a callout when the share is under the threshold or the label doesn't fit", () => {
    expect(CALLOUT_SHARE).toBe(0.08);
    const doc = pieDoc([50, 45, 5]);
    const t = texts(buildScene(doc, m).nodes);
    expect(t.find((x) => x.text === pct(5, 100))!.anchor).not.toBe("middle");
    expect(t.find((x) => x.text === pct(45, 100))!.anchor).toBe("middle");
  });
  it("stacks adjacent tiny slices (4%, 2%, 1%) without overlap, on both sides", () => {
    const doc = pieDoc([40, 30, 20, 4, 3, 2, 1]);
    const { nodes, layout } = buildScene(doc, m);
    const fs = 20 * layout.u;
    const callouts = pctTexts(nodes).filter((x) => x.anchor !== "middle");
    expect(callouts.length).toBeGreaterThanOrEqual(4);
    for (const side of ["start", "end"] as const) {
      const ys = callouts.filter((c) => c.anchor === side).map((c) => c.y).sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(fs * 1.2);
    }
  });
  it("insets the outer radius so callouts stay inside the plot box", () => {
    const doc = pieDoc([97, 1, 1, 1]);
    const L = computeLayout(doc, m);
    const { nodes } = buildScene(doc, m);
    const cx = L.plot.x + L.plot.width / 2;
    const cy = L.plot.y + L.plot.height / 2;
    const arcR = (() => {
      // outer radius from the first wedge path bounding: use the leader tick start of any callout
      const l = lines(nodes)[0]!;
      return Math.hypot(l.x1 - cx, l.y1 - cy);
    })();
    const fullR = Math.min(L.plot.width, L.plot.height) / 2 - 8 * L.u;
    expect(arcR).toBeLessThan(fullR);
    for (const t of pctTexts(nodes)) {
      if (t.anchor === "middle") continue;
      const w = m.width(t.text, t.fontSize, 600);
      const left = t.anchor === "start" ? t.x : t.x - w;
      const right = t.anchor === "start" ? t.x + w : t.x;
      expect(left).toBeGreaterThanOrEqual(L.plot.x - 0.5);
      expect(right).toBeLessThanOrEqual(L.plot.x + L.plot.width + 0.5);
      expect(t.y).toBeGreaterThanOrEqual(L.plot.y);
      expect(t.y).toBeLessThanOrEqual(L.plot.y + L.plot.height + t.fontSize);
    }
  });
  it("does not shrink the pie when no slice needs a callout", () => {
    const doc = pieDoc([40, 35, 25]);
    const { nodes } = buildScene(doc, m);
    expect(lines(nodes)).toHaveLength(0);
    const plan = planCallouts({ geom: [], cx: 0, cy: 0, r: 100, innerRatio: 0, plot: { x: 0, y: 0, width: 300, height: 300 }, fontSize: 20, u: 1, textW: [] });
    expect(plan).toEqual({ r: 100, callouts: [] });
  });
  it("leader uses the slice colour, and falls back to muted text when the colour would vanish on the page", () => {
    const doc = pieDoc([80, 15, 5]);
    doc.data.series[0]!.pointColorOverrides = { 2: "#FEFEFE" }; // near-white slice on a white page
    const L = lines(buildScene(doc, m).nodes);
    expect(L[0]!.stroke).toBe("#64748B"); // theme.muted
    const doc2 = pieDoc([80, 15, 5]);
    const slices = buildSlices(doc2);
    expect(lines(buildScene(doc2, m).nodes)[0]!.stroke).toBe(slices[2]!.color);
  });
  it("donuts with a thin ring move every label outside", () => {
    const doc = pieDoc([40, 35, 25], "donut");
    doc.geometry.donutInnerRatio = 0.95;
    const t = pctTexts(buildScene(doc, m).nodes);
    expect(t.length).toBe(3);
    expect(t.every((x) => x.anchor !== "middle")).toBe(true);
  });
  it("renders in static exports: leaders and labels are ordinary scene nodes in the SVG", () => {
    const doc = pieDoc([80, 15, 5]);
    const { nodes } = buildScene(doc, m);
    const svg = serializeSvg(nodes, doc.canvas.width, doc.canvas.height, "");
    for (const l of lines(nodes)) expect(svg).toContain(`x2="${l.x2}"`);
    expect(svg).toContain(pct(5, 100));
  });
  it("hides callouts with the labels toggle", () => {
    const doc = pieDoc([80, 15, 5]);
    doc.geometry.showDataLabels = false;
    expect(lines(buildScene(doc, m).nodes)).toHaveLength(0);
  });
});
