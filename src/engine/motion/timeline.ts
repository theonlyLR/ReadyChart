import type { ChartDocument } from "../../model/types";
import { buildSlices } from "../geometry/pie";
import { springSettleMs } from "./easing";

export const STAGE_MAX_MS = 400;

export interface Timeline {
  /** Stage Set (gridlines) runs 0 .. stageMs; hero data starts right after. */
  stageMs: number;
  heroStartMs: number;
  /** Duration of one item's own motion track. */
  trackMs: number;
  /** Per-item start offset (relative to heroStartMs), indexed by item. */
  delays: number[];
  /** All hero tracks (and the synchronised number roll-up) are done. */
  heroEndMs: number;
  /** Readability hold: heroEndMs .. holdEndMs. */
  holdEndMs: number;
  /** Loop reset fade: holdEndMs .. totalMs. */
  totalMs: number;
}

/** Number of animated hero items: slices for pie/donut, categories otherwise. */
export function itemCount(doc: ChartDocument): number {
  const t = doc.geometry.type;
  return t === "pie" || t === "donut" ? buildSlices(doc).length : doc.data.labels.length;
}

/** Sort key per item for "smallest-to-largest": slice value, or the category total across series. */
function itemValues(doc: ChartDocument, n: number): number[] {
  const t = doc.geometry.type;
  if (t === "pie" || t === "donut") return buildSlices(doc).map((s) => s.value);
  return Array.from({ length: n }, (_, i) => doc.data.series.reduce((sum, s) => sum + Math.abs(s.values[i] ?? 0), 0));
}

/** rank[i] = order in which item i starts (0 = first). Stable: ties fall back to index order. */
export function staggerRanks(doc: ChartDocument, n: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  const dir = doc.motion.staggerDirection;
  let key: (i: number) => number;
  if (dir === "center-out") key = (i) => Math.abs(i - (n - 1) / 2);
  else if (dir === "smallest-to-largest") {
    const v = itemValues(doc, n);
    key = (i) => v[i]!;
  } else key = (i) => i;
  idx.sort((a, b) => key(a) - key(b) || a - b);
  const rank = new Array<number>(n).fill(0);
  idx.forEach((item, r) => (rank[item] = r));
  return rank;
}

export function buildTimeline(doc: ChartDocument): Timeline {
  const m = doc.motion;
  const n = itemCount(doc);
  const trackMs = m.physicsMode === "spring" ? springSettleMs(m.springStiffness, m.springDamping) : Math.max(1, m.durationMs);
  const stageMs = Math.round(Math.min(STAGE_MAX_MS, trackMs * 0.35));
  const step = n > 1 ? Math.min(Math.max(0, m.staggerMs), Math.max(0, m.maxTotalStaggerMs) / (n - 1)) : 0;
  const ranks = staggerRanks(doc, n);
  const delays = ranks.map((r) => r * step);
  const maxDelay = delays.reduce((a, b) => Math.max(a, b), 0);
  const heroStartMs = stageMs;
  const heroEndMs = Math.round(heroStartMs + maxDelay + trackMs);
  const holdEndMs = heroEndMs + Math.max(0, m.holdEndMs);
  const totalMs = holdEndMs + Math.max(0, m.loopResetMs);
  return { stageMs, heroStartMs, trackMs, delays, heroEndMs, holdEndMs, totalMs };
}
