import type { VisionProvider } from "./VisionProvider";
import { blobToBase64 } from "./anthropicProvider";
import { VisionError } from "./prompt";

export const SCAN_ENDPOINT = "/api/scan-chart";
/** The cloud scan gets this long, then the on-device scan takes over. */
export const SCAN_TIMEOUT_MS = 12_000;
/** The "is there a proxy?" probe is a tiny local request; don't let it stall the scan either. */
export const PROBE_TIMEOUT_MS = 3_000;

/** The caller's signal (user Cancel) plus a deadline. A deadline hit is reported as a plain error, not an abort. */
const withDeadline = (signal: AbortSignal | undefined, ms: number): AbortSignal => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));

export interface ProxyAuth {
  /** Optional key + provider from the in-app prompt; the server prefers keys from .env.local. */
  apiKey?: string;
  provider?: string;
}

/** Is the dev-server proxy there, and does it already hold a key (.env.local)? Static builds answer { available: false }. */
export async function probeProxy(fetchImpl: typeof fetch = (...a) => fetch(...a), signal?: AbortSignal): Promise<{ available: boolean; configured: string | null }> {
  try {
    const res = await fetchImpl(`${SCAN_ENDPOINT}/status`, { signal: withDeadline(signal, PROBE_TIMEOUT_MS) });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return { available: false, configured: null };
    const body = (await res.json()) as { configured?: unknown };
    return { available: true, configured: typeof body.configured === "string" ? body.configured : null };
  } catch {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return { available: false, configured: null };
  }
}

/** Talks to POST /api/scan-chart, so the browser never calls a vision vendor directly (no CORS). */
export function createProxyProvider(auth: () => ProxyAuth, fetchImpl: typeof fetch = (...a) => fetch(...a), timeoutMs: number = SCAN_TIMEOUT_MS): VisionProvider {
  return {
    name: "Server proxy",
    usesPlotImage: true,
    async extractChart(image, hints, signal) {
      const { apiKey, provider } = auth();
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (apiKey) headers["x-api-key"] = apiKey;
      if (apiKey && provider) headers["x-provider"] = provider;
      let res: Response;
      try {
        res = await fetchImpl(SCAN_ENDPOINT, {
          method: "POST",
          // Covers connecting, the wait for Gemini and reading the reply: past this the on-device scan takes over.
          signal: withDeadline(signal, timeoutMs),
          headers,
          body: JSON.stringify({
            image: await blobToBase64(image),
            mimeType: image.type || "image/png",
            plotImage: hints.plot ? await blobToBase64(hints.plot.image) : undefined,
            hints: { width: hints.width, height: hints.height, colors: hints.colors, plot: hints.plot ? { width: hints.plot.width, height: hints.plot.height } : undefined },
          }),
        });
      } catch (e) {
        if (signal?.aborted) throw e; // the user's Cancel
        if (e instanceof Error && e.name === "TimeoutError") throw new VisionError("The scan service took too long to answer.", "timeout");
        throw new VisionError("Couldn't reach the scan service. Is the dev server running?", "network");
      }
      type Reply = { extraction?: unknown; error?: { code?: string; message?: string } };
      const body: Reply | null = await res.json().then(
        (j: Reply) => j,
        () => null, // not JSON (e.g. an HTML error page)
      );
      if (!res.ok || !body || body.extraction === undefined) {
        throw new VisionError(body?.error?.message ?? `The scan service returned an error (${res.status}).`, body?.error?.code ?? "upstream");
      }
      return body.extraction;
    },
  };
}
