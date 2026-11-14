import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { VisionError, buildPrompt, extractJson } from "../src/vision/prompt.ts";

/**
 * Dev/preview-server-only proxy for POST /api/scan-chart. It exists so the browser never calls a vision provider
 * directly (no CORS, and keys can live in .env.local). It is NOT part of the static build: production deploys fall
 * back to the browser-direct provider with a user-supplied key (CLAUDE.md rule 6). Keys are never logged or echoed.
 */

export type ProviderId = "gemini" | "anthropic" | "openai";
export const PROVIDERS: readonly ProviderId[] = ["gemini", "anthropic", "openai"];

const ENV_KEYS: Record<ProviderId, string> = { gemini: "GEMINI_API_KEY", anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" };
const DEFAULT_MODELS: Record<ProviderId, string> = { gemini: "gemini-flash-latest", anthropic: "claude-sonnet-5-5", openai: "gpt-4o" };
const MODEL_ENV: Record<ProviderId, string> = { gemini: "GEMINI_MODEL", anthropic: "ANTHROPIC_MODEL", openai: "OPENAI_MODEL" };

// Two images now travel in one request (the screenshot and its 2x plot crop).
export const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

export type ErrorCode = "no_key" | "bad_key" | "bad_request" | "rate_limited" | "upstream" | "bad_json" | "unsupported";
export interface ProxyResult {
  status: number;
  body: unknown;
}

const fail = (status: number, code: ErrorCode, message: string): ProxyResult => ({ status, body: { error: { code, message } } });

type Env = Record<string, string | undefined>;
const isProvider = (v: string | undefined): v is ProviderId => PROVIDERS.includes(v as ProviderId);

/** Provider keys in .env.local win (Gemini > Anthropic > OpenAI); the in-app key prompt is only the fallback. */
export function resolveCredentials(env: Env, headers: Env): { provider: ProviderId; key: string } | null {
  for (const p of PROVIDERS) {
    const key = env[ENV_KEYS[p]]?.trim();
    if (key) return { provider: p, key };
  }
  const key = headers["x-api-key"]?.trim();
  if (!key) return null;
  const asked = headers["x-provider"]?.trim().toLowerCase();
  return { provider: isProvider(asked) ? asked : "anthropic", key };
}

export function configuredProvider(env: Env): ProviderId | null {
  return PROVIDERS.find((p) => env[ENV_KEYS[p]]?.trim()) ?? null;
}

type Call = { image: string; /** Optional Image 2 (the plot crop, always PNG). */ plotImage?: string; mime: string; prompt: string; model: string; /** Gemini only: models to try in priority order. */ models: string[]; key: string; fetchImpl: typeof fetch; signal?: AbortSignal; timeoutMs: number };

/**
 * Gemini models in failover order, fast and high-availability first so a congested primary costs one short timeout, not a
 * long hang. "-latest" aliases track Google's current model. GEMINI_MODEL in .env.local replaces the whole list.
 */
export const GEMINI_MODELS: readonly string[] = ["gemini-flash-latest", "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.6-flash"];

/** Every Gemini attempt (headers + body) is aborted after this long, so a stalled model fails over within seconds. */
export const GEMINI_TIMEOUT_MS = 8000;
/** Anthropic / OpenAI get a little longer, but still inside the browser's 12 s guardrail. */
export const OTHER_TIMEOUT_MS = 11000;

/** Keep the caller's signal (client hit Cancel) and add a deadline. */
const withDeadline = (signal: AbortSignal | undefined, ms: number): AbortSignal => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));

/**
 * All Gemini keys (AIza... and AQ....) are served by generativelanguage.googleapis.com. There is deliberately no second
 * (Vertex) endpoint: it doubled latency on every error and never helps these keys.
 */
const geminiUrl = (model: string): string => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

/** First model that returned 200 for a key, so later scans succeed on the first try. In memory only. */
const geminiModels = new Map<string, string>();
export const cachedGeminiModel = (key: string): string | undefined => geminiModels.get(key);
export const resetGeminiRoutes = (): void => geminiModels.clear();

/** Pull Google's `error.message` out of an error body (falls back to a short raw snippet). Never contains the key. */
export function upstreamMessage(text: string): string {
  try {
    const m = (JSON.parse(text) as { error?: { message?: unknown } }).error?.message;
    if (typeof m === "string" && m) return m.slice(0, 500);
  } catch {
    // not JSON
  }
  return text.trim().slice(0, 200) || "(empty response)";
}

/** Log a failed upstream call to stderr: provider label, HTTP status and the provider's own message. */
async function logFailure(label: string, res: Response): Promise<string> {
  const text = await res.clone().text().catch(() => "");
  console.error(`[scan-chart] ${label} -> HTTP ${res.status}: ${upstreamMessage(text)}`);
  return text;
}

/** Gemini 3.x config: JSON out, medium thinking so it counts every mark and aligns labels. No legacy temperature / thinkingBudget. */
const geminiBody = (c: Call) =>
  JSON.stringify({
    contents: [{ role: "user", parts: [{ inline_data: { mime_type: c.mime, data: c.image } }, ...(c.plotImage ? [{ inline_data: { mime_type: "image/png", data: c.plotImage } }] : []), { text: c.prompt }] }],
    generationConfig: { responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "medium" } },
  });

/**
 * Fast-failover Gemini call. Tries the cached model first, then each model in priority order (one endpoint, header
 * auth), each with a hard deadline. The first 200 is cached; a stale cached model is dropped and the list continues, so
 * deprecated models and transient 429/5xx/timeouts heal without user action. It stops early only when the key itself is
 * invalid (401 or API_KEY_INVALID), because no other model can fix that.
 */
async function callGemini(c: Call): Promise<Response> {
  const cached = geminiModels.get(c.key);
  const order = cached ? [cached, ...c.models.filter((m) => m !== cached)] : c.models;

  let last: Response | null = null;
  for (const model of order) {
    const label = `gemini (${model})`;
    let res: Response;
    try {
      res = await c.fetchImpl(geminiUrl(model), { method: "POST", signal: withDeadline(c.signal, c.timeoutMs), headers: { "content-type": "application/json", "x-goog-api-key": c.key }, body: geminiBody(c) });
    } catch (e) {
      if (c.signal?.aborted) throw e; // the user cancelled; a timeout or network error just moves on to the next model
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      console.error(`[scan-chart] ${label} -> ${timedOut ? `timed out after ${c.timeoutMs} ms` : `network error: ${e instanceof Error ? e.message : "request failed"}`}`);
      if (model === cached) geminiModels.delete(c.key);
      continue;
    }
    if (res.ok) {
      if (cached !== model) console.error(`[scan-chart] gemini model cached: ${model}`);
      geminiModels.set(c.key, model);
      return res;
    }
    const text = await logFailure(label, res);
    last = res;
    if (model === cached) geminiModels.delete(c.key);
    if (res.status === 401 || (res.status === 400 && /API_KEY_INVALID|API key not valid/i.test(text))) return res;
  }
  if (last) return last;
  throw new Error("Couldn't reach Gemini.");
}

const adapters: Record<ProviderId, (c: Call) => Promise<Response>> = {
  gemini: callGemini,
  anthropic: (c) =>
    c.fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: withDeadline(c.signal, c.timeoutMs),
      headers: { "content-type": "application/json", "x-api-key": c.key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: c.model,
        max_tokens: 4096,
        messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: c.mime, data: c.image } }, ...(c.plotImage ? [{ type: "image", source: { type: "base64", media_type: "image/png", data: c.plotImage } }] : []), { type: "text", text: c.prompt }] }],
      }),
    }),
  openai: (c) =>
    c.fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: withDeadline(c.signal, c.timeoutMs),
      headers: { "content-type": "application/json", authorization: `Bearer ${c.key}` },
      body: JSON.stringify({
        model: c.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: [{ type: "text", text: c.prompt }, { type: "image_url", image_url: { url: `data:${c.mime};base64,${c.image}` } }, ...(c.plotImage ? [{ type: "image_url", image_url: { url: `data:image/png;base64,${c.plotImage}` } }] : [])] }],
      }),
    }),
};

function replyText(provider: ProviderId, body: unknown): string {
  const b = body as Record<string, unknown>;
  if (provider === "gemini") {
    const parts = ((b.candidates as { content?: { parts?: { text?: string }[] } }[] | undefined)?.[0]?.content?.parts ?? []) as { text?: string }[];
    return parts.map((p) => p.text ?? "").join("");
  }
  if (provider === "anthropic") return ((b.content as { type: string; text?: string }[] | undefined) ?? []).find((c) => c.type === "text")?.text ?? "";
  return (b.choices as { message?: { content?: string } }[] | undefined)?.[0]?.message?.content ?? "";
}

export interface ScanRequest {
  body: string;
  headers: Env;
}

/** Pure request handler (injected env + fetch), so routing, key precedence and error mapping are unit tested. */
export async function handleScan(req: ScanRequest, env: Env, fetchImpl: typeof fetch = fetch, signal?: AbortSignal, opts: { timeoutMs?: number } = {}): Promise<ProxyResult> {
  const creds = resolveCredentials(env, req.headers);
  if (!creds) return fail(401, "no_key", "No vision API key is configured. Add one to .env.local or enter it in the app.");

  let parsed: { image?: unknown; plotImage?: unknown; mimeType?: unknown; hints?: { width?: unknown; height?: unknown; colors?: unknown; plot?: { width?: unknown; height?: unknown } } };
  try {
    parsed = JSON.parse(req.body);
  } catch {
    return fail(400, "bad_request", "Request body must be JSON.");
  }
  const mime = typeof parsed.mimeType === "string" ? parsed.mimeType : "";
  if (typeof parsed.image !== "string" || parsed.image.length === 0 || !MIME_TYPES.includes(mime)) return fail(400, "bad_request", "Send { image: base64, mimeType: png|jpeg|webp }.");
  const h = parsed.hints ?? {};
  const plotImage = typeof parsed.plotImage === "string" && parsed.plotImage.length > 0 ? parsed.plotImage : undefined;
  const prompt = buildPrompt({
    width: Number(h.width) || 0,
    height: Number(h.height) || 0,
    colors: Array.isArray(h.colors) ? h.colors.filter((c): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)).slice(0, 8) : [],
    plot: plotImage && Number(h.plot?.width) > 0 && Number(h.plot?.height) > 0 ? { width: Number(h.plot!.width), height: Number(h.plot!.height) } : undefined,
  });

  const pinned = env[MODEL_ENV[creds.provider]]?.trim();
  let res: Response;
  try {
    res = await adapters[creds.provider]({ image: parsed.image, plotImage, mime, prompt, model: pinned || DEFAULT_MODELS[creds.provider], models: pinned ? [pinned] : [...GEMINI_MODELS], key: creds.key, fetchImpl, signal, timeoutMs: opts.timeoutMs ?? (creds.provider === "gemini" ? GEMINI_TIMEOUT_MS : OTHER_TIMEOUT_MS) });
  } catch {
    return fail(502, "upstream", "Couldn't reach the vision provider.");
  }
  if (!res.ok && creds.provider !== "gemini") await logFailure(creds.provider, res); // Gemini attempts are logged in callGemini
  if (res.status === 400 && creds.provider === "gemini") {
    // Gemini reports an invalid key as 400 INVALID_ARGUMENT with an API_KEY_INVALID reason.
    const t = await res.text().catch(() => "");
    return /API_KEY_INVALID|API key not valid/i.test(t) ? fail(401, "bad_key", "The API key was rejected.") : fail(502, "upstream", "The vision provider returned an error (400).");
  }
  if (res.status === 401 || res.status === 403) return fail(401, "bad_key", "The API key was rejected.");
  if (res.status === 429) return fail(429, "rate_limited", "Rate limited by the vision provider. Try again in a moment.");
  if (!res.ok) return fail(502, "upstream", `The vision provider returned an error (${res.status}).`);

  try {
    const extraction = extractJson(replyText(creds.provider, await res.json()));
    return { status: 200, body: { provider: creds.provider, extraction } };
  } catch (e) {
    return fail(502, "bad_json", e instanceof VisionError ? e.message : "The provider's reply couldn't be read.");
  }
}

// ---------------------------------------------------------------------------------------------
// POST /api/refine-chart: closed-loop "render & critique" pass
// ---------------------------------------------------------------------------------------------

/** Fast and cheap on purpose: this is a polish pass, so it never gets a model cascade or a long wait. */
export const REFINE_MODEL = "gemini-flash-latest";
export const REFINE_TIMEOUT_MS = 8000;

export const REFINE_PROMPT =
  "Compare the Original Chart (Image 1) against the Recreated Chart (Image 2). Identify any discrepancies in missing/extra bars or slices, bar heights/proportions, colors, chart type, title/subtitle/source text, axis/gridline visibility, legend placement, or label formatting. Return a minimal JSON patch to fix every visual or data discrepancy.";

/** What the patch may touch. The client enforces this too (src/ingest/refinePatch.ts); the prompt just keeps the model inside it. */
const REFINE_RULES = `Reply with ONE JSON object and nothing else: {"patch":[ ...RFC 6902 operations... ],"notes":""}. Use an empty patch when the recreation already matches.
Operations: "replace" (and "add"/"remove" only for /data/series/0/pointColorOverrides/<index>). Allowed paths:
/title, /subtitle, /sourceFooter, /canvas/background, /canvas/textColor, /canvas/titleAlign ("left"|"center"), /canvas/titleScale (0.6..1.6),
/geometry/type ("bar","horizontal-bar","stacked-bar","line","area","pie","donut"), /geometry/barRadius ([tl,tr,br,bl] px), /geometry/barGapRatio (0..0.9), /geometry/strokeWidth, /geometry/curveTension, /geometry/donutInnerRatio, /geometry/showGridlines, /geometry/showDataLabels, /geometry/showXAxis, /geometry/showYAxis, /geometry/dataLabelPosition, /geometry/legendPosition ("top"|"bottom"|"hidden"), /geometry/showMarkers, /geometry/groupSmallSlicesBelowPct,
/data/unitPrefix, /data/unitSuffix, /data/labels/<i>, /data/series/<s>/name, /data/series/<s>/color, /data/series/<s>/values/<i> (number or null), /data/series/0/pointColorOverrides/<i>.
Colors are "#RRGGBB". Do not add or remove rows or series. Change only what is visibly wrong. Image 1 is the Original Chart, Image 2 the Recreated Chart.`;

export interface RefineRequest {
  body: string;
  headers: Env;
}

/** Pull a patch array out of the model's reply, dropping anything that isn't shaped like an operation. */
export function extractPatch(text: string): unknown[] {
  const obj = extractJson(text) as { patch?: unknown } | null;
  const patch = Array.isArray(obj?.patch) ? obj!.patch : [];
  return patch.filter((op): op is Record<string, unknown> => typeof op === "object" && op !== null && typeof (op as { op?: unknown }).op === "string" && typeof (op as { path?: unknown }).path === "string").slice(0, 60);
}

/** Gemini only: one fast attempt, hard 8 s deadline, no cascade. Anything else answers "unsupported" and the client skips the pass. */
export async function handleRefine(req: RefineRequest, env: Env, fetchImpl: typeof fetch = fetch, signal?: AbortSignal, opts: { timeoutMs?: number } = {}): Promise<ProxyResult> {
  const creds = resolveCredentials(env, req.headers);
  if (!creds) return fail(401, "no_key", "No vision API key is configured.");
  if (creds.provider !== "gemini") return fail(400, "unsupported", "Refinement needs a Gemini key.");
  let parsed: { original?: unknown; recreated?: unknown; doc?: unknown };
  try {
    parsed = JSON.parse(req.body);
  } catch {
    return fail(400, "bad_request", "Request body must be JSON.");
  }
  if (typeof parsed.original !== "string" || typeof parsed.recreated !== "string" || !parsed.original || !parsed.recreated || typeof parsed.doc !== "object" || parsed.doc === null) {
    return fail(400, "bad_request", "Send { original: base64 png, recreated: base64 png, doc }.");
  }
  const prompt = `${REFINE_PROMPT}\n${REFINE_RULES}\nCurrent ChartDocument (JSON):\n${JSON.stringify(parsed.doc)}`;
  let res: Response;
  try {
    res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL?.trim() || REFINE_MODEL)}:generateContent`, {
      method: "POST",
      signal: withDeadline(signal, opts.timeoutMs ?? REFINE_TIMEOUT_MS),
      headers: { "content-type": "application/json", "x-goog-api-key": creds.key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ inline_data: { mime_type: "image/png", data: parsed.original } }, { inline_data: { mime_type: "image/png", data: parsed.recreated } }, { text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "low" } },
      }),
    });
  } catch {
    return fail(502, "upstream", "The refinement pass timed out or couldn't connect.");
  }
  if (!res.ok) {
    await logFailure("gemini refine", res);
    return res.status === 401 ? fail(401, "bad_key", "The API key was rejected.") : res.status === 429 ? fail(429, "rate_limited", "Rate limited.") : fail(502, "upstream", `The refinement pass returned an error (${res.status}).`);
  }
  try {
    return { status: 200, body: { patch: extractPatch(replyText("gemini", await res.json())) } };
  } catch (e) {
    return fail(502, "bad_json", e instanceof VisionError ? e.message : "The refinement reply couldn't be read.");
  }
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

export function scanChartProxy(env: Env): Plugin {
  type Server = { middlewares: { use: (path: string, fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } };
  const install = (server: Server) => {
    server.middlewares.use("/api/scan-chart", (req, res, next) => {
      const path = (req.url ?? "/").split("?")[0];
      if (req.method === "GET" && path === "/status") return send(res, 200, { configured: configuredProvider(env) });
      if (req.method !== "POST" || (path !== "/" && path !== "")) return next();
      const abort = new AbortController();
      // Client hit Cancel (or closed the tab): stop the upstream request too.
      res.on("close", () => {
        if (!res.writableEnded) abort.abort();
      });
      void (async () => {
        const body = await readBody(req);
        if (body === null) return send(res, 413, { error: { code: "bad_request", message: "Image is too large." } });
        const r = await handleScan({ body, headers: { "x-api-key": first(req.headers["x-api-key"]), "x-provider": first(req.headers["x-provider"]) } }, env, fetch, abort.signal);
        if (!abort.signal.aborted) send(res, r.status, r.body);
      })();
    });
  };
  const installRefine = (server: Server) => {
    server.middlewares.use("/api/refine-chart", (req, res, next) => {
      const path = (req.url ?? "/").split("?")[0];
      if (req.method !== "POST" || (path !== "/" && path !== "")) return next();
      const abort = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) abort.abort();
      });
      void (async () => {
        const body = await readBody(req);
        if (body === null) return send(res, 413, { error: { code: "bad_request", message: "Images are too large." } });
        const r = await handleRefine({ body, headers: { "x-api-key": first(req.headers["x-api-key"]), "x-provider": first(req.headers["x-provider"]) } }, env, fetch, abort.signal);
        if (!abort.signal.aborted) send(res, r.status, r.body);
      })();
    });
  };
  const both = (server: Server) => (install(server), installRefine(server));
  return { name: "readychart-scan-chart", configureServer: both, configurePreviewServer: both };
}

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
