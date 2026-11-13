import { describe, expect, it, vi } from "vitest";
import { createProxyProvider, probeProxy } from "./proxyProvider";
import { VisionError } from "./prompt";

const img = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
const hints = { width: 10, height: 10, colors: [] };
const json = (data: unknown, status = 200, type = "application/json") => new Response(typeof data === "string" ? data : JSON.stringify(data), { status, headers: { "content-type": type } });

describe("probeProxy", () => {
  it("reads which provider the server holds, without any secret", async () => {
    const f = vi.fn().mockResolvedValue(json({ configured: "gemini" }));
    expect(await probeProxy(f as unknown as typeof fetch)).toEqual({ available: true, configured: "gemini" });
    expect(await probeProxy(vi.fn().mockResolvedValue(json({ configured: null })) as unknown as typeof fetch)).toEqual({ available: true, configured: null });
  });
  it("treats a static build (HTML fallback or network error) as no proxy", async () => {
    expect(await probeProxy(vi.fn().mockResolvedValue(json("<html>", 200, "text/html")) as unknown as typeof fetch)).toEqual({ available: false, configured: null });
    expect(await probeProxy(vi.fn().mockRejectedValue(new TypeError("x")) as unknown as typeof fetch)).toEqual({ available: false, configured: null });
  });
});

describe("createProxyProvider", () => {
  it("posts the image and sends key headers only when the user supplied a key", async () => {
    const f = vi.fn().mockResolvedValue(json({ provider: "gemini", extraction: { labels: ["A"] } }));
    const out = await createProxyProvider(() => ({ apiKey: "sk-ui", provider: "openai" }), f as unknown as typeof fetch).extractChart(img, hints);
    expect(out).toEqual({ labels: ["A"] });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/scan-chart");
    expect(init.headers).toMatchObject({ "x-api-key": "sk-ui", "x-provider": "openai" });
    expect(String(init.body)).not.toContain("sk-ui");

    const g = vi.fn().mockResolvedValue(json({ provider: "gemini", extraction: {} }));
    await createProxyProvider(() => ({}), g as unknown as typeof fetch).extractChart(img, hints);
    expect((g.mock.calls[0] as [string, RequestInit])[1].headers).not.toHaveProperty("x-api-key");
  });
  it("surfaces the server's error code and message", async () => {
    const f = vi.fn().mockResolvedValue(json({ error: { code: "no_key", message: "No key" } }, 401));
    const err = await createProxyProvider(() => ({}), f as unknown as typeof fetch).extractChart(img, hints).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VisionError);
    expect(err).toMatchObject({ code: "no_key", message: "No key" });
  });
  it("passes the abort signal through, and rethrows aborts untouched", async () => {
    const ac = new AbortController();
    const f = vi.fn().mockImplementation(async () => {
      ac.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    await expect(createProxyProvider(() => ({}), f as unknown as typeof fetch).extractChart(img, hints, ac.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect((f.mock.calls[0] as [string, RequestInit])[1].signal).toBe(ac.signal);
  });
});
