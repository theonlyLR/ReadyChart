import { describe, expect, it } from "vitest";
import { createDefaultDocument } from "./defaults";
import { addRow, addSeries, parseCellNumber, removeRow, removeSeries, setCell, setSeriesName, setSliceColor, clearSliceColors } from "./dataOps";
import { seriesLengthsMatch } from "./validate";

describe("parseCellNumber", () => {
  it.each([
    ["42", 42],
    ["$1,250.5", 1250.5],
    ["(12)", -12],
    ["-3.5", -3.5],
    ["12.5%", 12.5],
    ["1.250,50", 1250.5],
    ["3,5", 3.5],
    ["", null],
    ["abc", undefined],
  ])("%s -> %s", (input, expected) => expect(parseCellNumber(input)).toBe(expected));
});

describe("dataOps keep series aligned", () => {
  it("add/remove rows and series", () => {
    const doc = createDefaultDocument();
    addSeries(doc.data);
    addRow(doc.data);
    expect(seriesLengthsMatch(doc)).toBe(true);
    expect(doc.data.series[1]!.provenance.every((p) => p === "MISSING")).toBe(true);
    setCell(doc.data, 0, 4, 9);
    expect(doc.data.series[0]!.provenance[4]).toBe("USER_INPUT");
    setCell(doc.data, 0, 4, null);
    expect(doc.data.series[0]!.provenance[4]).toBe("MISSING");
    removeRow(doc.data, 0);
    expect(doc.data.labels).toHaveLength(4);
    expect(seriesLengthsMatch(doc)).toBe(true);
    removeSeries(doc.data, 1);
    removeSeries(doc.data, 0);
    expect(doc.data.series).toHaveLength(1);
  });
});

describe("series names and slice colors", () => {
  it("renames a series and falls back for blank names", () => {
    const doc = createDefaultDocument();
    setSeriesName(doc.data, 0, "  Sales ");
    expect(doc.data.series[0]!.name).toBe("Sales");
    setSeriesName(doc.data, 0, "   ");
    expect(doc.data.series[0]!.name).toBe("Series 1");
  });

  it("sets, clears and resets slice colors", () => {
    const doc = createDefaultDocument();
    setSliceColor(doc.data, 1, "#ff0000");
    expect(doc.data.series[0]!.pointColorOverrides).toEqual({ 1: "#ff0000" });
    setSliceColor(doc.data, 1, null);
    expect(doc.data.series[0]!.pointColorOverrides).toBeUndefined();
    setSliceColor(doc.data, 0, "#00ff00");
    setSliceColor(doc.data, 2, "#0000ff");
    clearSliceColors(doc.data);
    expect(doc.data.series[0]!.pointColorOverrides).toBeUndefined();
  });
});
