import { Check, Plus, X } from "lucide-react";
import type { CellProvenance } from "../../model/types";
import { addRow, addSeries, confirmAll, confirmCell, isUnverified, itemColorsActive, parseCellNumber, unverifiedCount, removeRow, removeSeries, setCell, setLabel, setSeriesName, setSliceColor } from "../../model/dataOps";
import { SERIES_PALETTE } from "../../model/defaults";
import { useRef } from "react";
import { useDocumentStore } from "../../store/documentStore";
import { CommitInput } from "../CommitInput";
import { ColorField } from "../Inspector/fields";
import { splitGradient } from "./swatch";
import { ColumnResizer } from "./ColumnResizer";
import { ICON_BTN, INPUT_PAD, LABEL_MAX, LABEL_MIN, REMOVE_COL, SERIES_DEFAULT, SERIES_MAX, SERIES_MIN, SWATCH, autoFit } from "./columns";
import { getMeasurer } from "../../render/measurer";
import { useUiStore } from "../../store/uiStore";

const TINT: Record<CellProvenance, string> = {
  USER_INPUT: "",
  PARSED: "bg-sky-50",
  OCR_EXACT: "bg-emerald-50",
  AXIS_MEASURED: "bg-violet-100",
  LOW_CONFIDENCE: "bg-amber-100",
  ESTIMATED: "bg-amber-100",
  MISSING: "bg-rose-50",
};

const HINT: Record<CellProvenance, string> = {
  USER_INPUT: "Entered or confirmed by you",
  PARSED: "Parsed from pasted text. Check it, then confirm",
  OCR_EXACT: "Read from a printed label in the screenshot. Check it",
  AXIS_MEASURED: "Estimated from pixel positions. Check it",
  LOW_CONFIDENCE: "Low-confidence extraction. Check it",
  ESTIMATED: "Estimated from the bar's measured size. Check it",
  MISSING: "Missing",
};

const cell = "w-full min-w-0 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-slate-200 focus:border-indigo-400 focus:bg-white focus:outline-none";

export function DataTable() {
  const data = useDocumentStore((s) => s.doc.data);
  const update = useDocumentStore((s) => s.update);
  const unverified = unverifiedCount(data);
  const type = useDocumentStore((s) => s.doc.geometry.type);
  const radial = type === "pie" || type === "donut";
  // Single-series bars with their own colours: every row gets a swatch (like pie slices) and the header swatch splits.
  const perBar = (type === "bar" || type === "horizontal-bar") && itemColorsActive(data);
  // Column widths live in the UI store, not the document: resizing is never an undo step and never reaches an export.
  const labelColWidth = useUiStore((s) => s.labelColWidth);
  const seriesColWidths = useUiStore((s) => s.seriesColWidths);
  const { setLabelColWidth, setSeriesColWidth } = useUiStore.getState();
  const labelTh = useRef<HTMLTableCellElement>(null);
  const seriesTh = useRef<Record<string, HTMLTableCellElement | null>>({});
  const m = getMeasurer();
  const text = (s: string, weight = 400) => m.width(s, 14, weight);
  const hasSwatch = radial || perBar;
  // Auto Label width fills the panel (100%). Once the Label column has an explicit width the table is exactly the sum of
  // its columns, so shrinking a column leaves blank space on the right like a spreadsheet instead of stretching the others.
  const tableWidth = labelColWidth === null ? "100%" : `${labelColWidth + data.series.reduce((sum, s) => sum + (seriesColWidths[s.id] ?? SERIES_DEFAULT), 0) + REMOVE_COL}px`;

  /** Double-click: the widest label (or the "Label" header), plus the row swatch and cell padding. */
  const fitLabel = () => setLabelColWidth(autoFit([text("Label", 500) + INPUT_PAD, ...data.labels.map((l) => text(l) + INPUT_PAD + (hasSwatch ? SWATCH : 0))], LABEL_MIN, LABEL_MAX));
  /** Double-click: the widest number or the series name (plus its swatch and remove button). */
  const fitSeries = (si: number) => {
    const s = data.series[si]!;
    const header = text(s.name, 500) + INPUT_PAD + SWATCH + (data.series.length > 1 ? ICON_BTN : 0);
    const unverifiedHere = s.provenance.some((p) => isUnverified(p));
    const cells = s.values.map((v) => text(v === null || v === undefined ? "—" : String(v)) + INPUT_PAD + (unverifiedHere ? ICON_BTN - 6 : 0));
    setSeriesColWidth(s.id, autoFit([header, ...cells], SERIES_MIN, SERIES_MAX));
  };
  const barColor = (i: number) => data.series[0]?.pointColorOverrides?.[i] ?? data.series[0]?.color ?? SERIES_PALETTE[0]!;

  return (
    <section className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Data</h2>
        {unverified > 0 && (
          <button
            className="ml-auto mr-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-200"
            title="Mark every imported value as checked"
            onClick={() => update((d) => confirmAll(d.data))}
          >
            {unverified} unverified · Confirm all
          </button>
        )}
        <button className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50" onClick={() => update((d) => addSeries(d.data))}>
          <Plus size={14} /> Series
        </button>
      </div>

      <table className="table-fixed border-collapse text-left" style={{ width: tableWidth }}>
        {/* Numeric columns start compact; the Label column (no width until resized) takes the rest of the panel. */}
        <colgroup>
          <col style={labelColWidth === null ? undefined : { width: labelColWidth }} />
          {data.series.map((s) => (
            <col key={s.id} style={{ width: seriesColWidths[s.id] ?? SERIES_DEFAULT }} />
          ))}
          <col style={{ width: REMOVE_COL }} />
        </colgroup>
        <thead>
          <tr>
            <th ref={labelTh} className="relative pb-1 text-xs font-medium text-slate-500">
              Label
              <ColumnResizer ariaLabel="Resize Label column" getWidth={() => labelTh.current?.getBoundingClientRect().width ?? LABEL_MIN} onResize={setLabelColWidth} onAutoFit={fitLabel} />
            </th>
            {data.series.map((s, si) => (
              <th key={s.id} ref={(el) => void (seriesTh.current[s.id] = el)} className="relative pb-1 align-bottom">
                <div className="flex items-center gap-1">
                  {perBar && si === 0 ? (
                    <span
                      role="img"
                      aria-label="Per-bar colors"
                      title="Each bar has its own color. Edit them on the rows, or turn off Color each bar in the Inspector."
                      className="inline-block h-6 w-8 shrink-0 rounded border border-slate-200"
                      style={{ background: splitGradient(data.labels.map((_, i) => barColor(i))) }}
                    />
                  ) : (
                    <ColorField ariaLabel={`${s.name} color`} value={s.color} onChange={(c) => update((d) => void (d.data.series[si]!.color = c))} />
                  )}
                  <CommitInput
                    ariaLabel={`Series ${si + 1} name`}
                    title={s.name}
                    className={`${cell} font-medium`}
                    value={s.name}
                    selectOnFocus
                    onCommit={(v) => update((d) => setSeriesName(d.data, si, v))}
                  />
                  {data.series.length > 1 && (
                    <button aria-label={`Remove ${s.name}`} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600" onClick={() => update((d) => removeSeries(d.data, si))}>
                      <X size={14} />
                    </button>
                  )}
                </div>
                <ColumnResizer
                  ariaLabel={`Resize ${s.name} column`}
                  getWidth={() => seriesTh.current[s.id]?.getBoundingClientRect().width ?? SERIES_DEFAULT}
                  onResize={(w) => setSeriesColWidth(s.id, w)}
                  onAutoFit={() => fitSeries(si)}
                />
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {data.labels.map((label, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td>
                <div className="flex items-center gap-1">
                  {radial && (
                    <ColorField
                      ariaLabel={`${label} slice color`}
                      value={data.series[0]?.pointColorOverrides?.[i] ?? SERIES_PALETTE[i % SERIES_PALETTE.length]!}
                      onChange={(c) => update((d) => setSliceColor(d.data, i, c))}
                    />
                  )}
                  {perBar && <ColorField ariaLabel={`${label} bar color`} value={barColor(i)} onChange={(c) => update((d) => setSliceColor(d.data, i, c))} />}
                  <CommitInput ariaLabel={`Label ${i + 1}`} title={label} className={cell} value={label} onCommit={(v) => update((d) => setLabel(d.data, i, v))} />
                </div>
              </td>
              {data.series.map((s, si) => (
                <td key={s.id} className={`relative ${TINT[s.provenance[i] ?? "USER_INPUT"]}`} title={HINT[s.provenance[i] ?? "USER_INPUT"]}>
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
                  {isUnverified(s.provenance[i]) && (
                    <button
                      aria-label={`Confirm ${s.name} ${label}`}
                      title="Confirm this value"
                      className="absolute right-0.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-white hover:text-emerald-600"
                      onClick={() => update((d) => confirmCell(d.data, si, i))}
                    >
                      <Check size={12} />
                    </button>
                  )}
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
      <p className="mt-4 text-xs leading-relaxed text-slate-400">Enter or click away to commit. Empty cells are treated as missing. Tinted cells are imported or estimated values you haven't verified yet; editing or confirming one clears its tint.</p>
    </section>
  );
}
