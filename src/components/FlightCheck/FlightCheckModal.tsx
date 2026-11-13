import { useEffect, useRef, useState } from "react";
import { Download, X, Zap } from "lucide-react";
import { useDocumentStore } from "../../store/documentStore";
import { useUiStore } from "../../store/uiStore";
import type { Backdrop } from "../../store/uiStore";
import { renderStatic } from "../../export/pipeline";
import type { ExportFormat } from "../../export/pipeline";
import { downloadBlob, fileNameFor } from "../../export/download";
import { PLATFORMS, safeZone } from "./safeZones";

const BUDGET_BYTES = 5 * 1024 * 1024;
const FIT_SCALES = [2, 1.5, 1];
const CHECKER = "conic-gradient(#cbd5e1 25%, #f1f5f9 0 50%, #cbd5e1 0 75%, #f1f5f9 0) 0 0 / 20px 20px";
const BACKDROP_BG: Record<Backdrop, string> = { checker: CHECKER, dark: "#0F172A", white: "#FFFFFF" };

const formatBytes = (b: number) => (b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(2)} MB`);

function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T | null; options: { value: T; label: string; disabled?: boolean; hint?: string }[]; onChange: (v: T) => void }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={String(o.value)}
            disabled={o.disabled}
            title={o.hint}
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
            className={`rounded-md border px-2.5 py-1 text-sm ${o.value === value ? "border-indigo-600 bg-indigo-50 font-medium text-indigo-700" : "border-slate-200 text-slate-700 hover:bg-slate-50"} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FlightCheckModal() {
  const doc = useDocumentStore((s) => s.doc);
  const { exportFormat: format, exportScale: scale, backdrop, safeZone: platform, setExport, setFlightCheckOpen } = useUiStore();
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fitNote, setFitNote] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const { width, height } = doc.canvas;

  // Preview = the exact export blob (same pipeline as Download), so size and pixels are real.
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    renderStatic(doc, { format, scale })
      .then((blob) => {
        if (cancelled) return;
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = URL.createObjectURL(blob);
        setPreview({ blob, url: urlRef.current });
        setError(null);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [doc, format, scale]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFlightCheckOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setFlightCheckOpen]);

  const fitUnderBudget = async () => {
    setBusy(true);
    setFitNote(null);
    try {
      for (const s of FIT_SCALES) {
        const blob = await renderStatic(doc, { format, scale: s });
        if (blob.size <= BUDGET_BYTES) {
          setExport({ exportScale: s });
          setFitNote(`Fits at ${s}× (${formatBytes(blob.size)}).`);
          return;
        }
      }
      setFitNote("Still over 5 MB at 1×. Try WebP or JPG, or simplify the chart.");
      setExport({ exportScale: 1 });
    } finally {
      setBusy(false);
    }
  };

  const zone = platform ? safeZone(platform, width, height) : null;
  const size = preview?.blob.size ?? 0;
  const over = size > BUDGET_BYTES;
  const isSvg = format === "svg";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-6" onMouseDown={(e) => e.target === e.currentTarget && setFlightCheckOpen(false)}>
      <div role="dialog" aria-label="Flight Check" className="flex h-full max-h-[780px] w-full max-w-[1180px] overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="relative min-w-0 flex-1" style={{ background: BACKDROP_BG[backdrop], containerType: "size" }}>
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="relative overflow-hidden shadow-lg ring-1 ring-black/10" style={{ width: `min(calc(100cqw - 48px), calc((100cqh - 48px) * ${width} / ${height}))`, aspectRatio: `${width} / ${height}` }}>
              {preview && <img src={preview.url} alt="Export preview" className="block h-full w-full" draggable={false} />}
              {zone && (
                <div
                  className="pointer-events-none absolute border-2 border-dashed border-white"
                  style={{ left: `${zone.x * 100}%`, top: `${zone.y * 100}%`, width: `${zone.width * 100}%`, height: `${zone.height * 100}%`, boxShadow: "0 0 0 9999px rgba(15,23,42,0.55)" }}
                />
              )}
            </div>
          </div>
          {busy && <div className="absolute left-4 top-4 rounded bg-white/90 px-2 py-1 text-xs text-slate-600 shadow">Rendering…</div>}
        </div>

        <div className="flex w-[320px] shrink-0 flex-col gap-5 overflow-auto border-l border-slate-200 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Flight Check</h2>
            <button aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={() => setFlightCheckOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <Segmented<ExportFormat | "gif">
            label="Format"
            value={format}
            onChange={(v) => v !== "gif" && setExport({ exportFormat: v })}
            options={[
              { value: "svg", label: "SVG" },
              { value: "png", label: "PNG" },
              { value: "jpg", label: "JPG" },
              { value: "webp", label: "WebP" },
              { value: "gif", label: "GIF", disabled: true, hint: "Animated export arrives in Milestone 2" },
            ]}
          />
          <Segmented<number>
            label="Scale"
            value={scale}
            onChange={(v) => setExport({ exportScale: v })}
            options={[1, 1.5, 2].map((s) => ({ value: s, label: `${s}×`, disabled: isSvg }))}
          />
          <Segmented<Backdrop>
            label="Preview backdrop"
            value={backdrop}
            onChange={(v) => setExport({ backdrop: v })}
            options={[
              { value: "checker", label: "Transparent" },
              { value: "dark", label: "Dark slide" },
              { value: "white", label: "White paper" },
            ]}
          />
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Safe-zone overlay</div>
            <div className="flex flex-wrap gap-1">
              {PLATFORMS.map((p) => (
                <button
                  key={p.value}
                  aria-pressed={platform === p.value}
                  onClick={() => setExport({ safeZone: platform === p.value ? null : p.value })}
                  className={`rounded-md border px-2.5 py-1 text-sm ${platform === p.value ? "border-indigo-600 bg-indigo-50 font-medium text-indigo-700" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">File size</span>
              <span className={`text-sm font-semibold tabular-nums ${over ? "text-rose-600" : "text-slate-900"}`}>{preview ? formatBytes(size) : "—"}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full ${over ? "bg-rose-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, (size / BUDGET_BYTES) * 100)}%` }} />
            </div>
            <div className="mt-1.5 text-xs text-slate-500">
              Budget 5 MB · {isSvg ? `${width}×${height} vector` : `${Math.round(width * scale)}×${Math.round(height * scale)} px`}
            </div>
            {!isSvg && (
              <button disabled={busy} onClick={fitUnderBudget} className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
                <Zap size={14} /> Fit under 5 MB
              </button>
            )}
            {fitNote && <p className="mt-2 text-xs text-slate-600">{fitNote}</p>}
          </div>

          {format === "jpg" && doc.canvas.transparent && <p className="text-xs text-amber-700">JPG has no transparency; the background is flattened to white.</p>}
          {error && <p className="text-xs text-rose-600">Export failed: {error}</p>}

          <button
            disabled={!preview || busy}
            onClick={() => preview && downloadBlob(preview.blob, fileNameFor(doc.title, format, scale))}
            className="mt-auto inline-flex items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <Download size={16} /> Download {format.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}
