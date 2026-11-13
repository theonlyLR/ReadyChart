import { describe, expect, it } from "vitest";
import {
  HIGH_DENSITY_COLLISION_FIXTURE,
  MICRO_SLICE_PIE_FIXTURE,
  NEGATIVE_CASHFLOW_FIXTURE,
} from "../../fixtures/goldenDatasets";
import { ASPECT_PRESETS, createDefaultDocument, createDocumentFromColumns } from "../model/defaults";
import type { ChartDocument } from "../model/types";
import { createApproxMeasurer } from "./textMeasure";
import { resolveDomain } from "./scales";
import { snap } from "./pixelSnap";
import { solveXLabels } from "./collision";
import { computeLayout } from "./layout";
import { buildScene } from "./scene";
import { buildSlices } from "./geometry/pie";
import { pieGuard } from "./guards";
import { formatValue } from "./format";
import { rectsIntersect } from "./types";
import { flipVertical } from "./geometry/roundedRect";

const m = createApproxMeasurer();
const negDoc = () => createDocumentFromColumns(NEGATIVE_CASHFLOW_FIXTURE.labels, NEGATIVE_CASHFLOW_FIXTURE.values, "Cash flow");

describe("scales & snapping", () => {
  it("negative data: domain spans zero", () => {
    const [lo, hi] = resolveDomain(negDoc());
    expect(lo).toBeLessThan(0);
    expect(hi).toBeGreaterThan(0);
  });
  it("snap lands on .5", () => {
    for (const c of [10, 10.4, 99.7, 0]) expect(snap(c) % 1).toBe(0.5);
  });
  it("formats negatives sign-first", () => {
    expect(formatValue({ ...createDefaultDocument().data, unitPrefix: "$", unitSuffix: "M" }, -14.2)).toBe("-$14.2M");
  });
});

describe("collision solver", () => {
  it("short labels stay flat", () => {
    expect(solveXLabels(["Q1", "Q2", "Q3", "Q4"], 300, m, 20)).toMatchObject({ rotation: 0, step: 1 });
  });
  it("36 week labels on a 1080 canvas tilt and skip", () => {
    const doc = createDocumentFromColumns(HIGH_DENSITY_COLLISION_FIXTURE.labels, HIGH_DENSITY_COLLISION_FIXTURE.values, "Density");
    Object.assign(doc.canvas, ASPECT_PRESETS["1:1"], { aspectPreset: "1:1" });
    const L = computeLayout(doc, m);
    expect(L.categoryLabels.rotation).toBe(-45);
    expect(L.categoryLabels.step).toBeGreaterThan(1);
  });
});

describe("layout safe zones", () => {
  it.each(["16:9", "4:5", "9:16"] as const)("plot avoids text, legend, footer and logo at %s", (preset) => {
    for (const anchor of ["top-left", "top-right", "bottom-left", "bottom-right"] as const) {
      const doc: ChartDocument = createDefaultDocument();
      Object.assign(doc.canvas, ASPECT_PRESETS[preset], { aspectPreset: preset });
      doc.title = "A fairly long chart title that will need to wrap across lines";
      doc.data.series.push({ id: "s2", name: "Second", color: "#F59E0B", values: [10, 20, 30, 40], provenance: ["USER_INPUT", "USER_INPUT", "USER_INPUT", "USER_INPUT"] });
      doc.brand = { ...doc.brand, anchor, logoDataUrl: "data:image/png;base64,AAAA", sizePx: 120 };
      const L = computeLayout(doc, m);
      for (const r of [L.regions.text, L.regions.legend, L.regions.footer, L.regions.logo]) {
        if (r) expect(rectsIntersect(L.plot, r)).toBe(false);
      }
      expect(rectsIntersect(L.regions.text, L.regions.logo!)).toBe(false);
      expect(rectsIntersect(L.regions.footer, L.regions.logo!)).toBe(false);
    }
  });
});

describe("geometry", () => {
  it("negative bars grow below the zero line with bottom radii", () => {
    const doc = negDoc();
    expect(flipVertical([8, 8, 0, 0])).toEqual([0, 0, 8, 8]);
    const { layout, nodes } = buildScene(doc, m);
    const zeroLine = nodes.find((n) => n.kind === "line" && n.opacity === 0.55);
    expect(zeroLine).toBeDefined();
    const bars = nodes.filter((n) => n.kind === "path" && n.fill === doc.data.series[0]!.color);
    expect(bars).toHaveLength(4);
    expect(layout.domain[0]).toBeLessThan(0);
  });

  it("groups micro slices under the threshold into Other", () => {
    const doc = createDocumentFromColumns(MICRO_SLICE_PIE_FIXTURE.labels, MICRO_SLICE_PIE_FIXTURE.values, "Mix", "pie");
    doc.geometry.groupSmallSlicesBelowPct = 2;
    const slices = buildSlices(doc);
    expect(slices).toHaveLength(5);
    expect(slices[slices.length - 1]).toMatchObject({ label: "Other", grouped: true });
    expect(slices[slices.length - 1]!.value).toBeCloseTo(3.3);
  });

  it("blocks pie with negatives and renders no slices", () => {
    const doc = negDoc();
    doc.geometry.type = "pie";
    expect(pieGuard(doc).blocked).toBe(true);
    const { nodes } = buildScene(doc, m);
    expect(nodes.some((n) => n.kind === "path")).toBe(false);
  });

  it.each(["bar", "horizontal-bar", "stacked-bar", "line", "area", "pie", "donut"] as const)("%s builds a non-empty scene", (type) => {
    const doc = createDefaultDocument();
    doc.geometry.type = type;
    expect(buildScene(doc, m).nodes.length).toBeGreaterThan(5);
  });
});
