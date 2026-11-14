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
}

export function buildPrompt(hints: PromptHints): string {
  return `You are reading a chart screenshot (${hints.width}x${hints.height} px). It may include browser tabs, toolbars or page chrome around the chart. Count every data point carefully and align multi-line labels with their marks BEFORE answering. Reply with ONE JSON object and nothing else.
Rules:
- GEOMETRY FIRST for "chartType": if you can see rectangular columns or bars, ALWAYS answer "bar" (vertical) or "horizontal-bar" (or "stacked-bar"), NEVER "pie" or "donut", even when the values are percentages that sum to 100. Answer "pie"/"donut" only for circular charts made of wedges, "line"/"area" only for lines/filled areas.
- Only report what is visible. NEVER invent categories or values. If a value is not printed on the chart, or is unreadable, set it to null; the app measures it from "elementBounds" (except tiny slivers, below).
- "elementBounds": one bounding box for EVERY visible bar, column or slice, in strict left-to-right order (top-to-bottom for horizontal bars, clockwise from 12 o'clock for pie/donut), as [ymin, xmin, ymax, xmax], each an integer 0..1000 of the FULL image. Include tiny 1-2 px slivers and bars with no readable text. Tight boxes: a bar's box is exactly the filled rectangle.
- STRICT LENGTHS: "labels", every series' "values" and "elementBounds" must all have exactly the same number of entries, one per visible mark. Never skip a mark; use null for an unreadable value.
- "axisScale" (when the chart relies on a value axis instead of printed bar labels): "zeroBaselineCoord" = position of the zero baseline along the value axis, "topTickCoord" = position of the highest labelled tick, "topTickValue" = that tick's value. Coordinates are integers 0..1000 of the FULL image: y for vertical bars/lines, x for horizontal bars. Use null for any you cannot read.
- "valueSource" is "printed" when every value in the series is read from a label on the chart, otherwise "estimated".
- "confidence" is 0..1 per series; "confidences" (optional) is 0..1 per value.
- Tiny slivers: a bar or slice that is VISIBLE but too small or cramped to read (for example a 1% bar at the end of a percentage series) must never be null. If the other values in the series sum close to 100 (within about 3), estimate the missing value as the remainder (100 minus the others), or from its visible size, and mark it true in the series' "estimated" array (one boolean per value) with a low value in "confidences" (0.5 or less). Do this only for marks you can see; never invent categories.
- "chartBounds" is the bounding box of the chart area ALONE with browser/page chrome excluded, as [ymin, xmin, ymax, xmax], each an integer 0..1000 of the full image. It is only used to crop the comparison overlay, so it may hug the bars and axes tightly.
- TEXT FROM THE FULL IMAGE: read "title", "subtitle" and "sourceNote" from anywhere in the full screenshot, including text that lies OUTSIDE chartBounds (a heading above the plot, a footnote below it). Never leave them empty just because they fall outside the crop box.
- "samplePoints" are [x, y] coordinates, each an integer 0..1000 of the FULL image (note x first). Pick spots that are flat colour, away from text and edges:
  "background": one empty spot of the page/chart background;
  "series": one point inside each series' fill or line, in series order;
  "bars": for a single-series bar or horizontal-bar chart only, one point inside EVERY bar, in label order.
- "style": showXAxis = category labels are visible; showYAxis = value-axis tick labels are visible (both for horizontal bars too: X = category labels, Y = value ticks); showGridlines; showDataLabels = values are printed on the marks; dataLabelPosition is "outside-top" (past the bar end), "inside-top" (inside, at the end) or "inside-bottom" (inside, at the base); textColor = hex of the main text colour.
- "sourceNote" is the footnote such as "Source: ..." if any, else "".
- "units": prefix like "$", suffix like "%" or "M".
- Dominant series colours measured in this image: ${hints.colors.join(", ") || "none"}.
Schema:
{"chartType":"bar|horizontal-bar|stacked-bar|line|area|pie|donut","title":"","subtitle":"","sourceNote":"","labels":["..."],
 "units":{"prefix":"","suffix":""},
 "series":[{"name":"","color":"#RRGGBB","values":[number|null],"valueSource":"printed|estimated","confidence":0.9,"confidences":[0.9],"estimated":[false]}],
 "elementBounds":[[ymin,xmin,ymax,xmax]],
 "axisScale":{"zeroBaselineCoord":null,"topTickCoord":null,"topTickValue":null},
 "chartBounds":[0,0,1000,1000],
 "samplePoints":{"background":[10,10],"series":[[500,500]],"bars":[[500,500]]},
 "style":{"showXAxis":true,"showYAxis":true,"showGridlines":true,"showDataLabels":true,"dataLabelPosition":"outside-top","textColor":"#111827"}}`;
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
