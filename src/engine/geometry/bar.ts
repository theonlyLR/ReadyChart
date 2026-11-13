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
import { flipVertical, roundedRectPath, rotateToLeft, rotateToRight } from "./roundedRect";

const GROUP_GAP = 0.08;

const barColor = (doc: ChartDocument, si: number, i: number): string => {
  const s = doc.data.series[si]!;
  return s.pointColorOverrides?.[i] ?? s.color;
};

export function verticalBarNodes(doc: ChartDocument, L: LayoutResult, theme: Theme, m: TextMeasurer, frame: FrameState = FINAL_FRAME): SceneNode[] {
  const { plot, u, fonts } = L;
  const g = doc.geometry;
  const y = valueScale(L.domain, [plot.y + plot.height, plot.y]);
  const yMin = plot.y;
  const yMax = plot.y + plot.height;
  const py = (v: number) => clamp(y(v), yMin, yMax);
  const base = py(0);
  const n = doc.data.labels.length;
  const step = plot.width / Math.max(1, n);
  const catGap = g.barGapRatio * step;
  const bandW = Math.max(1, step - catGap);
  const stacked = g.type === "stacked-bar";
  const k = stacked ? 1 : Math.max(1, doc.data.series.length);
  const barW = stacked ? bandW : bandW / (k + (k - 1) * GROUP_GAP);
  const gapIn = barW * GROUP_GAP;
  const nodes: SceneNode[] = [];

  for (let i = 0; i < n; i++) {
    const bandX = plot.x + i * step + catGap / 2;
    const p = itemProgress(frame, i);
    const roll = itemRoll(frame, i);
    const alpha = itemAlpha(frame, i);

    if (stacked) {
      let lastPos = -1;
      let lastNeg = -1;
      doc.data.series.forEach((s, si) => {
        const v = s.values[i];
        if (v == null || v === 0) return;
        if (v > 0) lastPos = si;
        else lastNeg = si;
      });
      let pos = 0;
      let neg = 0;
      doc.data.series.forEach((s, si) => {
        const v = s.values[i];
        if (v == null || v === 0) return;
        const from = v > 0 ? pos : neg;
        const to = from + v;
        if (v > 0) pos = to;
        else neg = to;
        const a = py(from * p);
        const b = py(to * p);
        const top = Math.min(a, b);
        const h = Math.abs(a - b);
        if (h <= 0) return;
        const outer = v > 0 ? si === lastPos : si === lastNeg;
        const radii = outer ? (v > 0 ? g.barRadius : flipVertical(g.barRadius)) : ([0, 0, 0, 0] as const);
        nodes.push({ kind: "path", d: roundedRectPath(bandX, top, bandW, h, [...radii] as [number, number, number, number]), fill: barColor(doc, si, i), ...opacityProp(frame.fade) });
        if (g.showDataLabels && h >= fonts.value * 1.5) {
          const text = formatValue(doc.data, v);
          if (m.width(text, fonts.value, 600) <= bandW - 8 * u) {
            nodes.push({ kind: "text", x: bandX + bandW / 2, y: top + h / 2 + fonts.value * 0.35, text: formatValue(doc.data, rollValue(v, roll)), fontSize: fonts.value, fontWeight: 600, fill: theme.onAccent, anchor: "middle", ...opacityProp(alpha) });
          }
        }
      });
      continue;
    }

    doc.data.series.forEach((s, si) => {
      const v = s.values[i];
      if (v == null) return;
      const x = bandX + si * (barW + gapIn);
      const yv = clamp(base + (py(v) - base) * p, yMin, yMax);
      const top = Math.min(yv, base);
      const h = Math.abs(base - yv);
      if (h <= 0) return;
      nodes.push({ kind: "path", d: roundedRectPath(x, top, barW, h, v >= 0 ? g.barRadius : flipVertical(g.barRadius)), fill: barColor(doc, si, i), ...opacityProp(frame.fade) });
      if (g.showDataLabels) {
        const text = formatValue(doc.data, v);
        if (m.width(text, fonts.value, 600) <= barW + gapIn + catGap * 0.9) {
          nodes.push({
            kind: "text",
            x: x + barW / 2,
            y: v >= 0 ? top - 8 * u : top + h + 8 * u + fonts.value * 0.75,
            text: formatValue(doc.data, rollValue(v, roll)),
            fontSize: fonts.value,
            fontWeight: 600,
            fill: theme.ink,
            anchor: "middle",
            ...opacityProp(alpha),
          });
        }
      }
    });
  }
  return nodes;
}

export function horizontalBarNodes(doc: ChartDocument, L: LayoutResult, theme: Theme, m: TextMeasurer, frame: FrameState = FINAL_FRAME): SceneNode[] {
  const { plot, u, fonts } = L;
  const g = doc.geometry;
  const x = valueScale(L.domain, [plot.x, plot.x + plot.width]);
  const px = (v: number) => clamp(x(v), plot.x, plot.x + plot.width);
  const base = px(0);
  const n = doc.data.labels.length;
  const step = plot.height / Math.max(1, n);
  const catGap = g.barGapRatio * step;
  const bandH = Math.max(1, step - catGap);
  const k = Math.max(1, doc.data.series.length);
  const barH = bandH / (k + (k - 1) * GROUP_GAP);
  const gapIn = barH * GROUP_GAP;
  const nodes: SceneNode[] = [];

  for (let i = 0; i < n; i++) {
    const bandY = plot.y + i * step + catGap / 2;
    const p = itemProgress(frame, i);
    const roll = itemRoll(frame, i);
    const alpha = itemAlpha(frame, i);
    doc.data.series.forEach((s, si) => {
      const v = s.values[i];
      if (v == null) return;
      const yy = bandY + si * (barH + gapIn);
      const xv = clamp(base + (px(v) - base) * p, plot.x, plot.x + plot.width);
      const left = Math.min(xv, base);
      const w = Math.abs(xv - base);
      if (w <= 0) return;
      nodes.push({ kind: "path", d: roundedRectPath(left, yy, w, barH, v >= 0 ? rotateToRight(g.barRadius) : rotateToLeft(g.barRadius)), fill: barColor(doc, si, i), ...opacityProp(frame.fade) });
      if (g.showDataLabels && barH >= fonts.value * 0.8) {
        nodes.push({
          kind: "text",
          x: v >= 0 ? left + w + 8 * u : left - 8 * u,
          y: yy + barH / 2 + fonts.value * 0.35,
          text: formatValue(doc.data, rollValue(v, roll)),
          fontSize: fonts.value,
          fontWeight: 600,
          fill: theme.ink,
          anchor: v >= 0 ? "start" : "end",
          ...opacityProp(alpha),
        });
      }
    });
  }
  void m;
  return nodes;
}
