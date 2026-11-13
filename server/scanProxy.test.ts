import { describe, expect, it, vi } from "vitest";
import { GEMINI_MODELS, cachedGeminiRoute, configuredProvider, handleScan, resetGeminiRoutes, resolveCredentials } from "./scanProxy.ts";

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
  describe("Gemini self-healing cascade", () => {
    const ok = () => json({ candidates: [{ content: { parts: [{ text: JSON.stringify(REPLY) }] } }] });
    const err = (status: number, message = "boom") => json({ error: { code: status, message } }, status);
    const KEY = "AQ.abc123";
    const run = (f: ReturnType<typeof vi.fn>, env: Record<string, string> = { GEMINI_API_KEY: KEY }) => handleScan({ body, headers: {} }, env, f as unknown as typeof fetch);
    const url = (f: ReturnType<typeof vi.fn>, i: number) => String(f.mock.calls[i]![0]);
    const init = (f: ReturnType<typeof vi.fn>, i: number) => f.mock.calls[i]![1] as RequestInit;
    const AI = (m: string) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
    const VX = (m: string) => `https://aiplatform.googleapis.com/v1/publishers/google/models/${m}:generateContent`;
    const quiet = () => {
      resetGeminiRoutes();
      return vi.spyOn(console, "error").mockImplementation(() => {});
    };

    it("uses the evergreen priority list by default", () => {
      expect([...GEMINI_MODELS]).toEqual(["gemini-flash-latest", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-flash-lite-latest"]);
    });
    it("sends clean Gemini 3.x config with the header on both endpoints, never a key in the URL", async () => {
      const e = quiet();
      const f = vi.fn().mockResolvedValueOnce(err(403)).mockResolvedValueOnce(ok());
      await run(f);
      expect(url(f, 0)).toBe(AI("gemini-flash-latest"));
      expect(url(f, 1)).toBe(VX("gemini-flash-latest"));
      for (const i of [0, 1]) {
        expect(init(f, i).headers).toMatchObject({ "x-goog-api-key": KEY });
        expect(url(f, i)).not.toContain(KEY);
        const cfg = JSON.parse(String(init(f, i).body)).generationConfig;
        expect(cfg).toEqual({ responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "low" } });
      }
      e.mockRestore();
    });
    it("walks endpoints then models until one returns 200, and caches that route", async () => {
      const e = quiet();
      const f = vi.fn().mockImplementation(async (u: string) => (u === VX("gemini-3.6-flash") ? ok() : err(404, "model not found")));
      expect(await run(f)).toEqual({ status: 200, body: { provider: "gemini", extraction: REPLY } });
      expect(f.mock.calls.map((c) => String(c[0]))).toEqual([AI("gemini-flash-latest"), VX("gemini-flash-latest"), AI("gemini-3.8-flash"), VX("gemini-3.8-flash"), AI("gemini-3.6-flash"), VX("gemini-3.6-flash")]);
      expect(cachedGeminiRoute(KEY)).toEqual({ endpoint: "vertex", model: "gemini-3.6-flash" });
      e.mockRestore();
    });
    it("the cached route makes the next scan succeed on the first try", async () => {
      const e = quiet();
      await run(vi.fn().mockImplementation(async (u: string) => (u === VX("gemini-3.6-flash") ? ok() : err(404))));
      const f = vi.fn().mockResolvedValue(ok());
      expect((await run(f)).status).toBe(200);
      expect(f).toHaveBeenCalledTimes(1);
      expect(url(f, 0)).toBe(VX("gemini-3.6-flash"));
      e.mockRestore();
    });
    it("heals a stale cached route by dropping it and re-running the cascade", async () => {
      const e = quiet();
      await run(vi.fn().mockResolvedValue(ok())); // caches AI Studio + flash-latest
      const f = vi.fn().mockImplementation(async (u: string) => (u === AI("gemini-flash-latest") ? err(404, "deprecated") : u === AI("gemini-3.8-flash") ? ok() : err(404)));
      expect((await run(f)).status).toBe(200);
      expect(cachedGeminiRoute(KEY)).toEqual({ endpoint: "studio", model: "gemini-3.8-flash" });
      e.mockRestore();
    });
    it("rides out transient 429, 5xx and network errors", async () => {
      const e = quiet();
      const f = vi.fn().mockResolvedValueOnce(err(429)).mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(err(503)).mockResolvedValueOnce(ok());
      expect((await run(f)).status).toBe(200);
      expect(f).toHaveBeenCalledTimes(4);
      e.mockRestore();
    });
    it("GEMINI_MODEL pins a single model and replaces the list", async () => {
      const e = quiet();
      const f = vi.fn().mockResolvedValue(err(404));
      await run(f, { GEMINI_API_KEY: KEY, GEMINI_MODEL: "my-model" });
      expect(f.mock.calls.map((c) => String(c[0]))).toEqual([AI("my-model"), VX("my-model")]);
      e.mockRestore();
    });
    it("stops early when the key itself is bad (401 on both endpoints, or API_KEY_INVALID)", async () => {
      const e = quiet();
      const f = vi.fn().mockResolvedValue(err(401));
      expect(await run(f)).toMatchObject({ status: 401, body: { error: { code: "bad_key" } } });
      expect(f).toHaveBeenCalledTimes(2);
      resetGeminiRoutes();
      const g = vi.fn().mockResolvedValue(json({ error: { message: "API key not valid. Please pass a valid API key." } }, 400));
      expect(await run(g)).toMatchObject({ status: 401, body: { error: { code: "bad_key" } } });
      expect(g).toHaveBeenCalledTimes(1);
      e.mockRestore();
    });
    it("reports upstream/rate_limited only after every route failed", async () => {
      const e = quiet();
      const f = vi.fn().mockResolvedValue(err(429));
      expect(await run(f)).toMatchObject({ status: 429, body: { error: { code: "rate_limited" } } });
      expect(f).toHaveBeenCalledTimes(GEMINI_MODELS.length * 2);
      resetGeminiRoutes();
      expect(await run(vi.fn().mockRejectedValue(new TypeError("offline")))).toMatchObject({ status: 502, body: { error: { code: "upstream" } } });
      e.mockRestore();
    });
    it("logs each failed attempt's status and Google message to stderr, never the key", async () => {
      const e = quiet();
      await run(vi.fn().mockResolvedValueOnce(err(404, "models/gemini-flash-latest is not found")).mockResolvedValueOnce(ok()));
      const lines = e.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes("AI Studio") && l.includes("gemini-flash-latest") && l.includes("HTTP 404") && l.includes("is not found"))).toBe(true);
      expect(lines.some((l) => l.includes("route cached") && l.includes("Vertex AI Express"))).toBe(true);
      expect(lines.join("\n")).not.toContain(KEY);
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
