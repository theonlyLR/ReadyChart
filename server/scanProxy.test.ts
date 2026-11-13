import { describe, expect, it, vi } from "vitest";
import { configuredProvider, handleScan, resolveCredentials } from "./scanProxy.ts";

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
    const f = vi.fn().mockResolvedValue(json({ candidates: [{ content: { parts: [{ text: JSON.stringify(REPLY) }] } }] }));
    const r = await handleScan({ body, headers: {} }, { GEMINI_API_KEY: "g-secret" }, f);
    expect(r).toEqual({ status: 200, body: { provider: "gemini", extraction: REPLY } });
    expect(String(f.mock.calls[0]![0])).toContain("generativelanguage.googleapis.com");
    expect((f.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ "x-goog-api-key": "g-secret" });
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
    const res = new Response(JSON.stringify({ error: { message: "API key not valid", details: [{ reason: "API_KEY_INVALID" }] } }), { status: 400 });
    expect(await handleScan({ body, headers: {} }, { GEMINI_API_KEY: "x" }, vi.fn().mockResolvedValue(res))).toMatchObject({ status: 401, body: { error: { code: "bad_key" } } });
  });
  it("reports a network failure as upstream", async () => {
    expect(await handleScan({ body, headers: {} }, { OPENAI_API_KEY: "o" }, vi.fn().mockRejectedValue(new Error("boom")))).toMatchObject({ status: 502, body: { error: { code: "upstream" } } });
  });
});
