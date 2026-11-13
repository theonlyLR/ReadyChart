import { beforeEach, describe, expect, it } from "vitest";
import { NEGATIVE_CASHFLOW_FIXTURE } from "../../fixtures/goldenDatasets";
import { createDefaultDocument } from "../model/defaults";
import { addSeries, setCell } from "../model/dataOps";
import type { ChartDocument, ChartType } from "../model/types";
import { useDocumentStore } from "../store/documentStore";
import { createApproxMeasurer } from "./textMeasure";
import { buildScene } from "./scene";
import { computeLayout } from "./layout";
import { computeHandles, isSculptable, roundToPixelStep, valueFromPointer } from "./sculpt";
import type { SceneNode } from "./types";

const m = createApproxMeasurer();

const withType = (type: ChartType, mutate?: (d: ChartDocument) => void): ChartDocument => {
  const d = createDefaultDocument();
  d.geometry.type = type;
  d.geometry.barRadius = [0, 0, 0, 0]; // plain rects so path bounding boxes are exact
  d.data.series[0]!.values = [42, 58, -20, 77];
  mutate?.(d);
  return d;
};

const nums = (d: string, cmd: string): number[] => [...d.matchAll(new RegExp(`${cmd}(-?[\\d.]+)`, "g"))].map((x) => Number(x[1]));
/** Bounding box of an un-rounded rect path ("M x,y H x2 ... V y2 ..."). */
function rectBox(d: string) {
  const mm = /^M(-?[\d.]+),(-?[\d.]+)/.exec(d)!;
  const xs = [Number(mm[1]), ...nums(d, "H")];
  const ys = [Number(mm[2]), ...nums(d, "V")];
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
const paths = (nodes: SceneNode[]) => nodes.filter((n): n is Extract<SceneNode, { kind: "path" }> => n.kind === "path");

describe("handle placement matches the rendered geometry", () => {
  it("vertical bars: handle sits at the centre of the value end of every bar (incl. negatives)", () => {
    const doc = withType("bar");
    const { layout, nodes } = buildScene(doc, m);
    const bars = paths(nodes).filter((p) => p.fill === doc.data.series[0]!.color);
    const handles = computeHandles(doc, layout);
    expect(handles).toHaveLength(4);
    handles.forEach((h, i) => {
      const b = rectBox(bars[i]!.d);
      expect(h.x).toBeCloseTo((b.x0 + b.x1) / 2, 1);
      expect(h.y).toBeCloseTo(h.value >= 0 ? b.y0 : b.y1, 1);
    });
  });

  it("grouped bars: each series gets its own handle on its own bar", () => {
    const doc = withType("bar", (d) => {
      addSeries(d.data);
      d.data.series[1]!.values = [10, 20, 30, 40];
      d.data.series[0]!.values = [42, 58, 51, 77];
    });
    const { layout, nodes } = buildScene(doc, m);
    const bars = paths(nodes).slice(doc.data.series.length); // skip legend swatches
    const handles = computeHandles(doc, layout);
    expect(handles).toHaveLength(8);
    // Scene order is by category, then series; handles are by series, then category.
    let bi = 0;
    for (let i = 0; i < 4; i++) {
      for (let si = 0; si < 2; si++) {
        const h = handles.find((x) => x.seriesIndex === si && x.index === i)!;
        const b = rectBox(bars[bi++]!.d);
        expect(h.x).toBeCloseTo((b.x0 + b.x1) / 2, 1);
        expect(h.y).toBeCloseTo(b.y0, 1);
      }
    }
  });

  it("horizontal bars: handle sits at the end of each bar", () => {
    const doc = withType("horizontal-bar");
    const { layout, nodes } = buildScene(doc, m);
    const bars = paths(nodes).filter((p) => p.fill === doc.data.series[0]!.color);
    computeHandles(doc, layout).forEach((h, i) => {
      const b = rectBox(bars[i]!.d);
      expect(h.axis).toBe("x");
      expect(h.y).toBeCloseTo((b.y0 + b.y1) / 2, 1);
      expect(h.x).toBeCloseTo(h.value >= 0 ? b.x1 : b.x0, 1);
    });
  });

  it.each(["line", "area"] as const)("%s: handle sits on each marker", (type) => {
    const doc = withType(type);
    const { layout, nodes } = buildScene(doc, m);
    const markers = paths(nodes).filter((p) => p.stroke === doc.canvas.background && p.fill === doc.data.series[0]!.color);
    expect(markers).toHaveLength(4);
    computeHandles(doc, layout).forEach((h, i) => {
      const mm = /^M(-?[\d.]+),(-?[\d.]+)a(-?[\d.]+),/.exec(markers[i]!.d)!;
      expect(h.x).toBeCloseTo(Number(mm[1]) + Number(mm[3]), 1);
      expect(h.y).toBeCloseTo(Number(mm[2]), 1);
    });
  });
});

describe("valueFromPointer inverts the value scale", () => {
  const cases: [string, ChartType, (d: ChartDocument) => void][] = [
    ["bar", "bar", () => undefined],
    ["bar with negatives", "bar", (d) => void (d.data.series[0]!.values = NEGATIVE_CASHFLOW_FIXTURE.values.slice(0, 4))],
    ["horizontal-bar", "horizontal-bar", () => undefined],
    ["line", "line", () => undefined],
    ["area", "area", () => undefined],
  ];
  it.each(cases)("%s: dragging to a handle's own position returns its value", (_n, type, mutate) => {
    const doc = withType(type, mutate);
    const { layout } = buildScene(doc, m);
    const perPixel = (layout.domain[1] - layout.domain[0]) / (type === "horizontal-bar" ? layout.plot.width : layout.plot.height);
    for (const h of computeHandles(doc, layout)) {
      // Handles at the plot edge are clamped, so only check interior ones exactly.
      const v = valueFromPointer(h.axis, layout.domain, layout.plot, h.x, h.y);
      expect(Math.abs(v - h.value)).toBeLessThanOrEqual(perPixel * 1.01 + 1e-9);
    }
  });

  it("is monotonic: up/right means bigger", () => {
    const doc = withType("bar");
    const { layout } = buildScene(doc, m);
    const { plot, domain } = layout;
    const mid = plot.y + plot.height / 2;
    expect(valueFromPointer("y", domain, plot, 0, mid - 40)).toBeGreaterThan(valueFromPointer("y", domain, plot, 0, mid));
    expect(valueFromPointer("x", domain, plot, plot.x + 100, 0)).toBeGreaterThan(valueFromPointer("x", domain, plot, plot.x + 50, 0));
  });

  it("maps the plot top/bottom to the axis ends", () => {
    const doc = withType("bar");
    const { layout } = buildScene(doc, m);
    const { plot, domain } = layout;
    expect(valueFromPointer("y", domain, plot, 0, plot.y)).toBeCloseTo(domain[1], 6);
    expect(valueFromPointer("y", domain, plot, 0, plot.y + plot.height)).toBeCloseTo(domain[0], 6);
  });

  it("keeps extrapolating past the plot edge but caps at one extra axis span", () => {
    const doc = withType("bar");
    const { layout } = buildScene(doc, m);
    const { plot, domain } = layout;
    const span = domain[1] - domain[0];
    const above = valueFromPointer("y", domain, plot, 0, plot.y - 20);
    expect(above).toBeGreaterThan(domain[1]);
    expect(valueFromPointer("y", domain, plot, 0, plot.y - 99999)).toBeCloseTo(domain[1] + span, 6);
    expect(valueFromPointer("y", domain, plot, 0, plot.y + plot.height + 99999)).toBeCloseTo(domain[0] - span, 6);
  });

  it("rounds to tidy numbers", () => {
    expect(roundToPixelStep(42.31847, 0.25)).toBe(42.3);
    expect(roundToPixelStep(42.6, 1.5)).toBe(43);
    expect(roundToPixelStep(1234.5, 12)).toBe(1230);
    expect(roundToPixelStep(5.5, 0)).toBe(5.5);
  });
});

describe("what can be sculpted", () => {
  it.each([["bar", true], ["horizontal-bar", true], ["line", true], ["area", true], ["stacked-bar", false], ["pie", false], ["donut", false]] as const)("%s -> %s", (type, ok) => {
    const doc = withType(type);
    expect(isSculptable(doc)).toBe(ok);
    expect(computeHandles(doc, computeLayout(doc, m)).length > 0).toBe(ok);
  });

  it("empty cells get no handle", () => {
    const doc = withType("bar", (d) => void (d.data.series[0]!.values = [42, null, 51, null]));
    expect(computeHandles(doc, computeLayout(doc, m)).map((h) => h.index)).toEqual([0, 2]);
  });
});

describe("a drag gesture in the document store", () => {
  beforeEach(() => useDocumentStore.setState({ doc: createDefaultDocument(), past: [], future: [], txn: null }));

  /** Mirrors SculptOverlay: pin axis -> many setCell updates -> restore axis -> commit. */
  function simulateDrag(values: number[]) {
    const s = useDocumentStore.getState();
    const { geometry: g } = s.doc;
    const orig = { yMin: g.yMin, yMax: g.yMax };
    s.beginTransaction();
    s.update((d) => void ((d.geometry.yMin = 0), (d.geometry.yMax = 80)));
    for (const v of values) s.update((d) => setCell(d.data, 0, 2, v));
    s.update((d) => void ((d.geometry.yMin = orig.yMin), (d.geometry.yMax = orig.yMax)));
    s.commitTransaction();
  }

  it("is exactly one undo step, and undo/redo restore the documents exactly", () => {
    const before = structuredClone(useDocumentStore.getState().doc);
    simulateDrag([52, 55, 60, 64, 71, 70]);
    const after = structuredClone(useDocumentStore.getState().doc);
    expect(useDocumentStore.getState().past).toHaveLength(1);
    expect(after.data.series[0]!.values[2]).toBe(70);
    expect(after.data.series[0]!.provenance[2]).toBe("USER_INPUT");
    // The temporary axis pin leaves no trace.
    expect(after.geometry.yMin).toBe("auto");
    expect(after.geometry.yMax).toBe("auto");
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().doc).toEqual(before);
    useDocumentStore.getState().redo();
    expect(useDocumentStore.getState().doc).toEqual(after);
  });

  it("only the dragged cell changes", () => {
    const before = structuredClone(useDocumentStore.getState().doc);
    simulateDrag([60, 66]);
    const after = useDocumentStore.getState().doc;
    expect(after.data.series[0]!.values.filter((_, i) => i !== 2)).toEqual(before.data.series[0]!.values.filter((_, i) => i !== 2));
    expect(after.data.labels).toEqual(before.data.labels);
  });
});
