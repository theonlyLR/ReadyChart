import { describe, expect, it } from "vitest";
import { createDefaultDocument } from "../model/defaults";
import { unverifiedCount } from "../model/dataOps";
import { seriesLengthsMatch } from "../model/validate";
import { useDocumentStore } from "../store/documentStore";
import { parsePastedText } from "./parseTable";
import { applyParsedTable } from "./toDocument";

describe("applyParsedTable", () => {
  const table = parsePastedText("Quarter,Revenue\nQ1,$4.2M\nQ2,$5.1M\nQ3,")!;

  it("replaces data, tags provenance, keeps brand/canvas/motion", () => {
    const base = createDefaultDocument();
    base.brand.sizePx = 99;
    const next = applyParsedTable(base, table, { mode: "replace", chart: "line", provenance: "PARSED" });
    expect(next.data.labels).toEqual(["Q1", "Q2", "Q3"]);
    expect(next.data.unitPrefix + next.data.unitSuffix).toBe("$M");
    expect(next.data.series[0]!.provenance).toEqual(["PARSED", "PARSED", "MISSING"]);
    expect(next.geometry.type).toBe("line");
    expect(next.brand.sizePx).toBe(99);
    expect(seriesLengthsMatch(next)).toBe(true);
    expect(unverifiedCount(next.data)).toBe(2);
    expect(base.data.labels).toEqual(["Q1", "Q2", "Q3", "Q4"]); // input untouched
  });

  it("append aligns a new series to the existing rows", () => {
    const next = applyParsedTable(createDefaultDocument(), table, { mode: "append", chart: "bar", provenance: "PARSED" });
    expect(next.data.series).toHaveLength(2);
    expect(next.data.series[1]!.values).toEqual([4.2, 5.1, null, null]);
    expect(seriesLengthsMatch(next)).toBe(true);
  });

  it("never applies a pie to negative data", () => {
    const neg = parsePastedText("A,-5\nB,10")!;
    expect(applyParsedTable(createDefaultDocument(), neg, { mode: "replace", chart: "donut", provenance: "PARSED" }).geometry.type).toBe("horizontal-bar");
  });

  it("is one undo step through the store", () => {
    const before = useDocumentStore.getState().doc;
    useDocumentStore.getState().replaceDoc(applyParsedTable(before, table, { mode: "replace", chart: "bar", provenance: "PARSED" }));
    expect(useDocumentStore.getState().doc.data.labels).toEqual(["Q1", "Q2", "Q3"]);
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().doc.data.labels).toEqual(before.data.labels);
  });
});
