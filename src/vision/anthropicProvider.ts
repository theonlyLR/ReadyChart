import type { VisionProvider } from "./VisionProvider";

export const DEFAULT_VISION_MODEL = "claude-sonnet-5-5";
const ENDPOINT = "https://api.anthropic.com/v1/messages";

export class VisionError extends Error {}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function buildPrompt(hints: { width: number; height: number; colors: string[] }): string {
  return `You are reading a chart screenshot (${hints.width}x${hints.height} px). Reply with ONE JSON object and nothing else.
Rules:
- Only report what is visible. NEVER invent categories or values. If a value is not printed on the chart, set it to null and give "topsPx" instead.
- "valueSource" is "printed" when every value in the series is read from a label on the chart, otherwise "estimated".
- "confidence" is 0..1 per series.
- Pixel coordinates are y positions in this image (0 at the top).
- If the value axis has tick labels, give "axis": baselinePx (y of the baseline), baselineValue (usually 0), topTickPx (y of the highest labelled tick) and topTickValue.
- Dominant series colours measured in this image: ${hints.colors.join(", ") || "none"}. Use one of them as each series' "color" when it matches.
Schema:
{"chartType":"bar|horizontal-bar|stacked-bar|line|area|pie|donut","title":"","subtitle":"","labels":["..."],
 "units":{"prefix":"$","suffix":"M"},
 "series":[{"name":"","color":"#RRGGBB","values":[number|null],"valueSource":"printed|estimated","confidence":0.9,"topsPx":[number|null]}],
 "axis":{"baselinePx":0,"baselineValue":0,"topTickPx":0,"topTickValue":0}}`;
}

/** Pull the first balanced JSON object out of a model reply (tolerates ```json fences and chatter). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new VisionError("The model didn't return JSON.");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new VisionError("The model's JSON was malformed.");
  }
}

/**
 * Calls the Anthropic Messages API straight from the browser with the user's own key (no server; CLAUDE.md rule 6).
 * The image and key go only to api.anthropic.com, and only when the user clicks Extract.
 */
export function createAnthropicProvider(apiKey: string, model: string = DEFAULT_VISION_MODEL, fetchImpl: typeof fetch = (...a) => fetch(...a)): VisionProvider {
  return {
    name: "Anthropic",
    async extractChart(image, hints) {
      const data = await blobToBase64(image);
      let res: Response;
      try {
        res = await fetchImpl(ENDPOINT, {
          method: "POST",
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
                  { type: "text", text: buildPrompt(hints) },
                ],
              },
            ],
          }),
        });
      } catch {
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
