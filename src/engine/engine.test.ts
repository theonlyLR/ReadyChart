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
import { textTargets } from "./textTargets";
import { useDocumentStore } from "../store/documentStore";

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
  const PNG = "data:image/png;base64,AAAA";
  const anchors = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
  const logos = [
    { name: "square", aspect: 1, sizePx: 120 },
    { name: "wide", aspect: 4, sizePx: 200 },
    { name: "tall", aspect: 0.25, sizePx: 200 },
    { name: "oversized", aspect: 1, sizePx: 2000 },
  ] as const;

  it.each(["16:9", "4:5", "9:16", "1:1"] as const)("nothing overlaps the logo at %s (anchors x logo shapes x backdrops x legend x chart types)", (preset) => {
    for (const anchor of anchors) {
      for (const logo of logos) {
        for (const mode of ["none", "frosted-pill"] as const) {
          for (const multi of [false, true]) {
            for (const type of ["bar", "horizontal-bar", "line", "pie"] as const) {
              const doc: ChartDocument = createDefaultDocument();
              Object.assign(doc.canvas, ASPECT_PRESETS[preset], { aspectPreset: preset });
              doc.title = "A fairly long chart title that will need to wrap across lines";
              doc.geometry.type = type;
              if (multi) doc.data.series.push({ id: "s2", name: "Second", color: "#F59E0B", values: [10, 20, 30, 40], provenance: ["USER_INPUT", "USER_INPUT", "USER_INPUT", "USER_INPUT"] });
              doc.brand = { ...doc.brand, anchor, logoDataUrl: PNG, sizePx: logo.sizePx, logoAspect: logo.aspect, contrastBackdrop: mode };
              const L = computeLayout(doc, m);
              const where = `${preset} ${anchor} ${logo.name} ${mode} multi=${multi} ${type}`;
              const box = L.logoBox!;
              for (const r of [L.plot, L.regions.text, L.regions.legend, L.regions.footer]) {
                if (r) expect(rectsIntersect(r, box), where).toBe(false);
              }
              // The reserved box stays inside the content area and within a third of it.
              const [pt, pr, pb, pl] = doc.canvas.padding;
              const cw = doc.canvas.width - pl - pr;
              const ch = doc.canvas.height - pt - pb;
              expect(box.width, where).toBeLessThanOrEqual(cw / 3 + 1e-6);
              expect(box.height, where).toBeLessThanOrEqual(ch / 3 + 1e-6);
              expect(box.x, where).toBeGreaterThanOrEqual(pl - 1e-6);
              expect(box.x + box.width, where).toBeLessThanOrEqual(doc.canvas.width - pr + 1e-6);
              expect(box.y, where).toBeGreaterThanOrEqual(pt - 1e-6);
              expect(box.y + box.height, where).toBeLessThanOrEqual(doc.canvas.height - pb + 1e-6);
            }
          }
        }
      }
    }
  });

  it("logo image keeps its aspect ratio and a pill adds padding around it", () => {
    const doc = createDefaultDocument();
    doc.brand = { ...doc.brand, logoDataUrl: PNG, sizePx: 100, logoAspect: 4, contrastBackdrop: "none" };
    const plain = computeLayout(doc, m);
    expect(plain.logoImage).toEqual(plain.logoBox);
    expect(plain.logoImage!.width / plain.logoImage!.height).toBeCloseTo(4, 5);
    expect(plain.logoImage!.width).toBeCloseTo(100, 5);

    doc.brand.contrastBackdrop = "frosted-pill";
    const pilled = computeLayout(doc, m);
    expect(pilled.logoBox!.width).toBeGreaterThan(pilled.logoImage!.width);
    expect(pilled.logoImage!.width / pilled.logoImage!.height).toBeCloseTo(4, 5);
    expect(pilled.logoImage!.x).toBeGreaterThan(pilled.logoBox!.x);
  });

  it("without a logo there is no reserved box", () => {
    const L = computeLayout(createDefaultDocument(), m);
    expect(L.logoBox).toBeNull();
    expect(L.logoImage).toBeNull();
  });

  it("the legend flows beside a top logo when it fits, and drops below it otherwise", () => {
    const doc = createDefaultDocument();
    doc.canvas.padding = [72, 96, 72, 96];
    doc.title = "";
    doc.subtitle = "";
    doc.data.series.push({ id: "s2", name: "Second", color: "#F59E0B", values: [1, 2, 3, 4], provenance: ["USER_INPUT", "USER_INPUT", "USER_INPUT", "USER_INPUT"] });
    doc.brand = { ...doc.brand, anchor: "top-left", logoDataUrl: PNG, sizePx: 160, logoAspect: 1 };
    const beside = computeLayout(doc, m);
    expect(beside.legend!.rect.x).toBeGreaterThanOrEqual(beside.logoBox!.x + beside.logoBox!.width);
    expect(beside.legend!.rect.y).toBeLessThan(beside.logoBox!.y + beside.logoBox!.height);

    // Many long entries can't fit in the logo's band, so the whole legend moves below it.
    doc.data.series = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, name: `A rather long series name ${i}`, color: "#6366F1", values: [1, 2, 3, 4], provenance: ["USER_INPUT", "USER_INPUT", "USER_INPUT", "USER_INPUT"] as ChartDocument["data"]["series"][number]["provenance"] }));
    const below = computeLayout(doc, m);
    expect(below.legend!.rect.y).toBeGreaterThanOrEqual(below.logoBox!.y + below.logoBox!.height);
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

describe("inline text targets", () => {
  it("cover exactly the rendered lines and invert the layout's baseline maths", () => {
    const doc = createDefaultDocument();
    const L = computeLayout(doc, m);
    const targets = textTargets(L);
    expect(targets.map((t) => t.field)).toEqual(["title", "subtitle", "sourceFooter"]);
    const title = targets[0]!;
    expect(title.rect.y).toBeCloseTo(doc.canvas.padding[0], 6); // title starts at the content top
    expect(title.rect.height).toBeCloseTo(L.title.lines.length * L.title.lineHeight, 6);
    // Baseline reconstructed from the rect equals the layout's baseline.
    expect(title.rect.y + title.lineHeight / 2 + title.fontSize * 0.35).toBeCloseTo(L.title.y, 6);
    // Subtitle sits below the title; footer hugs the content bottom.
    expect(targets[1]!.rect.y).toBeGreaterThanOrEqual(title.rect.y + title.rect.height);
    const footer = targets[2]!;
    expect(footer.rect.y + footer.rect.height).toBeCloseTo(doc.canvas.height - doc.canvas.padding[2], 6);
  });

  it("skips empty fields", () => {
    const doc = createDefaultDocument();
    doc.subtitle = "";
    doc.sourceFooter = "";
    expect(textTargets(computeLayout(doc, m)).map((t) => t.field)).toEqual(["title"]);
  });

  it("targets stay clear of the logo safe zone for every anchor", () => {
    for (const anchor of ["top-left", "top-right", "bottom-left", "bottom-right"] as const) {
      const doc = createDefaultDocument();
      doc.brand = { ...doc.brand, anchor, logoDataUrl: "data:image/png;base64,AAAA", sizePx: 120 };
      const L = computeLayout(doc, m);
      for (const t of textTargets(L)) expect(rectsIntersect(t.rect, L.logoBox!), `${anchor} ${t.field}`).toBe(false);
    }
  });

  it("an inline commit is one undoable document edit", () => {
    const s = useDocumentStore.getState();
    useDocumentStore.setState({ doc: createDefaultDocument(), past: [], future: [], txn: null });
    s.update((d) => void (d.title = "Edited on canvas"));
    expect(useDocumentStore.getState().doc.title).toBe("Edited on canvas");
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().doc.title).toBe("Quarterly Revenue");
  });
});

describe("per-slice colors", () => {
  it("override drives slice and legend color and can be undone", () => {
    const doc = createDocumentFromColumns(["A", "B", "C"], [10, 20, 30], "Mix", "pie");
    const base = buildSlices(doc)[1]!.color;
    const store = useDocumentStore;
    store.setState({ doc, past: [], future: [], txn: null });
    store.getState().update((d) => void (d.data.series[0]!.pointColorOverrides = { 1: "#123456" }));
    expect(buildSlices(store.getState().doc)[1]!.color).toBe("#123456");
    store.getState().undo();
    expect(buildSlices(store.getState().doc)[1]!.color).toBe(base);
  });
});
