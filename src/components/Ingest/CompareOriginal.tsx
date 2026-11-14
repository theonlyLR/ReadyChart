import { ChevronDown, ChevronUp, Layers, X } from "lucide-react";
import { useObjectUrl } from "../../hooks/useObjectUrl";
import { setChartType } from "../../model/dataOps";
import type { ChartType } from "../../model/types";
import { useDocumentStore } from "../../store/documentStore";
import { NO_COMPARE, useUiStore } from "../../store/uiStore";

/** One-click geometry switch while comparing. Only the chart type changes: data, labels and colours are kept. */
export const QUICK_TYPES: { type: ChartType; label: string; title: string }[] = [
  { type: "bar", label: "Bar", title: "Vertical bars" },
  { type: "horizontal-bar", label: "H-Bar", title: "Horizontal bars" },
  { type: "line", label: "Line", title: "Line" },
  { type: "pie", label: "Pie", title: "Pie" },
];

function TypeSwitcher() {
  const type = useDocumentStore((s) => s.doc.geometry.type);
  const update = useDocumentStore((s) => s.update);
  return (
    <div role="group" aria-label="Chart type" className="flex overflow-hidden rounded-full bg-slate-100 p-0.5">
      {QUICK_TYPES.map((q) => (
        <button
          key={q.type}
          title={q.title}
          aria-pressed={type === q.type}
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${type === q.type ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:bg-white"}`}
          onClick={() => update((d) => setChartType(d, q.type))}
        >
          {q.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Onion-skin: the cropped original drawn semi-transparently over the live SVG. pointer-events-none, so bar tops
 * can still be dragged and titles double-clicked straight through it. Hidden during the entrance playback.
 */
export function CompareOverlay() {
  const blob = useUiStore((s) => s.compare.blob);
  const opacity = useUiStore((s) => s.compare.opacity);
  const reveal = useUiStore((s) => s.reveal);
  const url = useObjectUrl(blob);
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      aria-hidden
      draggable={false}
      data-testid="compare-overlay"
      className="pointer-events-none absolute inset-0 z-10 h-full w-full select-none transition-opacity duration-300"
      style={{ opacity: reveal ? 0 : opacity / 100, objectFit: "fill" }}
    />
  );
}

/** Top-right "Compare Original" pill: opacity slider, collapse, dismiss. The scan card docks into it. */
export function ComparePill() {
  const compare = useUiStore((s) => s.compare);
  const setCompare = useUiStore((s) => s.setCompare);
  const docking = useUiStore((s) => s.scan.status === "docking");
  if (!compare.blob) return null;
  return (
    <div
      id="rc-compare-pill"
      className={`absolute right-3 top-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-end gap-x-2 gap-y-1 rounded-2xl bg-white/95 py-1.5 pl-3 pr-1.5 text-xs text-slate-700 shadow-lg ring-1 ring-slate-200 transition-opacity duration-300 ${docking ? "opacity-0" : "opacity-100"}`}
    >
      <Layers size={14} className="text-indigo-600" aria-hidden />
      <span className="font-medium">Compare Original</span>
      <TypeSwitcher />
      {!compare.collapsed && (
        <>
          <input
            type="range"
            min={0}
            max={100}
            value={compare.opacity}
            aria-label="Original screenshot opacity"
            className="w-28 accent-indigo-600"
            onChange={(e) => setCompare({ opacity: Number(e.target.value) })}
          />
          <span className="w-9 text-right tabular-nums text-slate-500">{compare.opacity}%</span>
        </>
      )}
      <button aria-label={compare.collapsed ? "Expand compare controls" : "Collapse compare controls"} className="rounded-full p-1 text-slate-500 hover:bg-slate-100" onClick={() => setCompare({ collapsed: !compare.collapsed })}>
        {compare.collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>
      <button aria-label="Dismiss comparison" className="rounded-full p-1 text-slate-500 hover:bg-slate-100" onClick={() => setCompare(NO_COMPARE)}>
        <X size={14} />
      </button>
    </div>
  );
}
