import { describe, expect, it, vi } from "vitest";
import { createDefaultDocument } from "../model/defaults";
import { useDocumentStore } from "../store/documentStore";
import { requestRefinement } from "../vision/refine";
import { applyRefinePatch, docForCritique } from "./refinePatch";

const doc = () => createDefaultDocument(); // Q1..Q4 = 42, 58, 51, 77, series colour indigo

describe("applyRefinePatch allowlist", () => {
  it("applies text, canvas and geometry fixes with value validation and clamping", () => {
    const r = applyRefinePatch(doc(), [
      { op: "replace", path: "/title", value: "Revenue by region" },
      { op: "replace", path: "/subtitle", value: "FY2025" },
      { op: "replace", path: "/sourceFooter", value: "Source: X" },
      { op: "replace", path: "/canvas/background", value: "#0f172a" },
      { op: "replace", path: "/canvas/titleAlign", value: "center" },
      { op: "replace", path: "/canvas/titleScale", value: 9 },
      { op: "replace", path: "/geometry/barGapRatio", value: 0.4 },
      { op: "replace", path: "/geometry/showGridlines", value: false },
      { op: "replace", path: "/geometry/legendPosition", value: "bottom" },
      { op: "replace", path: "/geometry/barRadius", value: [0, 0, 0, 0] },
      { op: "replace", path: "/data/unitSuffix", value: "%" },
    ]);
    expect(r.rejected).toEqual([]);
    expect(r.doc).toMatchObject({ title: "Revenue by region", subtitle: "FY2025", sourceFooter: "Source: X" });
    expect(r.doc.canvas).toMatchObject({ background: "#0F172A", titleAlign: "center", titleScale: 1.6 });
    expect(r.doc.geometry).toMatchObject({ barGapRatio: 0.4, showGridlines: false, legendPosition: "bottom", barRadius: [0, 0, 0, 0] });
    expect(r.doc.data.unitSuffix).toBe("%");
  });
  it("corrects labels and cell values, re-tagging changed cells for review", () => {
    const r = applyRefinePatch(doc(), [
      { op: "replace", path: "/data/labels/1", value: "Q2 (est.)" },
      { op: "replace", path: "/data/series/0/values/3", value: 80 },
      { op: "replace", path: "/data/series/0/values/0", value: null },
    ]);
    expect(r.rejected).toEqual([]);
    expect(r.doc.data.labels[1]).toBe("Q2 (est.)");
    expect(r.doc.data.series[0]!.values).toEqual([null, 58, 51, 80]);
    expect(r.doc.data.series[0]!.provenance).toEqual(["MISSING", "USER_INPUT", "USER_INPUT", "LOW_CONFIDENCE"]);
  });
  it("edits per-bar colours with add / replace / remove", () => {
    const a = applyRefinePatch(doc(), [{ op: "add", path: "/data/series/0/pointColorOverrides/2", value: "#f59e0b" }]);
    expect(a.doc.data.series[0]!.pointColorOverrides).toEqual({ 2: "#F59E0B" });
    const b = applyRefinePatch(a.doc, [{ op: "remove", path: "/data/series/0/pointColorOverrides/2" }]);
    expect(b.doc.data.series[0]!.pointColorOverrides).toBeUndefined();
  });
  it("switching chart type goes through setChartType so per-item colours survive", () => {
    const d = doc();
    d.data.series[0]!.pointColorOverrides = { 2: "#F59E0B" };
    const r = applyRefinePatch(d, [{ op: "replace", path: "/geometry/type", value: "pie" }]);
    expect(r.doc.geometry.type).toBe("pie");
    expect(Object.keys(r.doc.data.series[0]!.pointColorOverrides ?? {})).toHaveLength(4);
  });
  it.each([
    [{ op: "replace", path: "/brand/logoDataUrl", value: "data:image/png;base64,AAAA" }, /allowed/],
    [{ op: "replace", path: "/motion/enabled", value: true }, /allowed/],
    [{ op: "replace", path: "/id", value: "x" }, /allowed/],
    [{ op: "add", path: "/data/labels/-", value: "Q5" }, /no such row|expected|allowed/],
    [{ op: "remove", path: "/data/labels/0" }, /expected text/],
    [{ op: "add", path: "/data/series/1", value: {} }, /series/],
    [{ op: "replace", path: "/data/series/0/provenance/0", value: "OCR_EXACT" }, /allowed/],
    [{ op: "replace", path: "/data/series/0/values/9", value: 1 }, /no such row/],
    [{ op: "replace", path: "/data/series/0/values/0", value: "12" }, /number or null/],
    [{ op: "replace", path: "/canvas/background", value: "red" }, /RRGGBB/],
    [{ op: "replace", path: "/geometry/type", value: "radar" }, /unknown chart type/],
    [{ op: "copy", path: "/title", from: "/subtitle" }, /unsupported/],
    [{ op: "remove", path: "/title" }, /can't remove/],
  ])("rejects %j", (op, why) => {
    const before = doc();
    const r = applyRefinePatch(before, [op]);
    expect(r.applied).toEqual([]);
    expect(r.rejected[0]!.reason).toMatch(why);
    expect(r.doc).toEqual(before);
  });
  it("doesn't mutate its input, tolerates garbage, and applies the valid ops around a bad one", () => {
    const before = doc();
    const snapshot = structuredClone(before);
    const r = applyRefinePatch(before, [null, "x", { op: "replace", path: "/title", value: "OK" }, { op: "replace", path: "/brand/anchor", value: "x" }]);
    expect(before).toEqual(snapshot);
    expect(r.applied).toHaveLength(1);
    expect(r.rejected).toHaveLength(3);
    expect(r.doc.title).toBe("OK");
  });
  it("lands in the store as one undo step", () => {
    const s = useDocumentStore;
    s.getState().replaceDoc(doc());
    const depth = s.getState().past.length;
    const patched = applyRefinePatch(s.getState().doc, [
      { op: "replace", path: "/title", value: "Fixed" },
      { op: "replace", path: "/data/series/0/values/0", value: 44 },
    ]).doc;
    s.getState().replaceDoc(patched);
    expect(s.getState().past.length).toBe(depth + 1);
    s.getState().undo();
    expect(s.getState().doc.title).toBe("Quarterly Revenue");
  });
});

describe("docForCritique", () => {
  it("never includes the logo, fonts or motion", () => {
    const d = doc();
    d.brand.logoDataUrl = "data:image/png;base64,SECRETLOGO";
    const text = JSON.stringify(docForCritique(d));
    expect(text).not.toContain("SECRETLOGO");
    expect(text).not.toContain("physicsMode");
    expect(text).toContain("Quarterly Revenue");
  });
});

describe("requestRefinement", () => {
  const png = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
  const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  it("posts both images and the document, returns the patch", async () => {
    const f = vi.fn().mockResolvedValue(ok({ patch: [{ op: "replace", path: "/title", value: "x" }] }));
    const patch = await requestRefinement({ original: png, recreated: png, doc: { a: 1 }, auth: { apiKey: "k", provider: "gemini" } }, f as unknown as typeof fetch);
    expect(patch).toHaveLength(1);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/refine-chart");
    expect(JSON.parse(String(init.body))).toMatchObject({ doc: { a: 1 } });
    expect(init.headers).toMatchObject({ "x-api-key": "k", "x-provider": "gemini" });
  });
  it.each([["server error", () => Promise.resolve(ok({ error: {} }, 502))], ["offline", () => Promise.reject(new TypeError("x"))], ["bad reply", () => Promise.resolve(ok({ nope: 1 }))]])("returns null on %s instead of throwing", async (_n, impl) => {
    expect(await requestRefinement({ original: png, recreated: png, doc: {} }, vi.fn(impl) as unknown as typeof fetch)).toBeNull();
  });
  it("gives up on a stalled server after its own deadline, but the user's Cancel still throws", async () => {
    const stall = (_u: string, i: RequestInit) =>
      new Promise((_, rej) => {
        if (i.signal!.aborted) return rej(i.signal!.reason); // like real fetch: an already-aborted signal rejects at once
        i.signal!.addEventListener("abort", () => rej(i.signal!.reason), { once: true });
      });
    const started = Date.now();
    expect(await requestRefinement({ original: png, recreated: png, doc: {}, timeoutMs: 30 }, vi.fn(stall) as unknown as typeof fetch)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
    const ac = new AbortController();
    const p = requestRefinement({ original: png, recreated: png, doc: {}, signal: ac.signal }, vi.fn(stall) as unknown as typeof fetch);
    ac.abort();
    await expect(p).rejects.toBeDefined();
  });
});
