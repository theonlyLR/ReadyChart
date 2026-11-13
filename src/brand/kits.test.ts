import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultDocument } from "../model/defaults";
import { addSeries } from "../model/dataOps";
import { useDocumentStore } from "../store/documentStore";
import { applyKitToDraft, KIT_STORAGE_KEY, kitFromDoc, MAX_KITS, parseKits, sanitizeKit, serializeKits } from "./kits";
import { loadKits, persistKits, useKitStore } from "./kitStore";

const LOGO = "data:image/png;base64,AAAA";

const brandedDoc = () => {
  const d = createDefaultDocument();
  d.canvas.background = "#0F172A";
  d.data.series[0]!.color = "#112233";
  d.brand = { ...d.brand, logoDataUrl: LOGO, logoInvertedDataUrl: LOGO, logoAspect: 3, logoLuminance: 0.1, anchor: "bottom-left", sizePx: 90, opacity: 0.8, contrastBackdrop: "auto-invert", fontFamily: "lora" };
  return d;
};

class MemoryStorage {
  data = new Map<string, string>();
  fail = false;
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => {
    if (this.fail) throw new DOMException("full", "QuotaExceededError");
    this.data.set(k, v);
  };
}

describe("kit serialization", () => {
  it("round-trips a kit through JSON", () => {
    const kit = kitFromDoc(brandedDoc(), "Acme", "k1");
    expect(parseKits(serializeKits([kit]))).toEqual([kit]);
  });

  it("captures logo, palette, typography and background", () => {
    const kit = kitFromDoc(brandedDoc(), "  Acme  ", "k1");
    expect(kit).toMatchObject({ name: "Acme", background: "#0F172A", palette: ["#112233"] });
    expect(kit.brand).toMatchObject({ logoDataUrl: LOGO, fontFamily: "lora", anchor: "bottom-left" });
  });

  it.each([null, "", "not json", "{}", '{"version":2,"kits":[]}', '{"version":1,"kits":"x"}', "[]"])("corrupt storage %j yields an empty vault", (json) => {
    expect(parseKits(json)).toEqual([]);
  });

  it("drops unusable entries, duplicate ids and clamps wild values", () => {
    const good = kitFromDoc(brandedDoc(), "Good", "a");
    const json = JSON.stringify({
      version: 1,
      kits: [good, { ...good, name: "dup" }, null, { id: 5 }, { id: "b", name: "B", brand: { sizePx: 99999, opacity: -4, anchor: "middle", fontFamily: "comic-sans", contrastBackdrop: "x" }, palette: ["#abcdef", "red", 7], background: "nope" }],
    });
    const kits = parseKits(json);
    expect(kits.map((k) => k.id)).toEqual(["a", "b"]);
    expect(kits[1]).toMatchObject({ palette: ["#abcdef"], background: "#FFFFFF" });
    expect(kits[1]!.brand).toMatchObject({ sizePx: 320, opacity: 0.1, anchor: "top-right", fontFamily: "inter", contrastBackdrop: "none", logoDataUrl: null });
  });

  it("refuses remote logo URLs from tampered storage (tainted-canvas guard)", () => {
    const k = sanitizeKit({ id: "x", name: "x", brand: { logoDataUrl: "https://evil.example/l.png", logoInvertedDataUrl: "https://evil.example/i.png" } })!;
    expect(k.brand.logoDataUrl).toBeNull();
    expect(k.brand.logoInvertedDataUrl).toBeNull();
  });

  it("caps the vault size when loading", () => {
    const kits = Array.from({ length: MAX_KITS + 5 }, (_, i) => kitFromDoc(createDefaultDocument(), `k${i}`, `id${i}`));
    expect(parseKits(serializeKits(kits))).toHaveLength(MAX_KITS);
  });
});

describe("storage", () => {
  it("persists and reloads", () => {
    const s = new MemoryStorage();
    const kit = kitFromDoc(brandedDoc(), "Acme", "k1");
    expect(persistKits([kit], s)).toBeNull();
    expect(s.data.has(KIT_STORAGE_KEY)).toBe(true);
    expect(loadKits(s)).toEqual([kit]);
  });
  it("reports quota errors and missing storage instead of throwing", () => {
    const s = new MemoryStorage();
    s.fail = true;
    expect(persistKits([], s)).toMatch(/full/);
    expect(persistKits([], null)).toMatch(/unavailable/);
    expect(loadKits(null)).toEqual([]);
  });
});

describe("applying a kit", () => {
  it("restyles brand, background and series colours without touching data", () => {
    const kit = kitFromDoc(brandedDoc(), "Acme", "k1");
    const target = createDefaultDocument();
    addSeries(target.data);
    const before = structuredClone(target.data);
    applyKitToDraft(target, kit);
    expect(target.brand).toEqual(kit.brand);
    expect(target.canvas.background).toBe("#0F172A");
    expect(target.data.series.map((s) => s.color)).toEqual(["#112233", "#112233"]); // palette cycles
    expect(target.data.labels).toEqual(before.labels);
    expect(target.data.series.map((s) => s.values)).toEqual(before.series.map((s) => s.values));
  });
  it("a kit with an empty palette leaves series colours alone", () => {
    const kit = kitFromDoc(brandedDoc(), "x", "k");
    kit.palette = [];
    const d = createDefaultDocument();
    const color = d.data.series[0]!.color;
    applyKitToDraft(d, kit);
    expect(d.data.series[0]!.color).toBe(color);
  });
});

describe("kit store", () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
    useKitStore.setState({ kits: [], error: null });
    useDocumentStore.setState({ doc: brandedDoc(), past: [], future: [], txn: null });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("save -> persisted -> delete round trip", () => {
    const { save, remove } = useKitStore.getState();
    expect(save(useDocumentStore.getState().doc, "Acme")).toBe(true);
    expect(loadKits(storage)).toHaveLength(1);
    remove(useKitStore.getState().kits[0]!.id);
    expect(useKitStore.getState().kits).toEqual([]);
    expect(loadKits(storage)).toEqual([]);
  });

  it("rename ignores blank names", () => {
    useKitStore.getState().save(useDocumentStore.getState().doc, "Acme");
    const id = useKitStore.getState().kits[0]!.id;
    useKitStore.getState().rename(id, "   ");
    expect(useKitStore.getState().kits[0]!.name).toBe("Acme");
    useKitStore.getState().rename(id, "Renamed");
    expect(loadKits(storage)[0]!.name).toBe("Renamed");
  });

  it("apply is a single undo step that restores the previous look exactly", () => {
    useKitStore.getState().save(useDocumentStore.getState().doc, "Acme");
    const id = useKitStore.getState().kits[0]!.id;
    const plain = createDefaultDocument();
    useDocumentStore.setState({ doc: plain, past: [], future: [], txn: null });
    useKitStore.getState().apply(id);
    expect(useDocumentStore.getState().doc.brand.logoDataUrl).toBe(LOGO);
    expect(useDocumentStore.getState().past).toHaveLength(1);
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().doc).toEqual(plain);
  });

  it("keeps kits in memory and reports the error when storage is full", () => {
    storage.fail = true;
    expect(useKitStore.getState().save(useDocumentStore.getState().doc, "Acme")).toBe(false);
    expect(useKitStore.getState().kits).toHaveLength(1);
    expect(useKitStore.getState().error).toMatch(/full/);
  });

  it("refuses to exceed the vault limit", () => {
    for (let i = 0; i < MAX_KITS; i++) useKitStore.getState().save(useDocumentStore.getState().doc, `k${i}`);
    expect(useKitStore.getState().save(useDocumentStore.getState().doc, "one too many")).toBe(false);
    expect(useKitStore.getState().kits).toHaveLength(MAX_KITS);
  });
});
