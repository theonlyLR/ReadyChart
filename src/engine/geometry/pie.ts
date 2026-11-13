import { arc, pie } from "d3-shape";
import type { ChartDocument } from "../../model/types";
import { SERIES_PALETTE } from "../../model/defaults";
import type { Rect, SceneNode } from "../types";
import type { Theme } from "../theme";
import type { TextMeasurer } from "../textMeasure";
import type { FrameState } from "../motion/frameState";
import { FINAL_FRAME, itemAlpha, itemProgress, itemRoll, opacityProp, rollValue } from "../motion/frameState";
import { formatPercent, formatValue } from "../format";

export interface Slice {
  label: string;
  value: number;
  color: string;
  grouped?: boolean;
}

export const OTHER_COLOR = "#94A3B8";

/** Slices from the first series, with slices under groupSmallSlicesBelowPct merged into "Other" (only when 2+ qualify). */
export function buildSlices(doc: ChartDocument): Slice[] {
  const s = doc.data.series[0];
  if (!s) return [];
  const raw: Slice[] = [];
  doc.data.labels.forEach((label, i) => {
    const v = s.values[i];
    if (v == null || v <= 0) return;
    raw.push({ label, value: v, color: s.pointColorOverrides?.[i] ?? SERIES_PALETTE[i % SERIES_PALETTE.length]! });
  });
  const total = raw.reduce((t, r) => t + r.value, 0);
  const pct = doc.geometry.groupSmallSlicesBelowPct;
  if (total <= 0 || pct <= 0) return raw;
  const small = raw.filter((r) => (r.value / total) * 100 < pct);
  if (small.length < 2) return raw;
  const kept = raw.filter((r) => !small.includes(r));
  kept.push({ label: "Other", value: small.reduce((t, r) => t + r.value, 0), color: OTHER_COLOR, grouped: true });
  return kept;
}

export function pieNodes(doc: ChartDocument, plot: Rect, theme: Theme, measurer: TextMeasurer, u: number, frame: FrameState = FINAL_FRAME): SceneNode[] {
  const slices = buildSlices(doc);
  const total = slices.reduce((t, r) => t + r.value, 0);
  if (total <= 0) return [];
  const cx = plot.x + plot.width / 2;
  const cy = plot.y + plot.height / 2;
  const r = Math.max(10, Math.min(plot.width, plot.height) / 2 - 8 * u);
  const inner = doc.geometry.type === "donut" ? r * doc.geometry.donutInnerRatio : 0;
  const gen = arc<{ startAngle: number; endAngle: number }>().innerRadius(inner).outerRadius(r);
  const angles = pie<Slice>().sort(null).value((d) => d.value)(slices);
  const nodes: SceneNode[] = [];
  const fontSize = 20 * u;

  angles.forEach((a, i) => {
    const slice = slices[i]!;
    // Each slice sweeps open from its own start angle (pies never overshoot, or neighbours would overlap).
    const grow = Math.min(1, Math.max(0, itemProgress(frame, i)));
    if (grow <= 0) return;
    nodes.push({
      kind: "path",
      d: gen({ startAngle: a.startAngle, endAngle: a.startAngle + (a.endAngle - a.startAngle) * grow }) ?? "",
      tx: cx,
      ty: cy,
      fill: slice.color,
      stroke: theme.surface,
      strokeWidth: 2 * u,
      linejoin: "round",
      ...opacityProp(frame.fade),
    });
  });

  if (doc.geometry.showDataLabels) {
    const labelR = (inner + r) / 2;
    angles.forEach((a, i) => {
      const sweep = a.endAngle - a.startAngle;
      const text = formatPercent(slices[i]!.value / total);
      const need = measurer.width(text, fontSize, 600) + 8 * u;
      const shown = formatPercent(rollValue(slices[i]!.value, itemRoll(frame, i)) / total);
      const alpha = itemAlpha(frame, i);
      if (sweep * labelR < need || (r - inner) < fontSize * 1.4) return;
      const mid = (a.startAngle + a.endAngle) / 2;
      nodes.push({
        kind: "text",
        x: cx + Math.sin(mid) * labelR,
        y: cy - Math.cos(mid) * labelR + fontSize * 0.35,
        text: shown,
        fontSize,
        fontWeight: 600,
        fill: theme.onAccent,
        anchor: "middle",
        ...opacityProp(alpha),
      });
    });
  }

  if (doc.geometry.type === "donut" && inner > fontSize * 3) {
    const shownTotal = slices.reduce((t, sl, i) => t + rollValue(sl.value, itemRoll(frame, i)), 0);
    const centerAlpha = frame.fade;
    nodes.push({
      kind: "text",
      x: cx,
      y: cy + fontSize * 0.2,
      text: formatValue(doc.data, shownTotal),
      fontSize: fontSize * 1.8,
      fontWeight: 600,
      fill: theme.ink,
      anchor: "middle",
      ...opacityProp(centerAlpha),
    });
    nodes.push({ kind: "text", x: cx, y: cy + fontSize * 1.6, text: "Total", fontSize: fontSize * 0.9, fontWeight: 400, fill: theme.muted, anchor: "middle", ...opacityProp(centerAlpha) });
  }
  return nodes;
}
