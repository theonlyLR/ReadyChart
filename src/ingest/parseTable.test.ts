import { describe, expect, it } from "vitest";
import { MESSY_SLACK_PASTE, MESSY_WIKIPEDIA_TSV } from "../../fixtures/goldenDatasets";
import { parsePastedText, parseUnitCell, suggestChart } from "./parseTable";

describe("parseUnitCell", () => {
  it.each([
    ["$4.2M", 4.2, "$", "", "M"],
    ["£312.4k", 312.4, "£", "", "K"],
    ["12%", 12, "", "%", ""],
    ["1.250,50 €", 1250.5, "", "€", ""],
    ["(3.5)", -3.5, "", "", ""],
    ["-$14.2", -14.2, "$", "", ""],
    ["₦48,500,000", 48500000, "₦", "", ""],
    ["2.1bn", 2.1, "", "", "B"],
  ])("%s", (text, value, prefix, sym, mag) => expect(parseUnitCell(text)).toEqual({ value, prefix, sym, mag }));
  it("flags unreadable and blank", () => {
    expect(parseUnitCell("n/a").value).toBeUndefined();
    expect(parseUnitCell("").value).toBeNull();
  });
});

describe("parsePastedText", () => {
  it("spreadsheet TSV with units in the header", () => {
    const t = parsePastedText(MESSY_WIKIPEDIA_TSV)!;
    expect(t.labels).toEqual(["2022", "2023", "2024"]);
    expect(t.series.map((s) => s.name)).toEqual(["Revenue", "YoY Growth"]);
    expect(t.series[0]!.values).toEqual([142.8, 198.4, 271]);
    // "($M)" in the header supplies the M suffix because the cells themselves are plain "$142.8".
    expect(t.units).toEqual({ prefix: "$", suffix: "M" });
    expect(t.series[1]!.included).toBe(false);
    expect(t.warnings.some((w) => w.includes("YoY Growth"))).toBe(true);
  });

  it("CSV with $M cells keeps prefix and suffix", () => {
    const t = parsePastedText("Quarter,Revenue\nQ1,$4.2M\nQ2,$5.1M\nQ3,$3.9M")!;
    expect(t.labels).toEqual(["Q1", "Q2", "Q3"]);
    expect(t.units).toEqual({ prefix: "$", suffix: "M" });
    expect(t.chart).toBe("bar");
  });

  it("markdown table of shares suggests a donut", () => {
    const t = parsePastedText("| Region | Share |\n| --- | ---: |\n| North | 45% |\n| South | 35% |\n| West | 20% |")!;
    expect(t.labels).toEqual(["North", "South", "West"]);
    expect(t.units.suffix).toBe("%");
    expect(t.chart).toBe("donut");
  });

  it("bulleted and numbered lists", () => {
    const t = parsePastedText("• Apples: 12\n• Pears: 7\n• Plums: 3")!;
    expect(t.labels).toEqual(["Apples", "Pears", "Plums"]);
    expect(t.series[0]!.values).toEqual([12, 7, 3]);
    expect(parsePastedText("1. Lagos 48\n2. London 31\n3. Berlin 22")!.labels).toEqual(["Lagos", "London", "Berlin"]);
  });

  it("thousands separators are not column breaks", () => {
    expect(parsePastedText("Lagos 1,250\nLondon 2,400\nBerlin 980")!.series[0]!.values).toEqual([1250, 2400, 980]);
  });

  it("transposed table", () => {
    const t = parsePastedText("Region\tQ1\tQ2\tQ3\tQ4\nNorth\t1\t2\t3\t4\nSouth\t5\t6\t7\t8")!;
    expect(t.labels).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(t.series.map((s) => s.name)).toEqual(["North", "South"]);
  });

  it("European semicolon CSV", () => {
    expect(parsePastedText("Monat;Umsatz\nJan;1.250,5\nFeb;980,25")!.series[0]!.values).toEqual([1250.5, 980.25]);
  });

  it("mixed K/M in a column are converted with a warning", () => {
    const t = parsePastedText("City,Sales\nA,1.2M\nB,800K\nC,2M")!;
    expect(t.units.suffix).toBe("M");
    expect(t.series[0]!.values[1]).toBeCloseTo(0.8);
    expect(t.warnings.length).toBeGreaterThan(0);
  });

  it("ragged rows and unreadable cells become null + warning", () => {
    const t = parsePastedText("Item,A,B\nx,1,2\ny,3\nz,oops,5")!;
    expect(t.series[0]!.values).toEqual([1, 3, null]);
    expect(t.warnings.some((w) => w.includes("not readable"))).toBe(true);
  });

  it("JSON array of objects", () => {
    const t = parsePastedText('[{"month":"Jan","sales":10},{"month":"Feb","sales":14}]')!;
    expect(t.labels).toEqual(["Jan", "Feb"]);
    expect(t.series[0]!.values).toEqual([10, 14]);
  });

  it("free prose is read with a warning", () => {
    const t = parsePastedText(MESSY_SLACK_PASTE)!;
    expect(t.labels).toEqual(["Lagos", "London", "Berlin"]);
    expect(t.series[0]!.values[0]).toBe(48500000);
    expect(t.warnings.some((w) => w.includes("free text"))).toBe(true);
  });

  it("returns null for non-data", () => {
    expect(parsePastedText("")).toBeNull();
    expect(parsePastedText("hello there, how are you")).toBeNull();
  });
});

describe("suggestChart", () => {
  const s = (values: number[]) => [{ values }];
  it("time-like labels", () => {
    expect(suggestChart(["Jan", "Feb", "Mar"], s([1, 2, 3]), "")).toBe("bar");
    const many = Array.from({ length: 12 }, (_, i) => `2024-${String(i + 1).padStart(2, "0")}`);
    expect(suggestChart(many, s(many.map((_, i) => i)), "")).toBe("line");
  });
  it("shares summing to 100 are a donut; negatives never", () => {
    expect(suggestChart(["a", "b", "c"], s([50, 30, 20]), "")).toBe("donut");
    expect(suggestChart(["a", "b", "c"], s([50, -30, 20]), "")).toBe("bar");
  });
  it("many long labels go horizontal", () => {
    const labels = Array.from({ length: 14 }, (_, i) => `Category number ${i}`);
    expect(suggestChart(labels, s(labels.map((_, i) => i + 5)), "")).toBe("horizontal-bar");
  });
  it("multi-series percent rows summing to 100 stack", () => {
    expect(suggestChart(["a", "b"], [{ values: [60, 30] }, { values: [40, 70] }], "%")).toBe("stacked-bar");
  });
});
