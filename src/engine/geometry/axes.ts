import type { ChartDocument } from "../../model/types";
import type { SceneNode } from "../types";
import type { Theme } from "../theme";
import type { LayoutResult } from "../layout";
import { formatValue } from "../format";
import { valueScale } from "../scales";
import { snap } from "../pixelSnap";

/** Gridlines, zero baseline, value ticks and category labels for vertical (x = category) charts. */
export function verticalAxes(doc: ChartDocument, L: LayoutResult, theme: Theme): SceneNode[] {
  const { plot, u, fonts } = L;
  const y = valueScale(L.domain, [plot.y + plot.height, plot.y]);
  const nodes: SceneNode[] = [];
  const bottom = plot.y + plot.height;

  if (doc.geometry.showGridlines) {
    for (const t of L.ticks) {
      const py = snap(y(t));
      nodes.push({ kind: "line", x1: plot.x, y1: py, x2: plot.x + plot.width, y2: py, stroke: theme.ink, strokeWidth: 1, opacity: doc.geometry.gridlineOpacity });
    }
  }
  for (const t of L.ticks) {
    nodes.push({ kind: "text", x: plot.x - 12 * u, y: y(t) + fonts.label * 0.35, text: formatValue(doc.data, t), fontSize: fonts.label, fontWeight: 400, fill: theme.muted, anchor: "end" });
  }
  const [lo, hi] = L.domain;
  if (lo <= 0 && hi >= 0) {
    const zy = snap(y(0));
    nodes.push({ kind: "line", x1: plot.x, y1: zy, x2: plot.x + plot.width, y2: zy, stroke: theme.ink, strokeWidth: 1, opacity: 0.55 });
  }
  if (doc.geometry.showAxisBreak && lo > 0) {
    for (const dy of [0, 7 * u]) {
      nodes.push({ kind: "line", x1: plot.x - 10 * u, y1: bottom - 4 * u - dy, x2: plot.x + 10 * u, y2: bottom - 12 * u - dy, stroke: theme.muted, strokeWidth: 2 });
    }
  }

  const n = doc.data.labels.length;
  const step = plot.width / Math.max(1, n);
  const { rotation, step: every } = L.categoryLabels;
  doc.data.labels.forEach((label, i) => {
    if (i % every !== 0) return;
    const cx = plot.x + (i + 0.5) * step;
    if (rotation === 0) {
      nodes.push({ kind: "text", x: cx, y: bottom + 14 * u + fonts.label * 0.8, text: label, fontSize: fonts.label, fontWeight: 400, fill: theme.muted, anchor: "middle" });
    } else {
      const py = bottom + 12 * u + fonts.label * 0.4;
      nodes.push({ kind: "text", x: cx, y: py, text: label, fontSize: fonts.label, fontWeight: 400, fill: theme.muted, anchor: "end", rotate: rotation });
    }
  });
  return nodes;
}

/** Same for horizontal bars: categories down the left, value ticks along the bottom. */
export function horizontalAxes(doc: ChartDocument, L: LayoutResult, theme: Theme): SceneNode[] {
  const { plot, u, fonts } = L;
  const x = valueScale(L.domain, [plot.x, plot.x + plot.width]);
  const nodes: SceneNode[] = [];
  const bottom = plot.y + plot.height;

  if (doc.geometry.showGridlines) {
    for (const t of L.ticks) {
      const px = snap(x(t));
      nodes.push({ kind: "line", x1: px, y1: plot.y, x2: px, y2: bottom, stroke: theme.ink, strokeWidth: 1, opacity: doc.geometry.gridlineOpacity });
    }
  }
  for (const t of L.ticks) {
    nodes.push({ kind: "text", x: x(t), y: bottom + 14 * u + fonts.label * 0.8, text: formatValue(doc.data, t), fontSize: fonts.label, fontWeight: 400, fill: theme.muted, anchor: "middle" });
  }
  const [lo, hi] = L.domain;
  if (lo <= 0 && hi >= 0) {
    const zx = snap(x(0));
    nodes.push({ kind: "line", x1: zx, y1: plot.y, x2: zx, y2: bottom, stroke: theme.ink, strokeWidth: 1, opacity: 0.55 });
  }
  const n = doc.data.labels.length;
  const step = plot.height / Math.max(1, n);
  doc.data.labels.forEach((label, i) => {
    if (i % L.categoryLabels.step !== 0) return;
    nodes.push({ kind: "text", x: plot.x - 12 * u, y: plot.y + (i + 0.5) * step + fonts.label * 0.35, text: label, fontSize: fonts.label, fontWeight: 400, fill: theme.muted, anchor: "end" });
  });
  return nodes;
}
