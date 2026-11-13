import { describe, expect, it, vi } from "vitest";
import { GEMINI_MODELS, GEMINI_TIMEOUT_MS, cachedGeminiModel, configuredProvider, handleScan, resetGeminiRoutes, resolveCredentials } from "./scanProxy.ts";

const body = JSON.stringify({ image: "AAAA", mimeType: "image/png", hints: { width: 10, height: 10, colors: ["#112233"] } });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const REPLY = { labels: ["A"], series: [{ name: "S", values: [1] }] };

describe("resolveCredentials", () => {
  it(".env.local keys win, in Gemini > Anthropic > OpenAI order", () => {
    expect(resolveCredentials({ OPENAI_API_KEY: "o", ANTHROPIC_API_KEY: "a" }, { "x-api-key": "h", "x-provider": "gemini" })).toEqual({ provider: "anthropic", key: "a" });
    expect(resolveCredentials({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" }, {})).toEqual({ provider: "gemini", key: "g" });
  });
  it("falls back to the headers only when no env key exists", () => {
    expect(resolveCredentials({}, { "x-api-key": "h", "x-provider": "openai" })).toEqual({ provider: "openai", key: "h" });
    expect(resolveCredentials({}, { "x-api-key": "h" })).toEqual({ provider: "anthropic", key: "h" });
    expect(resolveCredentials({ GEMINI_API_KEY: "  " }, {})).toBeNull();
  });
  it("reports which provider is configured, never the key", () => {
    expect(configuredProvider({ OPENAI_API_KEY: "o" })).toBe("openai");
    expect(configuredProvider({})).toBeNull();
  });
});

describe("handleScan", () => {
  it("returns no_key when nothing is configured", async () => {
    const r = await handleScan({ body, headers: {} }, {}, vi.fn());
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ error: { code: "no_key" } });
  });
  it("rejects malformed requests before calling out", async () => {
    const f = vi.fn();
    expect((await handleScan({ body: "nope", headers: {} }, { GEMINI_API_KEY: "g" }, f)).status).toBe(400);
    expect((await handleScan({ body: JSON.stringify({ image: "AA", mimeType: "image/gif" }), headers: {} }, { GEMINI_API_KEY: "g" }, f)).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
  it("routes to Gemini and unwraps its reply", async () => {
    resetGeminiRoutes();
    const f = vi.fn().mockResolvedValue(json({ candidates: [{ content: { parts: [{ text: JSON.stringify(REPLY) }] } }] }));
    const r = await handleScan({ body, headers: {} }, { GEMINI_API_KEY: "g-secret" }, f);
    expect(r).toEqual({ status: 200, body: { provider: "gemini", extraction: REPLY } });
    expect(String(f.mock.calls[0]![0])).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent");
    expect((f.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ "x-goog-api-key": "g-secret" });
  });
  describe("Gemini fast failover", () => {
    const ok = () => json({ candidates: [{ content: { parts: [{ text: JSON.stringify(REPLY) }] } }] });
    const err = (status: number, message = "boom") => json({ error: { code: status, message } }, status);
    const KEYS = ["AIzaSyExample123", "AQ.abc123"];
    const AI = (m: string) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
    const quiet = () => {
      resetGeminiRoutes();
      return vi.spyOn(console, "error").mockImplementation(() => {});
    };
    const run = (f: ReturnType<typeof vi.fn>, key = KEYS[0]!, extra: Record<string, string> = {}, timeoutMs?: number) =>
      handleScan({ body, headers: {} }, { GEMINI_API_KEY: key, ...extra }, f as unknown as typeof fetch, undefined, { timeoutMs });
    const urls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => String(c[0]));
    const init = (f: ReturnType<typeof vi.fn>, i: number) => f.mock.calls[i]![1] as RequestInit;

    it("fails over fast models first: flash-latest, flash-lite, 3.8, 3.6", () => {
      expect([...GEMINI_MODELS]).toEqual(["gemini-flash-latest", "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.6-flash"]);
    });
    it.each(KEYS)("never calls aiplatform.googleapis.com, whatever the key prefix (%s)", async (key) => {
      const e = quiet();
      const f = vi.fn().mockResolvedValue(err(503));
      await run(f, key);
      expect(urls(f)).toEqual(GEMINI_MODELS.map(AI)); // one attempt per model, one endpoint
      expect(urls(f).some((u) => u.includes("aiplatform"))).toBe(false);
      for (let i = 0; i < f.mock.calls.length; i++) {
        expect(init(f, i).headers).toMatchObject({ "x-goog-api-key": key });
        expect(urls(f)[i]).not.toContain(key);
      }
      e.mockRestore();
    });
    it("sends clean Gemini 3.x config", async () => {
      const e = quiet();
      const f = vi.fn().mockResolvedValue(ok());
      await run(f);
      expect(JSON.parse(String(init(f, 0).body)).generationConfig).toEqual({ responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "medium" } });
      e.mockRestore();
    });
    it("attaches an 8 s deadline signal to every attempt", async () => {
      const e = quiet();
      const f = vi.fn().mockResolvedValue(err(503));
      await run(f);
      for (let i = 0; i < f.mock.calls.length; i++) expect(init(f, i).signal).toBeInstanceOf(AbortSignal);
      expect(GEMINI_TIMEOUT_MS).toBe(8000);
      e.mockRestore();
    });
    it("a stalled model is aborted by its deadline and the next model answers", async () => {
      const e = quiet();
      const f = vi.fn().mockImplementation((u: string, i: RequestInit) =>
        u === AI("gemini-flash-latest")
          ? new Promise((_, reject) => i.signal!.addEventListener("abort", () => reject(i.signal!.reason), { once: true })) // hangs until aborted
          : Promise.resolve(ok()),
      );
      const started = Date.now();
      expect((await run(f, KEYS[0], {}, 40)).status).toBe(200);
      expect(Date.now() - started).toBeLessThan(1000);
      expect(urls(f)).toEqual([AI("gemini-flash-latest"), AI("gemini-3.5-flash-lite")]);
      expect(cachedGeminiModel(KEYS[0]!)).toBe("gemini-3.5-flash-lite");
      expect(e.mock.calls.some((c) => String(c[0]).includes("timed out"))).toBe(true);
      e.mockRestore();
    });
    it("the user's Cancel still aborts instead of failing over", async () => {
      const e = quiet();
      const ac = new AbortController();
      const f = vi.fn().mockImplementation((_u: string, i: RequestInit) => new Promise((_, reject) => i.signal!.addEventListener("abort", () => reject(i.signal!.reason), { once: true })));
      const p = handleScan({ body, headers: {} }, { GEMINI_API_KEY: KEYS[0] }, f as unknown as typeof fetch, ac.signal);
      ac.abort();
      await p; // the response is discarded by the server once the client is gone; what matters is no further attempts
      expect(f).toHaveBeenCalledTimes(1);
      e.mockRestore();
    });
    it("caches the first model that returns 200 and tries it first next time", async () => {
      const e = quiet();
      await run(vi.fn().mockImplementation(async (u: string) => (u === AI("gemini-3.8-flash") ? ok() : err(404, "model not found"))));
      expect(cachedGeminiModel(KEYS[0]!)).toBe("gemini-3.8-flash");
      const f = vi.fn().mockResolvedValue(ok());
      expect((await run(f)).status).toBe(200);
      expect(urls(f)).toEqual([AI("gemini-3.8-flash")]);
      e.mockRestore();
    });
    it("drops a stale cached model and heals through the list", async () => {
      const e = quiet();
      await run(vi.fn().mockResolvedValue(ok())); // caches flash-latest
      const f = vi.fn().mockImplementation(async (u: string) => (u === AI("gemini-3.5-flash-lite") ? ok() : err(404, "deprecated")));
      expect((await run(f)).status).toBe(200);
      expect(cachedGeminiModel(KEYS[0]!)).toBe("gemini-3.5-flash-lite");
      e.mockRestore();
    });
    it("rides out transient 429, 5xx and network errors", async () => {
      const e = quiet();
      const f = vi.fn().mockResolvedValueOnce(err(429)).mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(err(503)).mockResolvedValueOnce(ok());
      expect((await run(f)).status).toBe(200);
      expect(f).toHaveBeenCalledTimes(4);
      e.mockRestore();
    });
    it("GEMINI_MODEL pins a single model", async () => {
      const e = quiet();
      const f = vi.fn().mockResolvedValue(err(404));
      await run(f, KEYS[0], { GEMINI_MODEL: "my-model" });
      expect(urls(f)).toEqual([AI("my-model")]);
      e.mockRestore();
    });
    it("stops at once when the key itself is bad (401 or API_KEY_INVALID)", async () => {
      const e = quiet();
      const f = vi.fn().mockResolvedValue(err(401));
      expect(await run(f)).toMatchObject({ status: 401, body: { error: { code: "bad_key" } } });
      expect(f).toHaveBeenCalledTimes(1);
      resetGeminiRoutes();
      const g = vi.fn().mockResolvedValue(json({ error: { message: "API key not valid. Please pass a valid API key." } }, 400));
      expect(await run(g)).toMatchObject({ status: 401, body: { error: { code: "bad_key" } } });
      expect(g).toHaveBeenCalledTimes(1);
      e.mockRestore();
    });
    it("reports rate_limited / upstream only after every model failed", async () => {
      const e = quiet();
      expect(await run(vi.fn().mockResolvedValue(err(429)))).toMatchObject({ status: 429, body: { error: { code: "rate_limited" } } });
      resetGeminiRoutes();
      expect(await run(vi.fn().mockRejectedValue(new TypeError("offline")))).toMatchObject({ status: 502, body: { error: { code: "upstream" } } });
      e.mockRestore();
    });
    it("logs each failed attempt's status and Google message to stderr, never the key", async () => {
      const e = quiet();
      await run(vi.fn().mockResolvedValueOnce(err(404, "models/gemini-flash-latest is not found")).mockResolvedValueOnce(ok()), KEYS[1]);
      const lines = e.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes("gemini-flash-latest") && l.includes("HTTP 404") && l.includes("is not found"))).toBe(true);
      expect(lines.some((l) => l.includes("model cached") && l.includes("gemini-3.5-flash-lite"))).toBe(true);
      expect(lines.join("\n")).not.toContain(KEYS[1]);
      e.mockRestore();
    });
  });
  it("routes to Anthropic and OpenAI", async () => {
    const a = vi.fn().mockResolvedValue(json({ content: [{ type: "text", text: "```json\n" + JSON.stringify(REPLY) + "\n```" }] }));
    expect((await handleScan({ body, headers: {} }, { ANTHROPIC_API_KEY: "a" }, a)).body).toMatchObject({ provider: "anthropic", extraction: REPLY });
    const o = vi.fn().mockResolvedValue(json({ choices: [{ message: { content: JSON.stringify(REPLY) } }] }));
    expect((await handleScan({ body, headers: {} }, { OPENAI_API_KEY: "o" }, o)).body).toMatchObject({ provider: "openai", extraction: REPLY });
  });
  it("maps upstream failures and never echoes the key", async () => {
    const run = (res: Response) => handleScan({ body, headers: {} }, { ANTHROPIC_API_KEY: "sk-very-secret" }, vi.fn().mockResolvedValue(res));
    const bad = await run(json({}, 401));
    expect(bad).toMatchObject({ status: 401, body: { error: { code: "bad_key" } } });
    expect(await run(json({}, 429))).toMatchObject({ status: 429, body: { error: { code: "rate_limited" } } });
    expect(await run(json({}, 500))).toMatchObject({ status: 502, body: { error: { code: "upstream" } } });
    const garbled = await run(json({ content: [{ type: "text", text: "sorry, no chart" }] }));
    expect(garbled).toMatchObject({ status: 502, body: { error: { code: "bad_json" } } });
    expect(JSON.stringify([bad, garbled])).not.toContain("sk-very-secret");
  });
  it("treats Gemini's 400 invalid-key response as bad_key", async () => {
    resetGeminiRoutes();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = new Response(JSON.stringify({ error: { message: "API key not valid", details: [{ reason: "API_KEY_INVALID" }] } }), { status: 400 });
    expect(await handleScan({ body, headers: {} }, { GEMINI_API_KEY: "x" }, vi.fn().mockResolvedValue(res))).toMatchObject({ status: 401, body: { error: { code: "bad_key" } } });
  });
  it("reports a network failure as upstream", async () => {
    expect(await handleScan({ body, headers: {} }, { OPENAI_API_KEY: "o" }, vi.fn().mockRejectedValue(new Error("boom")))).toMatchObject({ status: 502, body: { error: { code: "upstream" } } });
  });
});
