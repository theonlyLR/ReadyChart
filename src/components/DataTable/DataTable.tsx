import { Plus, X } from "lucide-react";
import type { CellProvenance } from "../../model/types";
import { addRow, addSeries, parseCellNumber, removeRow, removeSeries, setCell, setLabel } from "../../model/dataOps";
import { useDocumentStore } from "../../store/documentStore";
import { CommitInput } from "../CommitInput";
import { ColorField } from "../Inspector/fields";

const TINT: Record<CellProvenance, string> = {
  USER_INPUT: "",
  OCR_EXACT: "bg-emerald-50",
  AXIS_MEASURED: "bg-sky-50",
  LOW_CONFIDENCE: "bg-amber-100",
  MISSING: "bg-rose-50",
};

const cell = "w-full min-w-0 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-slate-200 focus:border-indigo-400 focus:bg-white focus:outline-none";

export function DataTable() {
  const data = useDocumentStore((s) => s.doc.data);
  const update = useDocumentStore((s) => s.update);

  return (
    <section className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Data</h2>
        <button className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50" onClick={() => update((d) => addSeries(d.data))}>
          <Plus size={14} /> Series
        </button>
      </div>

      <table className="w-full table-fixed border-collapse text-left">
        <thead>
          <tr>
            <th className="w-[84px] pb-1 text-xs font-medium text-slate-500">Label</th>
            {data.series.map((s, si) => (
              <th key={s.id} className="pb-1 align-bottom">
                <div className="flex items-center gap-1">
                  <ColorField ariaLabel={`${s.name} color`} value={s.color} onChange={(c) => update((d) => void (d.data.series[si]!.color = c))} />
                  <CommitInput
                    ariaLabel={`Series ${si + 1} name`}
                    className={`${cell} font-medium`}
                    value={s.name}
                    onCommit={(v) => update((d) => void (d.data.series[si]!.name = v))}
                  />
                  {data.series.length > 1 && (
                    <button aria-label={`Remove ${s.name}`} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600" onClick={() => update((d) => removeSeries(d.data, si))}>
                      <X size={14} />
                    </button>
                  )}
                </div>
              </th>
            ))}
            <th className="w-6" />
          </tr>
        </thead>
        <tbody>
          {data.labels.map((label, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td>
                <CommitInput ariaLabel={`Label ${i + 1}`} className={cell} value={label} onCommit={(v) => update((d) => setLabel(d.data, i, v))} />
              </td>
              {data.series.map((s, si) => (
                <td key={s.id} className={TINT[s.provenance[i] ?? "USER_INPUT"]} title={s.provenance[i]}>
                  <CommitInput
                    ariaLabel={`${s.name} ${label}`}
                    inputMode="decimal"
                    className={`${cell} text-right tabular-nums`}
                    value={s.values[i] === null || s.values[i] === undefined ? "" : String(s.values[i])}
                    placeholder="—"
                    onCommit={(text) => {
                      const parsed = parseCellNumber(text);
                      if (parsed !== undefined) update((d) => setCell(d.data, si, i, parsed));
                    }}
                  />
                </td>
              ))}
              <td>
                {data.labels.length > 1 && (
                  <button aria-label={`Remove row ${label}`} className="rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-rose-600" onClick={() => update((d) => removeRow(d.data, i))}>
                    <X size={14} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button className="mt-2 inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50" onClick={() => update((d) => addRow(d.data))}>
        <Plus size={14} /> Row
      </button>
      <p className="mt-4 text-xs leading-relaxed text-slate-400">Enter or click away to commit. Empty cells are treated as missing; cell tint shows data provenance.</p>
    </section>
  );
}
