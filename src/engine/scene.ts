import type { ChartDocument } from "../model/types";
import type { SceneNode } from "./types";
import type { TextMeasurer } from "./textMeasure";
import type { LayoutResult, TextBlock } from "./layout";
import { computeLayout } from "./layout";
import { themeFor } from "./theme";
import { pieGuard } from "./guards";
import { horizontalAxes, verticalAxes } from "./geometry/axes";
import { horizontalBarNodes, verticalBarNodes } from "./geometry/bar";
import { lineNodes } from "./geometry/line";
import { pieNodes } from "./geometry/pie";
import { roundedRectPath } from "./geometry/roundedRect";

function textBlock(b: TextBlock, fill: string): SceneNode[] {
  return b.lines.map((text, i) => ({
    kind: "text" as const,
    x: b.x,
    y: b.y + i * b.lineHeight,
    text,
    fontSize: b.fontSize,
    fontWeight: b.fontWeight,
    fill,
    anchor: "start" as const,
  }));
}

/** doc + layout -> flat, ordered scene. Pure; the only thing renderers consume. */
export function buildSceneFromLayout(doc: ChartDocument, L: LayoutResult, m: TextMeasurer): SceneNode[] {
  const theme = themeFor(doc.canvas.background, doc.canvas.transparent);
  const nodes: SceneNode[] = [];

  if (!doc.canvas.transparent) {
    nodes.push({ kind: "rect", x: 0, y: 0, width: L.width, height: L.height, fill: doc.canvas.background });
  }
  nodes.push(...textBlock(L.title, theme.ink), ...textBlock(L.subtitle, theme.muted));

  if (L.legend) {
    for (const it of L.legend.items) {
      nodes.push({ kind: "path", d: roundedRectPath(it.x, it.y + 8 * L.u, L.legend.swatch, L.legend.swatch, [3, 3, 3, 3]), fill: it.color });
      nodes.push({ kind: "text", x: it.textX, y: it.y + 8 * L.u + L.legend.swatch * 0.5 + L.fonts.label * 0.35, text: it.label, fontSize: L.fonts.label, fontWeight: 400, fill: theme.ink, anchor: "start" });
    }
  }

  if (!pieGuard(doc).blocked) {
    switch (doc.geometry.type) {
      case "bar":
      case "stacked-bar":
        nodes.push(...verticalAxes(doc, L, theme), ...verticalBarNodes(doc, L, theme, m));
        break;
      case "horizontal-bar":
        nodes.push(...horizontalAxes(doc, L, theme), ...horizontalBarNodes(doc, L, theme, m));
        break;
      case "line":
      case "area":
        nodes.push(...verticalAxes(doc, L, theme), ...lineNodes(doc, L, theme, m));
        break;
      case "pie":
      case "donut":
        nodes.push(...pieNodes(doc, L.plot, theme, m, L.u));
        break;
    }
  }

  nodes.push(...textBlock(L.footer, theme.muted));

  if (doc.brand.logoDataUrl && L.logoBox) {
    const b = L.logoBox;
    nodes.push({ kind: "image", x: b.x, y: b.y, width: b.width, height: b.height, href: doc.brand.logoDataUrl, opacity: doc.brand.opacity });
  }
  return nodes;
}

export function buildScene(doc: ChartDocument, m: TextMeasurer): { layout: LayoutResult; nodes: SceneNode[] } {
  const layout = computeLayout(doc, m);
  return { layout, nodes: buildSceneFromLayout(doc, layout, m) };
}
