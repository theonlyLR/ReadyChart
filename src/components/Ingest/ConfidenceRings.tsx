import type { ChartDocument } from "../../model/types";
import type { LayoutResult } from "../../engine/layout";
import { computeHandles } from "../../engine/sculpt";
import { useUiStore } from "../../store/uiStore";

const RING_PX = 40;

/**
 * Pulsing amber rings on bars / points whose extracted value is LOW_CONFIDENCE (< 0.85). Editor-only: it is a DOM
 * overlay, never part of the scene, so no export ever contains it. Cleared by editing, dragging or clicking the
 * point (SculptOverlay confirms the cell) because confirming flips its provenance away from LOW_CONFIDENCE.
 */
export function ConfidenceRings({ doc, layout }: { doc: ChartDocument; layout: LayoutResult }) {
  const playing = useUiStore((s) => s.playing);
  const playheadMs = useUiStore((s) => s.playheadMs);
  const editing = useUiStore((s) => s.editingField);
  if (playing || playheadMs !== null || editing !== null) return null;
  const flagged = computeHandles(doc, layout).filter((h) => doc.data.series[h.seriesIndex]?.provenance[h.index] === "LOW_CONFIDENCE");
  if (flagged.length === 0) return null;
  const { width: W, height: H } = doc.canvas;
  return (
    <div className="pointer-events-none absolute inset-0 z-[5]" data-testid="confidence-rings" aria-hidden>
      {flagged.map((h) => (
        <span
          key={h.key}
          className="rc-ring absolute rounded-full border-2 border-amber-400"
          style={{ left: `${(h.x / W) * 100}%`, top: `${(h.y / H) * 100}%`, width: `${(RING_PX / W) * 100}%`, aspectRatio: "1", transform: "translate(-50%, -50%)" }}
        />
      ))}
    </div>
  );
}
