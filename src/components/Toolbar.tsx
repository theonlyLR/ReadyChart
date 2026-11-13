import { Download, Redo2, Undo2 } from "lucide-react";
import {
  HIGH_DENSITY_COLLISION_FIXTURE,
  MICRO_SLICE_PIE_FIXTURE,
  NEGATIVE_CASHFLOW_FIXTURE,
} from "../../fixtures/goldenDatasets";
import { createDefaultDocument, createDocumentFromColumns } from "../model/defaults";
import type { ChartDocument, ChartType } from "../model/types";
import { useDocumentStore } from "../store/documentStore";
import { useUiStore } from "../store/uiStore";

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: "bar", label: "Bar" },
  { value: "horizontal-bar", label: "Horizontal bar" },
  { value: "stacked-bar", label: "Stacked bar" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "pie", label: "Pie" },
  { value: "donut", label: "Donut" },
];

const SAMPLES: Record<string, () => ChartDocument> = {
  "Quarterly revenue": createDefaultDocument,
  "Negative cash flow": () => createDocumentFromColumns(NEGATIVE_CASHFLOW_FIXTURE.labels, NEGATIVE_CASHFLOW_FIXTURE.values, "Net cash flow", "bar"),
  "36-week density": () => {
    const d = createDocumentFromColumns(HIGH_DENSITY_COLLISION_FIXTURE.labels, HIGH_DENSITY_COLLISION_FIXTURE.values, "Weekly signups", "bar");
    d.geometry.showDataLabels = false;
    return d;
  },
  "Micro-slice pie": () => createDocumentFromColumns(MICRO_SLICE_PIE_FIXTURE.labels, MICRO_SLICE_PIE_FIXTURE.values, "Revenue by segment", "donut"),
};

const btn = "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-35 disabled:hover:bg-transparent";

export function Toolbar() {
  const type = useDocumentStore((s) => s.doc.geometry.type);
  const canUndo = useDocumentStore((s) => s.past.length > 0);
  const canRedo = useDocumentStore((s) => s.future.length > 0);
  const { update, undo, redo, replaceDoc } = useDocumentStore.getState();
  const setFlightCheckOpen = useUiStore((s) => s.setFlightCheckOpen);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
      <span className="mr-3 text-sm font-semibold tracking-tight text-slate-900">ReadyChart</span>
      <button className={btn} disabled={!canUndo} onClick={undo} title="Undo (⌘Z)">
        <Undo2 size={16} /> Undo
      </button>
      <button className={btn} disabled={!canRedo} onClick={redo} title="Redo (⇧⌘Z)">
        <Redo2 size={16} /> Redo
      </button>
      <div className="mx-2 h-5 w-px bg-slate-200" />
      <select
        aria-label="Chart type"
        className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
        value={type}
        onChange={(e) => update((d) => void (d.geometry.type = e.target.value as ChartType))}
      >
        {CHART_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Load sample"
        className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
        value=""
        onChange={(e) => {
          const make = SAMPLES[e.target.value];
          if (make) replaceDoc(make());
        }}
      >
        <option value="" disabled>
          Load sample…
        </option>
        {Object.keys(SAMPLES).map((k) => (
          <option key={k}>{k}</option>
        ))}
      </select>
      <div className="flex-1" />
      <button
        className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        onClick={() => setFlightCheckOpen(true)}
      >
        <Download size={16} /> Export
      </button>
    </header>
  );
}
