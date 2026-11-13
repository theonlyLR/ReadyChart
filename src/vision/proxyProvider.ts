import type { VisionProvider } from "./VisionProvider";
import { blobToBase64 } from "./anthropicProvider";
import { VisionError } from "./prompt";

export const SCAN_ENDPOINT = "/api/scan-chart";

export interface ProxyAuth {
  /** Optional key + provider from the in-app prompt; the server prefers keys from .env.local. */
  apiKey?: string;
  provider?: string;
}

/** Is the dev-server proxy there, and does it already hold a key (.env.local)? Static builds answer { available: false }. */
export async function probeProxy(fetchImpl: typeof fetch = (...a) => fetch(...a), signal?: AbortSignal): Promise<{ available: boolean; configured: string | null }> {
  try {
    const res = await fetchImpl(`${SCAN_ENDPOINT}/status`, { signal });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return { available: false, configured: null };
    const body = (await res.json()) as { configured?: unknown };
    return { available: true, configured: typeof body.configured === "string" ? body.configured : null };
  } catch {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return { available: false, configured: null };
  }
}

/** Talks to POST /api/scan-chart, so the browser never calls a vision vendor directly (no CORS). */
export function createProxyProvider(auth: () => ProxyAuth, fetchImpl: typeof fetch = (...a) => fetch(...a)): VisionProvider {
  return {
    name: "Server proxy",
    async extractChart(image, hints, signal) {
      const { apiKey, provider } = auth();
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (apiKey) headers["x-api-key"] = apiKey;
      if (apiKey && provider) headers["x-provider"] = provider;
      let res: Response;
      try {
        res = await fetchImpl(SCAN_ENDPOINT, {
          method: "POST",
          signal,
          headers,
          body: JSON.stringify({ image: await blobToBase64(image), mimeType: image.type || "image/png", hints }),
        });
      } catch (e) {
        if (signal?.aborted) throw e;
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
