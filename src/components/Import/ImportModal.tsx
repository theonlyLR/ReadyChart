import { useEffect, useMemo, useState } from "react";
import { ScreenshotTab } from "./ScreenshotTab";
import { X } from "lucide-react";
import { parsePastedText } from "../../ingest/parseTable";
import type { ParsedTable } from "../../ingest/parseTable";
import { applyParsedTable } from "../../ingest/toDocument";
import type { ImportMode } from "../../ingest/toDocument";
import type { ChartType } from "../../model/types";
import { useDocumentStore } from "../../store/documentStore";
import { useUiStore } from "../../store/uiStore";

export const CHART_OPTIONS: { value: ChartType; label: string }[] = [
  { value: "bar", label: "Bar" },
  { value: "horizontal-bar", label: "Horizontal bar" },
  { value: "stacked-bar", label: "Stacked bar" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "pie", label: "Pie" },
  { value: "donut", label: "Donut" },
];

const PREVIEW_ROWS = 12;

/** Editable preview + commit controls shared by the paste tab and the screenshot tab's assisted entry. */
export function ParsedPreview({
  table,
  provenance,
  meta,
  onDone,
}: {
  table: ParsedTable;
  /** Fallback tag for cells whose series carries no per-cell provenance. */
  provenance: "PARSED" | "OCR_EXACT" | "AXIS_MEASURED" | "LOW_CONFIDENCE";
  /** Title/subtitle read from a screenshot, applied only when replacing the chart. */
  meta?: { title: string; subtitle: string };
  onDone: () => void;
}) {
  const [chart, setChart] = useState<ChartType | null>(null);
  const [mode, setMode] = useState<ImportMode>("replace");
  const [included, setIncluded] = useState<Record<number, boolean>>({});
  const current = useDocumentStore((s) => s.doc);

  const effective: ParsedTable = useMemo(
    () => ({ ...table, series: table.series.map((s, i) => ({ ...s, included: included[i] ?? s.included })) }),
    [table, included],
  );
  const chosen = chart ?? table.chart;
  const count = effective.series.filter((s) => s.included).length;
  const cells = effective.series.filter((s) => s.included).reduce((a, s) => a + s.values.filter((v) => v !== null).length, 0);

  const commit = () => {
    const next = applyParsedTable(current, effective, { mode, chart: chosen, provenance });
    if (mode === "replace" && meta) {
      if (meta.title) next.title = meta.title;
      if (meta.subtitle) next.subtitle = meta.subtitle;
    }
    useDocumentStore.getState().replaceDoc(next);
    onDone();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {effective.warnings.length > 0 && (
        <ul className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {effective.warnings.map((w, i) => (
            <li key={i}>• {w}</li>
          ))}
        </ul>
      )}
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-slate-200">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr>
              <th className="px-2 py-1.5 text-xs font-medium text-slate-500">Label</th>
              {effective.series.map((s, i) => (
                <th key={i} className="px-2 py-1.5 text-xs font-medium text-slate-700">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" aria-label={`Include ${s.name}`} checked={s.included} onChange={(e) => setIncluded((p) => ({ ...p, [i]: e.target.checked }))} />
                    {s.name}
                  </label>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {effective.labels.slice(0, PREVIEW_ROWS).map((label, r) => (
              <tr key={r} className="border-t border-slate-100">
                <td className="px-2 py-1 text-slate-700">{label}</td>
                {effective.series.map((s, i) => (
                  <td key={i} className={`px-2 py-1 text-right tabular-nums ${s.included ? "bg-sky-50" : "text-slate-300"}`}>
                    {s.values[r] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {effective.labels.length > PREVIEW_ROWS && <p className="px-2 py-1 text-xs text-slate-400">+ {effective.labels.length - PREVIEW_ROWS} more rows</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-slate-500">
          Units: <b className="text-slate-800">{effective.units.prefix || effective.units.suffix ? `${effective.units.prefix}1${effective.units.suffix}` : "none"}</b>
        </span>
        <label className="flex items-center gap-1.5 text-slate-500">
          Chart
          <select aria-label="Suggested chart type" className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800" value={chosen} onChange={(e) => setChart(e.target.value as ChartType)}>
            {CHART_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
                {o.value === table.chart ? " (suggested)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-slate-500">
          <select aria-label="Import mode" className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800" value={mode} onChange={(e) => setMode(e.target.value as ImportMode)}>
            <option value="replace">Replace chart data</option>
            <option value="append">Add as new series</option>
          </select>
        </label>
        <div className="flex-1" />
        <button
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          disabled={count === 0}
          onClick={commit}
        >
          Import {cells} value{cells === 1 ? "" : "s"}
        </button>
      </div>
      <p className="text-xs text-slate-400">Imported cells are tinted in the Data Table until you edit or confirm them.</p>
    </div>
  );
}

function PasteTab({ initial, onDone }: { initial: string; onDone: () => void }) {
  const [text, setText] = useState(initial);
  const table = useMemo(() => parsePastedText(text), [text]);
  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <div className="flex w-[300px] shrink-0 flex-col gap-2">
        <textarea
          autoFocus
          aria-label="Paste data"
          className="min-h-0 flex-1 resize-none rounded-md border border-slate-200 p-2 font-mono text-xs focus:border-indigo-400 focus:outline-none"
          placeholder={"Paste a spreadsheet range, CSV/TSV, a markdown table, JSON, a bulleted list, or even a sentence with numbers.\n\nExample:\nQuarter\tRevenue\nQ1\t$4.2M\nQ2\t$5.1M"}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <p className="text-xs text-slate-400">Parsed locally with fixed rules. Nothing leaves your browser.</p>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {table ? <ParsedPreview key={text} table={table} provenance="PARSED" onDone={onDone} /> : <p className="m-auto text-sm text-slate-400">{text.trim() ? "No numbers found yet." : "Paste data on the left to preview it here."}</p>}
      </div>
    </div>
  );
}

export function ImportModal() {
  const { importTab, importSeed, closeImport } = useUiStore();
  const [tab, setTab] = useState(importTab);
  // A new ⌘V while the modal is open can switch tabs.
  useEffect(() => setTab(importTab), [importTab, importSeed]);
  const tabBtn = (id: "text" | "screenshot", label: string) => (
    <button
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`rounded-md px-3 py-1.5 text-sm ${tab === id ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-600 hover:bg-slate-50"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-6" onMouseDown={(e) => e.target === e.currentTarget && closeImport()}>
      <div role="dialog" aria-label="Import data" className="flex h-full max-h-[720px] w-full max-w-[1040px] flex-col gap-3 overflow-hidden rounded-xl bg-white p-5 shadow-2xl">
        <div className="flex items-center gap-2">
          <h2 className="mr-3 text-base font-semibold text-slate-900">Import data</h2>
          <div role="tablist" className="flex gap-1">
            {tabBtn("text", "Paste text")}
            {tabBtn("screenshot", "Screenshot")}
          </div>
          <div className="flex-1" />
          <button aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={closeImport}>
            <X size={18} />
          </button>
        </div>
        {tab === "text" ? <PasteTab initial={importSeed?.text ?? ""} onDone={closeImport} /> : <ScreenshotTab seed={importSeed?.image ?? null} onDone={closeImport} />}
      </div>
    </div>
  );
}
