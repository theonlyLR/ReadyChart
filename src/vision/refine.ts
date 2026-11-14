import { blobToBase64 } from "./anthropicProvider";

export const REFINE_ENDPOINT = "/api/refine-chart";
/** Client guardrail around the server's own 8 s limit. */
export const REFINE_CLIENT_TIMEOUT_MS = 10_000;

export interface RefineAuth {
  apiKey?: string;
  provider?: string;
}

/**
 * Ask the critique pass for a patch. Never throws and never blocks the scan for long: a timeout, a missing Gemini key,
 * an offline server or a garbled reply all just mean "no patch" (null).
 */
export async function requestRefinement(
  args: { original: Blob; recreated: Blob; doc: unknown; auth?: RefineAuth; signal?: AbortSignal; timeoutMs?: number },
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<unknown[] | null> {
  const { original, recreated, doc, auth, signal, timeoutMs = REFINE_CLIENT_TIMEOUT_MS } = args;
  const deadline = AbortSignal.timeout(timeoutMs);
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (auth?.apiKey) headers["x-api-key"] = auth.apiKey;
    if (auth?.apiKey && auth.provider) headers["x-provider"] = auth.provider;
    const res = await fetchImpl(REFINE_ENDPOINT, {
      method: "POST",
      headers,
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      body: JSON.stringify({ original: await blobToBase64(original), recreated: await blobToBase64(recreated), doc }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { patch?: unknown };
    return Array.isArray(body.patch) ? body.patch : null;
  } catch (e) {
    if (signal?.aborted) throw e; // the user's Cancel still cancels
    return null;
  }
}
