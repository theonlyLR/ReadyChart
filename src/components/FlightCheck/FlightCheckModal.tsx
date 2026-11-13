import { useEffect, useRef, useState } from "react";
import { Download, X, Zap } from "lucide-react";
import { useDocumentStore } from "../../store/documentStore";
import { useUiStore } from "../../store/uiStore";
import type { Backdrop } from "../../store/uiStore";
import { isAnimated, renderAnimated, renderStatic } from "../../export/pipeline";
import type { AnimatedFormat, ExportFormat } from "../../export/pipeline";
import { BUDGET_BYTES, DEFAULT_FPS, FIT_LADDER, FPS_OPTIONS } from "../../export/animated/options";
import { downloadBlob, fileNameFor } from "../../export/download";
import { PLATFORMS, safeZone } from "./safeZones";

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
  const { exportFormat: format, exportScale: scale, exportFps: fps, backdrop, safeZone: platform, loop, setLoop, setExport, setFlightCheckOpen } = useUiStore();
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fitNote, setFitNote] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** A blob Fit-under-5-MB already encoded for exactly these settings, so the preview effect doesn't encode it twice. */
  const readyRef = useRef<{ doc: typeof doc; key: string; blob: Blob } | null>(null);
  const { width, height } = doc.canvas;
  const animated = isAnimated(format);
  const motionOn = doc.motion.enabled;

  const showBlob = (blob: Blob) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(blob);
    setPreview({ blob, url: urlRef.current });
    setError(null);
  };

  // Preview = the exact export bytes (same pipeline as Download), so size, palette and motion are real.
  useEffect(() => {
    const ctl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctl;
    const key = `${format}|${scale}|${fps}|${loop}`;
    const ready = readyRef.current;
    if (ready && ready.doc === doc && ready.key === key) {
      readyRef.current = null;
      showBlob(ready.blob);
      setBusy(false);
      return () => ctl.abort();
    }
    if (animated && !motionOn) {
      setBusy(false);
      setPreview(null);
      return () => ctl.abort();
    }
    setBusy(true);
    setProgress(null);
    const job = async () => {
      if (isAnimated(format)) {
        await new Promise((r) => setTimeout(r, 350)); // debounce slider drags before spinning up a worker
        if (ctl.signal.aborted) return;
        const res = await renderAnimated(doc, { format, fps, scale, loop, signal: ctl.signal, onProgress: (d, t) => setProgress(d / t) });
        if ("blob" in res) showBlob(res.blob);
      } else {
        showBlob(await renderStatic(doc, { format, scale }));
      }
    };
    job()
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!ctl.signal.aborted) {
          setBusy(false);
          setProgress(null);
        }
      });
    return () => ctl.abort();
  }, [doc, format, scale, fps, loop, animated, motionOn]);

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

  const selectFormat = (v: ExportFormat) => {
    const patch: { exportFormat: ExportFormat; exportFps?: number } = { exportFormat: v };
    if (isAnimated(v) && !FPS_OPTIONS[v].includes(fps)) patch.exportFps = DEFAULT_FPS[v];
    setFitNote(null);
    setExport(patch);
  };

  const fitUnderBudget = async () => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy(true);
    setFitNote(null);
    setError(null);
    try {
      if (isAnimated(format)) {
        const ladder = FIT_LADDER[format as AnimatedFormat];
        for (const step of ladder) {
          setFitNote(`Trying ${step.fps} fps at ${step.scale}×…`);
          setProgress(0);
          const res = await renderAnimated(doc, { format, ...step, loop, maxBytes: BUDGET_BYTES, signal: ctl.signal, onProgress: (d, t) => setProgress(d / t) });
          if ("blob" in res && res.blob.size <= BUDGET_BYTES) {
            readyRef.current = { doc, key: `${format}|${step.scale}|${step.fps}|${loop}`, blob: res.blob };
            setExport({ exportScale: step.scale, exportFps: step.fps });
            setFitNote(`Fits at ${step.fps} fps, ${step.scale}× (${formatBytes(res.blob.size)}).`);
            return;
          }
        }
        const last = ladder[ladder.length - 1]!;
        setExport({ exportScale: last.scale, exportFps: last.fps });
        setFitNote(`Still over 5 MB at ${last.fps} fps, ${last.scale}×. Try ${format === "gif" ? "Animated WebP" : "a shorter hold or fewer categories"}.`);
        return;
      }
      for (const s of FIT_SCALES) {
        const blob = await renderStatic(doc, { format: format as Exclude<ExportFormat, AnimatedFormat | "svg">, scale: s });
        if (blob.size <= BUDGET_BYTES) {
          setExport({ exportScale: s });
          setFitNote(`Fits at ${s}× (${formatBytes(blob.size)}).`);
          return;
        }
      }
      setFitNote("Still over 5 MB at 1×. Try WebP or JPG, or simplify the chart.");
      setExport({ exportScale: 1 });
    } catch (e) {
      if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!ctl.signal.aborted) {
        setBusy(false);
        setProgress(null);
      }
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
          {busy && (
            <div className="absolute left-4 top-4 rounded bg-white/90 px-2 py-1 text-xs text-slate-600 shadow">
              {progress !== null ? `Encoding ${Math.round(progress * 100)}%` : "Rendering…"}
            </div>
          )}
        </div>

        <div className="flex w-[320px] shrink-0 flex-col gap-5 overflow-auto border-l border-slate-200 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Flight Check</h2>
            <button aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={() => setFlightCheckOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <Segmented<ExportFormat>
            label="Format"
            value={format}
            onChange={selectFormat}
            options={[
              { value: "svg", label: "SVG" },
              { value: "png", label: "PNG" },
              { value: "jpg", label: "JPG" },
              { value: "webp", label: "WebP" },
              { value: "gif", label: "GIF", disabled: !motionOn, hint: motionOn ? "Animated, 256 locked colors" : "Enable motion to export animation" },
              { value: "awebp", label: "Animated WebP", disabled: !motionOn, hint: motionOn ? "Animated, full color" : "Enable motion to export animation" },
            ]}
          />
          {animated && (
            <Segmented<number>
              label="Frame rate"
              value={fps}
              onChange={(v) => setExport({ exportFps: v })}
              options={FPS_OPTIONS[format as AnimatedFormat].map((f) => ({ value: f, label: `${f} fps` }))}
            />
          )}
          {animated && (
            <label className="flex items-center justify-between text-xs font-medium text-slate-600">
              <span>Loop (off = plays once and stops)</span>
              <input type="checkbox" aria-label="Loop" className="h-4 w-4 accent-indigo-600" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
            </label>
          )}
          {format === "gif" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              The preview is the real GIF: one locked 256-color palette sampled from the fully built chart, 50 fps max (GIF timing is 1/100 s).
              <button className="mt-2 block rounded-md border border-amber-300 bg-white px-2.5 py-1 font-medium hover:bg-amber-100" onClick={() => selectFormat("awebp")}>
                Switch to Animated WebP (full color)
              </button>
            </div>
          )}
          {animated && !motionOn && <p className="text-xs text-amber-700">Enable motion in the studio to export an animation.</p>}
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
              Budget 5 MB · {animated ? `${Math.round(width * scale)}×${Math.round(height * scale)} px · ${fps} fps` : isSvg ? `${width}×${height} vector` : `${Math.round(width * scale)}×${Math.round(height * scale)} px`}
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
            <Download size={16} /> Download {format === "awebp" ? "ANIMATED WEBP" : format.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}
