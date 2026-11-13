import { area, curveCardinal, curveLinear, line } from "d3-shape";
import type { ChartDocument } from "../../model/types";
import { clamp } from "../../model/validate";
import type { SceneNode } from "../types";
import type { Theme } from "../theme";
import type { TextMeasurer } from "../textMeasure";
import type { LayoutResult } from "../layout";
import { formatValue } from "../format";
import { valueScale } from "../scales";
import type { FrameState } from "../motion/frameState";
import { FINAL_FRAME, itemAlpha, itemProgress, itemRoll, opacityProp, rollValue } from "../motion/frameState";
import { fmt } from "./roundedRect";

const circlePath = (cx: number, cy: number, r: number): string =>
  `M${fmt(cx - r)},${fmt(cy)}a${fmt(r)},${fmt(r)} 0 1,0 ${fmt(2 * r)},0a${fmt(r)},${fmt(r)} 0 1,0 ${fmt(-2 * r)},0Z`;

/**
 * curveTension 0 = straight segments; 1 = smoothest (Catmull-Rom). Mapped onto d3's cardinal tension (1 = straight).
 */
export function lineNodes(doc: ChartDocument, L: LayoutResult, theme: Theme, m: TextMeasurer, frame: FrameState = FINAL_FRAME): SceneNode[] {
  const { plot, u, fonts } = L;
  const g = doc.geometry;
  const y = valueScale(L.domain, [plot.y + plot.height, plot.y]);
  const py = (v: number) => clamp(y(v), plot.y, plot.y + plot.height);
  const base = py(Math.max(L.domain[0], Math.min(0, L.domain[1])));
  const n = doc.data.labels.length;
  const step = plot.width / Math.max(1, n);
  const curve = g.curveTension <= 0 ? curveLinear : curveCardinal.tension(1 - Math.min(1, g.curveTension));
  const nodes: SceneNode[] = [];
  const showMarkers = n <= 40;

  doc.data.series.forEach((s) => {
    const pts = s.values.map((v, i) => ({ x: plot.x + (i + 0.5) * step, v, i }));
    const defined = (d: { v: number | null }) => d.v !== null;
    // Each point rises from the baseline by its own staggered progress.
    const animY = (d: { v: number | null; i: number }) => {
      const to = py(d.v as number);
      return clamp(base + (to - base) * itemProgress(frame, d.i), plot.y, plot.y + plot.height);
    };
    if (g.type === "area") {
      const areaGen = area<{ x: number; v: number | null; i: number }>()
        .defined(defined)
        .x((d) => d.x)
        .y0(base)
        .y1(animY)
        .curve(curve);
      nodes.push({ kind: "path", d: areaGen(pts) ?? "", fill: s.color, opacity: 0.18 * frame.fade });
    }
    const lineGen = line<{ x: number; v: number | null; i: number }>()
      .defined(defined)
      .x((d) => d.x)
      .y(animY)
      .curve(curve);
    nodes.push({ kind: "path", d: lineGen(pts) ?? "", stroke: s.color, strokeWidth: g.strokeWidth, linejoin: "round", ...opacityProp(frame.fade) });

    pts.forEach((p, i) => {
      if (p.v === null) return;
      const cy = animY(p);
      const alpha = itemAlpha(frame, i);
      if (showMarkers) {
        nodes.push({ kind: "path", d: circlePath(p.x, cy, Math.max(3 * u, g.strokeWidth * 1.2)), fill: s.pointColorOverrides?.[i] ?? s.color, stroke: theme.surface, strokeWidth: 2 * u, ...opacityProp(alpha) });
      }
      if (g.showDataLabels) {
        const text = formatValue(doc.data, p.v);
        if (m.width(text, fonts.value, 600) + 8 * u <= step) {
          nodes.push({ kind: "text", x: p.x, y: cy - 14 * u, text: formatValue(doc.data, rollValue(p.v, itemRoll(frame, i))), fontSize: fonts.value, fontWeight: 600, fill: theme.ink, anchor: "middle", ...opacityProp(alpha) });
        }
      }
    });
  });
  return nodes;
}
