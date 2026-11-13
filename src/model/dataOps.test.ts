import { describe, expect, it } from "vitest";
import { createDefaultDocument } from "./defaults";
import { addRow, addSeries, parseCellNumber, removeRow, removeSeries, setCell } from "./dataOps";
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
