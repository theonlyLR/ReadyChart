import type { Corners } from "../../model/types";

export const fmt = (n: number): string => String(Math.round(n * 100) / 100);

/** Corner order: [top-left, top-right, bottom-right, bottom-left]. */
export function roundedRectPath(x: number, y: number, w: number, h: number, radii: Corners): string {
  const max = Math.max(0, Math.min(w, h) / 2);
  const [tl, tr, br, bl] = radii.map((r) => Math.min(Math.max(r, 0), max)) as Corners;
  return [
    `M${fmt(x + tl)},${fmt(y)}`,
    `H${fmt(x + w - tr)}`,
    `A${fmt(tr)},${fmt(tr)} 0 0 1 ${fmt(x + w)},${fmt(y + tr)}`,
    `V${fmt(y + h - br)}`,
    `A${fmt(br)},${fmt(br)} 0 0 1 ${fmt(x + w - br)},${fmt(y + h)}`,
    `H${fmt(x + bl)}`,
    `A${fmt(bl)},${fmt(bl)} 0 0 1 ${fmt(x)},${fmt(y + h - bl)}`,
    `V${fmt(y + tl)}`,
    `A${fmt(tl)},${fmt(tl)} 0 0 1 ${fmt(x + tl)},${fmt(y)}`,
    "Z",
  ].join("");
}

/** Radii are authored for a bar growing up. Negative bars flip to the bottom corners. */
export const flipVertical = (r: Corners): Corners => [r[3], r[2], r[1], r[0]];
/** Bar growing right: rounded end is the right side. */
export const rotateToRight = (r: Corners): Corners => [r[3], r[0], r[1], r[2]];
/** Bar growing left (negative horizontal): rounded end is the left side. */
export const rotateToLeft = (r: Corners): Corners => [r[1], r[2], r[3], r[0]];
