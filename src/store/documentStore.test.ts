import { beforeEach, describe, expect, it } from "vitest";
import { useDocumentStore } from "./documentStore";
import { createDefaultDocument } from "../model/defaults";

const reset = () =>
  useDocumentStore.setState({ doc: createDefaultDocument(), past: [], future: [], txn: null });

describe("documentStore history", () => {
  beforeEach(reset);

  it("update → undo → redo restores exact documents", () => {
    const before = structuredClone(useDocumentStore.getState().doc);
    useDocumentStore.getState().update((d) => {
      d.title = "Changed";
    });
    const after = structuredClone(useDocumentStore.getState().doc);
    expect(after.title).toBe("Changed");
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().doc).toEqual(before);
    useDocumentStore.getState().redo();
    expect(useDocumentStore.getState().doc).toEqual(after);
  });

  it("coalesces a 50-tick slider drag into one undo entry", () => {
    const s = useDocumentStore.getState();
    const before = structuredClone(s.doc);
    s.beginTransaction();
    for (let i = 1; i <= 50; i++) s.update((d) => void (d.geometry.barGapRatio = i / 100));
    s.commitTransaction();
    expect(useDocumentStore.getState().past).toHaveLength(1);
    expect(useDocumentStore.getState().doc.geometry.barGapRatio).toBe(0.5);
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().doc).toEqual(before);
  });

  it("clears the redo stack on a new edit", () => {
    const s = useDocumentStore.getState();
    s.update((d) => void (d.title = "A"));
    s.undo();
    expect(useDocumentStore.getState().future).toHaveLength(1);
    useDocumentStore.getState().update((d) => void (d.title = "B"));
    expect(useDocumentStore.getState().future).toHaveLength(0);
  });

  it("ignores no-op updates", () => {
    useDocumentStore.getState().update((d) => void (d.title = d.title));
    expect(useDocumentStore.getState().past).toHaveLength(0);
  });
});
