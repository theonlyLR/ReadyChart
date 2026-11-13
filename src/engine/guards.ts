import type { ChartDocument } from "../model/types";
import { hasNegatives } from "../model/validate";

export interface PieGuard {
  blocked: boolean;
  reason: string | null;
}

/** Pie/donut cannot represent negative values: block rendering and offer a switch to horizontal bar. */
export function pieGuard(doc: ChartDocument): PieGuard {
  const radial = doc.geometry.type === "pie" || doc.geometry.type === "donut";
  if (radial && hasNegatives(doc)) {
    return { blocked: true, reason: "Pie and donut charts can't show negative values." };
  }
  return { blocked: false, reason: null };
}
