import { describe, expect, it, vi } from "vitest";
import { withFallback } from "./fallbackProvider";
import type { VisionProvider } from "./VisionProvider";

const img = new Blob([new Uint8Array([1])], { type: "image/png" });
const hints = { width: 1, height: 1, colors: [] };
const GOOD = { labels: ["A"], series: [{ name: "S", values: [1] }] };
const LOCAL = { labels: ["L"], series: [{ name: "S", values: [2] }] };
const provider = (impl: () => Promise<unknown>): VisionProvider => ({ name: "P", extractChart: vi.fn(impl) });

describe("withFallback", () => {
  it("uses the primary when it works and never touches the fallback", async () => {
    const fb = provider(async () => LOCAL);
    const onFallback = vi.fn();
    expect(await withFallback(provider(async () => GOOD), fb, onFallback).extractChart(img, hints)).toBe(GOOD);
    expect(fb.extractChart).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
  });
  it.each([
    ["a missing key", () => Promise.reject(Object.assign(new Error("No key"), { code: "no_key" }))],
    ["being offline", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a rate limit", () => Promise.reject(new Error("Rate limited"))],
    ["an upstream error", () => Promise.reject(new Error("502"))],
    ["an unreadable answer", () => Promise.resolve({ nonsense: true })],
  ])("falls back on %s", async (_n, fail) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onFallback = vi.fn();
    expect(await withFallback(provider(fail), provider(async () => LOCAL), onFallback).extractChart(img, hints)).toBe(LOCAL);
    expect(onFallback).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
  it("does not swallow the user's Cancel", async () => {
    const ac = new AbortController();
    ac.abort();
    const fb = provider(async () => LOCAL);
    const abort = provider(() => Promise.reject(new DOMException("Aborted", "AbortError")));
    await expect(withFallback(abort, fb).extractChart(img, hints, ac.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fb.extractChart).not.toHaveBeenCalled();
  });
  it("lets the fallback's own failure surface", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(withFallback(provider(() => Promise.reject(new Error("x"))), provider(() => Promise.reject(new Error("no bars")))).extractChart(img, hints)).rejects.toThrow("no bars");
    warn.mockRestore();
  });
});
