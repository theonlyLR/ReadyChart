import { describe, expect, it } from "vitest";
import { applyKitToDraft } from "../brand/kits";
import type { BrandKit } from "../brand/kits";
import { splitGradient } from "../components/DataTable/swatch";
import { applyParsedTable } from "../ingest/toDocument";
import type { ParsedTable } from "../ingest/parseTable";
import { useDocumentStore } from "../store/documentStore";
import { addRow, addSeries, colorEachItem, itemColorsActive, removeRow, setChartType, setSliceColor } from "./dataOps";
import { SERIES_PALETTE, createDefaultDocument } from "./defaults";
import type { ChartDocument } from "./types";

const AMBER = "#F59E0B";
const doc4 = (): ChartDocument => {
  const d = createDefaultDocument(); // 4 bars, series colour SERIES_PALETTE[0]
  return d;
};
const SC = SERIES_PALETTE[0]!;

describe("per-bar colours: on / off", () => {
  it("is active only for single-series charts with overrides", () => {
    const d = doc4();
    expect(itemColorsActive(d.data)).toBe(false);
    setSliceColor(d.data, 2, AMBER);
    expect(itemColorsActive(d.data)).toBe(true);
    addSeries(d.data);
    expect(itemColorsActive(d.data)).toBe(false);
  });
  it("'Color each bar' keeps existing colours, seeds the rest from the palette (first bar keeps the series colour) and clears on off", () => {
    const d = doc4();
    setSliceColor(d.data, 2, AMBER);
    colorEachItem(d.data, true);
    expect(d.data.series[0]!.pointColorOverrides).toEqual({ 0: SC, 1: SERIES_PALETTE[1], 2: AMBER, 3: SERIES_PALETTE[3] });
    colorEachItem(d.data, false);
    expect(d.data.series[0]!.pointColorOverrides).toBeUndefined();
  });
});

describe("chart-type switches keep per-item colours", () => {
  it("bar -> pie freezes what the bars showed (sparse overrides fall back to the series colour, not the palette)", () => {
    const d = doc4();
    setSliceColor(d.data, 2, AMBER);
    setChartType(d, "pie");
    expect(d.geometry.type).toBe("pie");
    expect(d.data.series[0]!.pointColorOverrides).toEqual({ 0: SC, 1: SC, 2: AMBER, 3: SC });
  });
  it("round trips bar -> donut -> horizontal bar without losing any sampled colour", () => {
    const d = doc4();
    d.data.series[0]!.pointColorOverrides = { 0: "#111111", 1: "#222222", 2: "#333333", 3: "#444444" };
    setChartType(d, "donut");
    setChartType(d, "horizontal-bar");
    setChartType(d, "bar");
    expect(d.data.series[0]!.pointColorOverrides).toEqual({ 0: "#111111", 1: "#222222", 2: "#333333", 3: "#444444" });
  });
  it("pie -> bar carries chosen slice colours (rest from the palette) but not the untouched rainbow default", () => {
    const chosen = doc4();
    chosen.geometry.type = "pie";
    setSliceColor(chosen.data, 1, AMBER);
    setChartType(chosen, "bar");
    expect(chosen.data.series[0]!.pointColorOverrides).toEqual({ 0: SERIES_PALETTE[0], 1: AMBER, 2: SERIES_PALETTE[2], 3: SERIES_PALETTE[3] });
    const plain = doc4();
    plain.geometry.type = "pie";
    setChartType(plain, "bar");
    expect(plain.data.series[0]!.pointColorOverrides).toBeUndefined();
  });
  it("leaves uniform bars alone, ignores same-family switches and multi-series charts", () => {
    const uniform = doc4();
    setChartType(uniform, "pie");
    expect(uniform.data.series[0]!.pointColorOverrides).toBeUndefined();
    const same = doc4();
    setSliceColor(same.data, 2, AMBER);
    setChartType(same, "line");
    expect(same.data.series[0]!.pointColorOverrides).toEqual({ 2: AMBER });
    const multi = doc4();
    addSeries(multi.data);
    multi.data.series[0]!.pointColorOverrides = { 1: AMBER };
    setChartType(multi, "pie");
    expect(multi.data.series[0]!.pointColorOverrides).toEqual({ 1: AMBER });
  });
  it("is one undo step through the store", () => {
    const s = useDocumentStore;
    const d = doc4();
    setSliceColor(d.data, 2, AMBER);
    s.getState().replaceDoc(d);
    const depth = s.getState().past.length;
    s.getState().update((x) => setChartType(x, "pie"));
    expect(s.getState().past.length).toBe(depth + 1);
    s.getState().undo();
    expect(s.getState().doc.geometry.type).toBe("bar");
    expect(s.getState().doc.data.series[0]!.pointColorOverrides).toEqual({ 2: AMBER });
  });
});

describe("row mutations keep per-bar colours aligned by row index", () => {
  it("deleting a row shifts later overrides up and drops its own", () => {
    const d = doc4();
    d.data.series[0]!.pointColorOverrides = { 0: "#000001", 1: "#000002", 2: "#000003", 3: "#000004" };
    removeRow(d.data, 1);
    expect(d.data.labels).toEqual(["Q1", "Q3", "Q4"]);
    expect(d.data.series[0]!.pointColorOverrides).toEqual({ 0: "#000001", 1: "#000003", 2: "#000004" });
  });
  it("deleting the only overridden row removes the (now empty) override map", () => {
    const d = doc4();
    d.data.series[0]!.pointColorOverrides = { 3: AMBER };
    removeRow(d.data, 3);
    expect(d.data.series[0]!.pointColorOverrides).toBeUndefined();
    expect(itemColorsActive(d.data)).toBe(false);
  });
  it("an added row has no override, so it falls back to the series colour; stale keys past the end are pruned", () => {
    const d = doc4();
    d.data.series[0]!.pointColorOverrides = { 1: AMBER, 9: "#999999" }; // 9 is stale
    addRow(d.data);
    expect(d.data.labels).toHaveLength(5);
    expect(d.data.series[0]!.pointColorOverrides).toEqual({ 1: AMBER });
    expect(d.data.series[0]!.pointColorOverrides?.[4] ?? d.data.series[0]!.color).toBe(SC);
  });
});

describe("multi-series and Brand Kit", () => {
  const kit: BrandKit = { id: "k", name: "K", palette: ["#0A0A0A", "#C0FFEE"], background: "#FFFFFF", brand: createDefaultDocument().brand };
  it("adding a series clears per-bar overrides", () => {
    const d = doc4();
    setSliceColor(d.data, 2, AMBER);
    addSeries(d.data);
    expect(d.data.series.every((s) => !s.pointColorOverrides)).toBe(true);
  });
  it("appending a series by import clears them too", () => {
    const d = doc4();
    setSliceColor(d.data, 2, AMBER);
    const t: ParsedTable = { labels: d.data.labels, series: [{ name: "B", values: [1, 2, 3, 4], included: true }], units: { prefix: "", suffix: "" }, chart: "bar", warnings: [] };
    const next = applyParsedTable(d, t, { mode: "append", chart: "bar", provenance: "PARSED" });
    expect(next.data.series).toHaveLength(2);
    expect(next.data.series[0]!.pointColorOverrides).toBeUndefined();
  });
  it("applying a Brand Kit palette clears per-bar overrides so the palette shows", () => {
    const d = doc4();
    setSliceColor(d.data, 2, AMBER);
    applyKitToDraft(d, kit);
    expect(d.data.series[0]!.color).toBe("#0A0A0A");
    expect(d.data.series[0]!.pointColorOverrides).toBeUndefined();
  });
  it("on a pie the palette is spread over the slices", () => {
    const d = doc4();
    d.geometry.type = "pie";
    setSliceColor(d.data, 1, AMBER);
    applyKitToDraft(d, kit);
    expect(d.data.series[0]!.pointColorOverrides).toEqual({ 0: "#0A0A0A", 1: "#C0FFEE", 2: "#0A0A0A", 3: "#C0FFEE" });
  });
  it("a kit without a palette leaves colours alone", () => {
    const d = doc4();
    setSliceColor(d.data, 2, AMBER);
    applyKitToDraft(d, { ...kit, palette: [] });
    expect(d.data.series[0]!.pointColorOverrides).toEqual({ 2: AMBER });
  });
});

describe("splitGradient", () => {
  it("makes equal hard-stop bands, capped", () => {
    expect(splitGradient(["#111111", "#222222"])).toBe("linear-gradient(90deg, #111111 0% 50%, #222222 50% 100%)");
    expect(splitGradient(["#111111"])).toBe("#111111");
    expect(splitGradient([])).toBe("transparent");
    expect((splitGradient(Array(10).fill("#000000")).match(/#000000/g) ?? []).length).toBe(6);
  });
});
