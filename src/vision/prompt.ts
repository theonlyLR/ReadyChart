/** Shared by the browser-direct provider and the dev-server proxy. No DOM or Node APIs here. */

export class VisionError extends Error {
  /** Machine-readable cause ("no_key", "bad_key", ...) so the UI can offer the right fix. */
  code: string;
  constructor(message: string, code = "error") {
    super(message);
    this.code = code;
  }
}

export interface PromptHints {
  width: number;
  height: number;
  colors: string[];
  /** Present when a second image (the plot crop) accompanies the screenshot. */
  plot?: { width: number; height: number };
}

export function buildPrompt(hints: PromptHints): string {
  const frame = hints.plot ? "IMAGE 2 (the plot crop)" : "the screenshot";
  const images = hints.plot
    ? `You are given TWO images. IMAGE 1 is the full screenshot (${hints.width}x${hints.height} px): read the title, subtitle, source footer, legend, overall layout, aspect ratio and outer padding from it. IMAGE 2 (${hints.plot.width}x${hints.plot.height} px) is a 2x upscaled, sharpened crop of the chart region: use it to read dense multi-line labels, tiny percentages and 1-2 px slivers, and to measure geometry.
COORDINATE FRAMES: "plotBox", "zeroBaselineY", "yAxisTicks[].coord" and "elements[].bounds" are normalized to IMAGE 2, and you must set "frame":"plot". "chartBounds" and "samplePoints" are normalized to IMAGE 1.`
    : `You are reading a chart screenshot (${hints.width}x${hints.height} px). It may include browser tabs, toolbars or page chrome around the chart. All coordinates are normalized to this image; set "frame":"full".`;
  return `${images}
Extract COORDINATE GEOMETRY FIRST (plotBox, zeroBaselineY, yAxisTicks, elements' bounds), then derive the numbers. Count every data point carefully and align multi-line labels with their marks BEFORE answering. Reply with ONE JSON object and nothing else.
Rules:
- GEOMETRY FIRST for "chartType": if you can see rectangular columns or bars, ALWAYS answer "bar" (vertical) or "horizontal-bar" (or "stacked-bar"), NEVER "pie" or "donut", even when the values are percentages that sum to 100. Answer "pie"/"donut" only for circular charts made of wedges, "line"/"area" only for lines/filled areas.
- Only report what is visible. NEVER invent categories or values.
- "plotBox": the inner coordinate area (the box spanned by the axes) as [ymin, xmin, ymax, xmax], integers 0..1000 of ${frame}.
- "zeroBaselineY": position of the zero baseline along the value axis, integer 0..1000 of ${frame}: its y for vertical bars/lines, its x for horizontal bars. null if there is none.
- "yAxisTicks": every visible value-axis tick as { "value": number, "coord": integer 0..1000 } (coord is y for vertical charts, x for horizontal bars). Empty when the chart has no axis ticks. With two or more ticks the app can compute exact values from pixel distances.
- "elements": ONE entry for EVERY visible mark, in strict left-to-right order (top-to-bottom for horizontal bars, clockwise from 12 o'clock for pie/donut): { "label": category label, "value": number or null, "rawText": the exact text printed on/near the mark or "", "bounds": [ymin, xmin, ymax, xmax] integers 0..1000 of ${frame}, "confidence": 0..1 }. Bars and columns: the tight filled rectangle. Line charts: a small box centred on the vertex. Pie/donut: the wedge's bounding box. Include tiny 1-2 px slivers and marks whose label is unreadable (value null, rawText "").
- STRICT LENGTHS: "labels", every series' "values" and "elements" must all have exactly the same number of entries, one per visible mark. Never skip a mark.
- "valueSource" is "printed" when every value in the series is read from a label on the chart, otherwise "estimated". "confidence" is 0..1 per series; "confidences" (optional) is 0..1 per value.
- Tiny slivers: a bar or slice that is VISIBLE but too small or cramped to read (for example a 1% bar at the end of a percentage series) must never be dropped. Give its bounds; if the other values in the series sum close to 100 (within about 3), also estimate its value as the remainder (100 minus the others) and mark it true in the series' "estimated" array (one boolean per value) with a low value in "confidences" (0.5 or less). Otherwise leave its value null and the app measures it from its bounds.
- "chartBounds" is the bounding box of the chart area ALONE with browser/page chrome excluded, as [ymin, xmin, ymax, xmax], integers 0..1000 of IMAGE 1. It is only used to crop the comparison overlay, so it may hug the bars and axes tightly.
- TEXT FROM THE FULL IMAGE: read "title", "subtitle" and "sourceNote" from anywhere in the full screenshot (IMAGE 1), including text that lies OUTSIDE chartBounds (a heading above the plot, a footnote below it). Never leave them empty just because they fall outside the crop box.
- "samplePoints" are [x, y] coordinates, each an integer 0..1000 of IMAGE 1 (x first). Pick spots that are flat colour, away from text and edges: "background": one empty spot; "series": one point inside each series' fill or line, in series order; "bars": for a single-series bar chart, one point inside EVERY bar, in label order.
- "style": showXAxis = category labels are visible; showYAxis = value-axis tick labels are visible; showGridlines; showDataLabels = values are printed on the marks; dataLabelPosition = "outside-top" (past the bar end), "inside-top" or "inside-bottom"; textColor = hex of the main text colour; titleAlign = "left" or "center"; titleScale = title size relative to a normal title (1 = normal, 1.3 = large, 0.8 = small); legendPosition = "top", "bottom" or "hidden"; showMarkers = point markers visible on a line; strokeWidth = line thickness in px at 1080 px tall (1..16); donutInnerRatio = hole radius / outer radius for a donut (0.2..0.9); barCorners = "sharp" or "rounded".
- "sourceNote" is the footnote such as "Source: ..." if any, else "". "units": prefix like "$", suffix like "%" or "M".
- Dominant series colours measured in the screenshot: ${hints.colors.join(", ") || "none"}.
Schema:
{"frame":"plot|full","chartType":"bar|horizontal-bar|stacked-bar|line|area|pie|donut","title":"","subtitle":"","sourceNote":"","labels":["..."],
 "units":{"prefix":"","suffix":""},
 "plotBox":[ymin,xmin,ymax,xmax],"zeroBaselineY":null,"yAxisTicks":[{"value":0,"coord":0}],
 "elements":[{"label":"","value":null,"rawText":"","bounds":[ymin,xmin,ymax,xmax],"confidence":0.9}],
 "series":[{"name":"","color":"#RRGGBB","values":[number|null],"valueSource":"printed|estimated","confidence":0.9,"confidences":[0.9],"estimated":[false]}],
 "chartBounds":[0,0,1000,1000],
 "samplePoints":{"background":[10,10],"series":[[500,500]],"bars":[[500,500]]},
 "style":{"showXAxis":true,"showYAxis":true,"showGridlines":true,"showDataLabels":true,"dataLabelPosition":"outside-top","textColor":"#111827","titleAlign":"left","titleScale":1,"legendPosition":"top","showMarkers":true,"strokeWidth":4,"donutInnerRatio":0.6,"barCorners":"rounded"}}`;
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
