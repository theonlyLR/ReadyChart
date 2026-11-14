import { describe, expect, it } from "vitest";
import { setChartType } from "../../model/dataOps";
import { createDefaultDocument } from "../../model/defaults";
import { useDocumentStore } from "../../store/documentStore";
import { QUICK_TYPES } from "./CompareOriginal";

describe("Compare pill chart-type switcher", () => {
  it("offers Bar | H-Bar | Line | Pie", () => {
    expect(QUICK_TYPES.map((q) => q.label)).toEqual(["Bar", "H-Bar", "Line", "Pie"]);
    expect(QUICK_TYPES.map((q) => q.type)).toEqual(["bar", "horizontal-bar", "line", "pie"]);
  });
  it("switching keeps data, labels and per-bar colours, and is one undo step each", () => {
    const store = useDocumentStore;
    const doc = createDefaultDocument();
    doc.data.series[0]!.pointColorOverrides = { 2: "#F59E0B" };
    store.getState().replaceDoc(doc);
    const before = store.getState().doc;
    const depth = store.getState().past.length;
    for (const q of QUICK_TYPES) store.getState().update((d) => setChartType(d, q.type));
    const after = store.getState().doc;
    expect(after.geometry.type).toBe("pie");
    expect(after.data.labels).toEqual(before.data.labels);
    expect(after.data.series[0]!.values).toEqual(before.data.series[0]!.values);
    // pie keeps what the bars showed: the amber bar stays amber and the rest keep the series colour
    const c = before.data.series[0]!.color;
    expect(after.data.series[0]!.pointColorOverrides).toEqual({ 0: c, 1: c, 2: "#F59E0B", 3: c });
    expect(store.getState().past.length).toBe(depth + 3); // bar -> bar is a no-op, the other three are undoable
    store.getState().undo();
    expect(store.getState().doc.geometry.type).toBe("line");
  });
});
