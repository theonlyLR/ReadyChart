import type { LayoutResult, TextBlock } from "./layout";
import type { Rect } from "./types";

export type TextField = "title" | "subtitle" | "sourceFooter";

export interface TextTarget {
  field: TextField;
  /** Box covering the rendered lines, in document pixels. */
  rect: Rect;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  /** Which theme colour the scene uses for this text. */
  tone: "ink" | "muted";
}

/** Inverse of the layout's baseline(): the first line's baseline sits at top + lineHeight/2 + fontSize*0.35. */
const blockTop = (b: TextBlock): number => b.y - b.lineHeight / 2 - b.fontSize * 0.35;

/**
 * Pure: the on-canvas hit boxes for inline editing, derived from the same layout the renderer uses so the
 * overlay can't drift from the drawn text. Empty fields have no lines, hence no target (edit them in the Inspector).
 */
export function textTargets(L: LayoutResult): TextTarget[] {
  const out: TextTarget[] = [];
  const add = (field: TextField, b: TextBlock, width: number, tone: TextTarget["tone"]) => {
    if (b.lines.length === 0) return;
    out.push({
      field,
      rect: { x: b.x, y: blockTop(b), width, height: b.lines.length * b.lineHeight },
      fontSize: b.fontSize,
      fontWeight: b.fontWeight,
      lineHeight: b.lineHeight,
      tone,
    });
  };
  add("title", L.title, L.regions.text.width, "ink");
  add("subtitle", L.subtitle, L.regions.text.width, "muted");
  add("sourceFooter", L.footer, L.regions.footer.width, "muted");
  return out;
}
