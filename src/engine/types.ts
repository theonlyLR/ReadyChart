export const FONT_FAMILY = "Inter, system-ui, sans-serif";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TextAnchor = "start" | "middle" | "end";

/** The one render model: consumed by SvgScene (live canvas + SVG export) and canvasRenderer (PNG/JPG/WebP). */
export type SceneNode =
  | { kind: "rect"; x: number; y: number; width: number; height: number; fill: string; opacity?: number }
  | {
      kind: "path";
      d: string;
      /** Optional translate applied to the path (d3 arcs are origin-centred). */
      tx?: number;
      ty?: number;
      fill?: string;
      stroke?: string;
      strokeWidth?: number;
      opacity?: number;
      linejoin?: "round" | "miter";
    }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; stroke: string; strokeWidth: number; opacity?: number }
  | {
      kind: "text";
      x: number;
      y: number;
      text: string;
      fontSize: number;
      fontWeight: number;
      fill: string;
      anchor: TextAnchor;
      rotate?: number;
      opacity?: number;
    }
  | { kind: "image"; x: number; y: number; width: number; height: number; href: string; opacity?: number };

export const rectsIntersect = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
