import { describe, expect, it, vi } from "vitest";
import { valueAtPixel, valuesFromPixels } from "./pixelMath";
import { extractionToTable, validateExtraction } from "./VisionProvider";
import { createAnthropicProvider, extractJson } from "./anthropicProvider";
import { loadVisionSettings, parseVisionSettings, persistVisionSettings } from "./visionSettings";

describe("pixel math", () => {
  // baseline at y=400 is 0, the 100 tick is at y=100 -> 1 unit per 3 px
  const cal = { baselinePx: 400, baselineValue: 0, topTickPx: 100, topTickValue: 100 };
  it("interpolates linearly (y grows downward)", () => {
    expect(valueAtPixel(cal, 400)).toBe(0);
    expect(valueAtPixel(cal, 100)).toBe(100);
    expect(valueAtPixel(cal, 250)).toBe(50);
    expect(valueAtPixel(cal, 520)).toBe(-40);
  });
  it("handles blanks and rejects degenerate calibrations", () => {
    expect(valuesFromPixels(cal, [250, null])).toEqual([50, null]);
    expect(valuesFromPixels({ ...cal, topTickPx: 400 }, [250])).toBeNull();
  });
});

describe("validateExtraction", () => {
  const good = {
    chartType: "bar",
    title: "Sales",
    labels: ["A", "B"],
    units: { prefix: "$", suffix: "M" },
    series: [{ name: "S", values: [1, 2], valueSource: "printed", confidence: 0.9, color: "#6366f1" }],
  };
  it("accepts a valid answer", () => {
    const { chart, warnings } = validateExtraction(good);
    expect(chart?.labels).toEqual(["A", "B"]);
    expect(chart?.series[0]!.colorHint).toBe("#6366F1");
    expect(warnings).toEqual([]);
  });
  it("pads/trims mismatched lengths, nulls non-numbers, defaults unknown types", () => {
    const { chart, warnings } = validateExtraction({ ...good, chartType: "radar", series: [{ name: "S", values: [1, "x", 3] }] });
    expect(chart?.chartType).toBe("bar");
    expect(chart?.series[0]!.values).toEqual([1, null]);
    expect(warnings.length).toBe(2);
  });
  it("rejects garbage without throwing", () => {
    expect(validateExtraction(null).chart).toBeNull();
    expect(validateExtraction({ labels: [] }).chart).toBeNull();
    expect(validateExtraction({ labels: ["a"], series: [] }).chart).toBeNull();
  });
});

describe("extractionToTable provenance", () => {
  const base = { chartType: "bar" as const, title: "", subtitle: "", sourceNote: "", style: {}, labels: ["A", "B"], units: { prefix: "", suffix: "" } };
  it("printed -> OCR_EXACT; low confidence -> LOW_CONFIDENCE", () => {
    const t = extractionToTable({ ...base, series: [{ name: "P", values: [1, null], valueSource: "printed", confidence: 0.9 }, { name: "Q", values: [1, 2], valueSource: "printed", confidence: 0.3 }] }, []);
    expect(t.series[0]!.provenance).toEqual(["OCR_EXACT", "MISSING"]);
    expect(t.series[1]!.provenance).toEqual(["LOW_CONFIDENCE", "LOW_CONFIDENCE"]);
  });
  it("calibrated pixel tops override the model's guess and are AXIS_MEASURED", () => {
    const axis = { baselinePx: 400, baselineValue: 0, topTickPx: 100, topTickValue: 100 };
    const t = extractionToTable({ ...base, axis, series: [{ name: "P", values: [null, null], valueSource: "estimated", confidence: 0.9, topsPx: [250, 100] }] }, []);
    expect(t.series[0]!.values).toEqual([50, 100]);
    expect(t.series[0]!.provenance).toEqual(["AXIS_MEASURED", "AXIS_MEASURED"]);
  });
  it("an uncalibrated guess is LOW_CONFIDENCE and colours snap to sampled ones", () => {
    const t = extractionToTable({ ...base, series: [{ name: "P", values: [1, 2], valueSource: "estimated", confidence: 0.9, colorHint: "#6060F0" }] }, [{ hex: "#6366F1", share: 1 }]);
    expect(t.series[0]!.provenance![0]).toBe("LOW_CONFIDENCE");
    expect(t.series[0]!.color).toBe("#6366F1");
  });
});

describe("anthropic provider", () => {
  const img = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
  const hints = { width: 10, height: 10, colors: [] };
  const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("extracts JSON from fenced model output", () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => extractJson("no json")).toThrow();
  });
  it("sends the key only in headers and parses the reply", async () => {
    const f = reply(200, { content: [{ type: "text", text: '{"labels":["A"]}' }] });
    const out = await createAnthropicProvider("sk-test", "m", f as unknown as typeof fetch).extractChart(img, hints);
    expect(out).toEqual({ labels: ["A"] });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-test");
    expect(String(init.body)).not.toContain("sk-test");
  });
  it("maps bad keys and server errors to clean messages", async () => {
    await expect(createAnthropicProvider("k", "m", reply(401, {}) as unknown as typeof fetch).extractChart(img, hints)).rejects.toThrow(/key was rejected/);
    await expect(createAnthropicProvider("k", "m", reply(500, {}) as unknown as typeof fetch).extractChart(img, hints)).rejects.toThrow(/\(500\)/);
    const down = vi.fn(async () => {
      throw new TypeError("offline");
    });
    await expect(createAnthropicProvider("k", "m", down as unknown as typeof fetch).extractChart(img, hints)).rejects.toThrow(/reach/);
  });
});

describe("vision settings storage", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
  };
  it("round-trips and clears", () => {
    const s = mem();
    expect(persistVisionSettings({ provider: "anthropic", apiKey: "sk-1", model: "x" }, s)).toBeNull();
    expect(loadVisionSettings(s)).toEqual({ provider: "anthropic", apiKey: "sk-1", model: "x" });
    persistVisionSettings({ provider: "anthropic", apiKey: "", model: "x" }, s);
    expect(loadVisionSettings(s).apiKey).toBe("");
  });
  it("survives corrupt data, blocked and full storage", () => {
    expect(parseVisionSettings("{nope").apiKey).toBe("");
    expect(persistVisionSettings({ provider: "anthropic", apiKey: "k", model: "m" }, null)).toMatch(/unavailable/);
    const full = { ...mem(), setItem: () => { throw new Error("quota"); } };
    expect(persistVisionSettings({ provider: "anthropic", apiKey: "k", model: "m" }, full)).toMatch(/Couldn't save/);
    const boom = { getItem: () => { throw new Error("blocked"); }, setItem: () => {}, removeItem: () => {} };
    expect(loadVisionSettings(boom).apiKey).toBe("");
  });
});
