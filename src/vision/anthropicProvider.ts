import type { VisionProvider } from "./VisionProvider";
import { VisionError, buildPrompt, extractJson } from "./prompt";

export { VisionError, buildPrompt, extractJson };

export const DEFAULT_VISION_MODEL = "claude-sonnet-5-5";
const ENDPOINT = "https://api.anthropic.com/v1/messages";

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Calls the Anthropic Messages API straight from the browser with the user's own key. This is the fallback for
 * static builds, where the dev-server proxy (/api/scan-chart) doesn't exist (CLAUDE.md rule 6: no deployed backend).
 */
export function createAnthropicProvider(apiKey: string, model: string = DEFAULT_VISION_MODEL, fetchImpl: typeof fetch = (...a) => fetch(...a)): VisionProvider {
  return {
    name: "Anthropic",
    usesPlotImage: true,
    async extractChart(image, hints, signal) {
      const data = await blobToBase64(image);
      const plot = hints.plot ? { data: await blobToBase64(hints.plot.image), width: hints.plot.width, height: hints.plot.height } : null;
      let res: Response;
      try {
        res = await fetchImpl(ENDPOINT, {
          method: "POST",
          signal,
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model,
            max_tokens: 4096,
            messages: [
              {
                role: "user",
                content: [
                  { type: "image", source: { type: "base64", media_type: image.type || "image/png", data } },
                  ...(plot ? [{ type: "image", source: { type: "base64", media_type: "image/png", data: plot.data } }] : []),
                  { type: "text", text: buildPrompt({ width: hints.width, height: hints.height, colors: hints.colors, plot: plot ? { width: plot.width, height: plot.height } : undefined }) },
                ],
              },
            ],
          }),
        });
      } catch (e) {
        if (signal?.aborted) throw e;
        throw new VisionError("Couldn't reach the vision service. Check your connection.");
      }
      if (res.status === 401 || res.status === 403) throw new VisionError("The API key was rejected. Check it in Vision settings.");
      if (res.status === 429) throw new VisionError("Rate limited by the vision service. Try again in a moment.");
      if (!res.ok) throw new VisionError(`The vision service returned an error (${res.status}).`);
      const body = (await res.json()) as { content?: { type: string; text?: string }[] };
      const text = body.content?.find((c) => c.type === "text")?.text ?? "";
      return extractJson(text);
    },
  };
}
