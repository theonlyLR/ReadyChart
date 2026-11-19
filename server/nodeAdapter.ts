import type { IncomingMessage, ServerResponse } from "node:http";
import { clientIp, handleApi } from "./scanCore.ts";
import type { ApiOptions, Env, Route } from "./scanCore.ts";

/**
 * The one Node http <-> scanCore bridge. The Vite dev/preview middleware and the Vercel Functions in api/ both call
 * runNodeHandler, so request parsing, Cancel handling and response writing exist exactly once.
 */

type AdapterOptions = Omit<ApiOptions, "signal">;

const flatten = (h: IncomingMessage["headers"]): Env => Object.fromEntries(Object.entries(h).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v]));

/** Read the body, giving up (null) the moment it passes `max` bytes. Reuses req.body when the platform already parsed it (Vercel). */
function readBody(req: IncomingMessage, max: number): Promise<{ text: string | null; bytes: number }> {
  const parsed = (req as { body?: unknown }).body;
  if (parsed !== undefined && parsed !== null) {
    const text = typeof parsed === "string" ? parsed : Buffer.isBuffer(parsed) ? parsed.toString("utf8") : JSON.stringify(parsed);
    const bytes = Buffer.byteLength(text);
    return Promise.resolve({ text: bytes > max ? null : text, bytes });
  }
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) {
        resolve({ text: null, bytes: size });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve({ text: Buffer.concat(chunks).toString("utf8"), bytes: size }));
    req.on("error", () => resolve({ text: null, bytes: size }));
  });
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export async function runNodeHandler(route: Route, req: IncomingMessage, res: ServerResponse, env: Env, opts: AdapterOptions): Promise<void> {
  const abort = new AbortController();
  // Client hit Cancel (or closed the tab): stop the upstream request too.
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });
  const headers = flatten(req.headers);
  const method = req.method ?? "GET";
  const { text, bytes } = method === "POST" ? await readBody(req, opts.maxBodyBytes ?? Infinity) : { text: "", bytes: 0 };
  const r = await handleApi(route, { method, headers, body: text, bodyBytes: bytes, ip: clientIp(headers) }, env, { ...opts, signal: abort.signal });
  if (!abort.signal.aborted) send(res, r.status, r.body, r.headers);
}
