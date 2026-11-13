import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { ChartDocument } from "../model/types";
import type { LayoutResult } from "../engine/layout";
import { computeHandles, valueFromPointer } from "../engine/sculpt";
import type { Handle } from "../engine/sculpt";
import { formatValue } from "../engine/format";
import { confirmCell, isUnverified, setCell } from "../model/dataOps";
import { useDocumentStore } from "../store/documentStore";
import { useUiStore } from "../store/uiStore";

/** Pointer travel (screen px) before a press becomes a drag, so a plain click never touches the document. */
const DRAG_THRESHOLD = 3;

/** Ephemeral gesture bookkeeping. The chart data itself is only ever mutated through the document store. */
interface Drag {
  pointerId: number;
  handle: Handle;
  domain: [number, number];
  plot: LayoutResult["plot"];
  startX: number;
  startY: number;
  /** Axis bounds as they were before the drag froze them. Restored on release. */
  orig: { yMin: ChartDocument["geometry"]["yMin"]; yMax: ChartDocument["geometry"]["yMax"] };
  started: boolean;
}

/**
 * Drag bar ends / line points to set values. One gesture = one undo step: a store transaction opens on the first
 * real movement and commits on release. The value axis is pinned for the duration so the chart doesn't rescale
 * under the cursor; it is restored (and so re-fits the data) on release.
 */
export function SculptOverlay({ doc, layout }: { doc: ChartDocument; layout: LayoutResult }) {
  const playing = useUiStore((s) => s.playing);
  const playheadMs = useUiStore((s) => s.playheadMs);
  const editing = useUiStore((s) => s.editingField);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Only on the resting, final frame: handles are placed from the settled layout, and motion owns the other frames.
  if (playing || playheadMs !== null || editing !== null) return null;
  const handles = computeHandles(doc, layout);
  if (handles.length === 0) return null;
  const { width: W, height: H } = doc.canvas;

  const toDoc = (e: ReactPointerEvent) => {
    const r = frame.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>, handle: Handle) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const g = useDocumentStore.getState().doc.geometry;
    drag.current = { pointerId: e.pointerId, handle, domain: layout.domain, plot: layout.plot, startX: e.clientX, startY: e.clientY, orig: { yMin: g.yMin, yMax: g.yMax }, started: false };
    setActiveKey(handle.key);
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const store = useDocumentStore.getState();
    if (!d.started) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return;
      d.started = true;
      store.beginTransaction();
      // Pin the axis the drag began with (a no-op for the value axis of horizontal/vertical charts alike).
      store.update((s) => {
        s.geometry.yMin = d.domain[0];
        s.geometry.yMax = d.domain[1];
      });
    }
    const p = toDoc(e);
    const v = valueFromPointer(d.handle.axis, d.domain, d.plot, p.x, p.y);
    store.update((s) => setCell(s.data, d.handle.seriesIndex, d.handle.index, v));
  };

  const end = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    setActiveKey(null);
    const store = useDocumentStore.getState();
    if (!d.started) {
      // A plain click on a flagged (unverified) value confirms it, which clears its amber ring. No-op otherwise.
      const p = store.doc.data.series[d.handle.seriesIndex]?.provenance[d.handle.index];
      if (isUnverified(p)) store.update((s) => confirmCell(s.data, d.handle.seriesIndex, d.handle.index));
      return;
    }
    store.update((s) => {
      s.geometry.yMin = d.orig.yMin;
      s.geometry.yMax = d.orig.yMax;
    });
    store.commitTransaction();
  };

  return (
    <div ref={frame} className="pointer-events-none absolute inset-0" data-testid="sculpt-overlay">
      {handles.map((h) => {
        const series = doc.data.series[h.seriesIndex]!;
        const active = activeKey === h.key;
        return (
          <div
            key={h.key}
            role="img"
            aria-label={`${series.name}, ${doc.data.labels[h.index] ?? ""}: ${formatValue(doc.data, h.value)}. Drag to change.`}
            data-handle={h.key}
            className={`pointer-events-auto absolute h-3.5 w-3.5 touch-none rounded-full border-2 border-indigo-600 bg-white shadow transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover:opacity-70 hover:!opacity-100"}`}
            style={{
              left: `${(h.x / W) * 100}%`,
              top: `${(h.y / H) * 100}%`,
              transform: "translate(-50%, -50%)",
              cursor: h.axis === "y" ? "ns-resize" : "ew-resize",
            }}
            onPointerDown={(e) => onDown(e, h)}
            onPointerMove={onMove}
            onPointerUp={end}
            onPointerCancel={end}
          />
        );
      })}
    </div>
  );
}
