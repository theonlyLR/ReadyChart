import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { useObjectUrl } from "../../hooks/useObjectUrl";
import { DOCK_MS, cancelScan, retryScan } from "../../ingest/scanController";
import { useUiStore } from "../../store/uiStore";

const STAGES = ["Detecting chart bounds & type...", "Sampling exact pixel palette...", "Reconstructing labels & data...", "Refining visual accuracy..."];
/** The request is one long wait, so the pill moves from step 1 to 2 on a timer; step 3 only on the real response. */
const STAGE_1_AFTER_MS = 1700;

/** Fixed pseudo-random "analysis" dots (percent of the card), so the layout never reshuffles between renders. */
const PINGS = [
  [14, 22], [38, 64], [62, 30], [81, 71], [27, 83], [72, 12], [51, 48], [90, 40],
] as const;

const BRACKET = "rc-bracket absolute h-6 w-6 border-indigo-400";

/**
 * Scan choreography, mounted over the studio canvas. Pure CSS/UI: the dim backdrop, the elevated card with
 * viewfinder brackets, a GPU-transformed laser scanline, pulsing sample dots and the stepped progress pill.
 * On success the card flies into the Compare pill (FLIP) while the chart behind it plays its entrance.
 */
export function ScanStage() {
  const scan = useUiStore((s) => s.scan);
  const url = useObjectUrl(scan.image);
  const cardRef = useRef<HTMLDivElement>(null);
  // Remember which image the timer fired for, so a new scan starts again at step 1 without resetting state in an effect.
  const [slowFor, setSlowFor] = useState<Blob | null>(null);
  const slow = slowFor !== null && slowFor === scan.image;

  useEffect(() => {
    const image = scan.image;
    if (scan.status !== "scanning" || !image) return;
    const t = setTimeout(() => setSlowFor(image), STAGE_1_AFTER_MS);
    return () => clearTimeout(t);
  }, [scan.status, scan.image]);

  const docking = scan.status === "docking";
  useEffect(() => {
    const card = cardRef.current;
    const target = document.getElementById("rc-compare-pill");
    if (!docking || !card || !target) return;
    // FLIP: measure both ends, then transition a single transform (GPU) from the card to the pill's centre.
    const a = card.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    const scale = Math.max(0.04, Math.min(b.width / a.width, b.height / a.height));
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    card.style.transition = `transform ${DOCK_MS}ms cubic-bezier(0.65, 0, 0.25, 1), opacity ${DOCK_MS}ms ease-in`;
    requestAnimationFrame(() => {
      card.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
      card.style.opacity = "0.2";
    });
  }, [docking]);

  if (scan.status === "idle" || !scan.image) return null;
  const stage = Math.max(scan.stage, slow ? 1 : 0);
  const failed = scan.status === "error";

  return (
    <div
      className={`absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 bg-slate-900/50 p-6 backdrop-blur-[2px] transition-opacity ${docking ? "pointer-events-none opacity-0" : "opacity-100"}`}
      style={{ transitionDuration: `${DOCK_MS}ms` }}
      role="dialog"
      aria-label="Scanning screenshot"
    >
      <div ref={cardRef} className="relative max-w-[min(720px,88%)] rounded-2xl bg-white p-2.5 shadow-2xl ring-1 ring-white/40">
        <div className="relative overflow-hidden rounded-xl">
          {url && <img src={url} alt="Screenshot being scanned" className="block max-h-[min(50vh,480px)] w-auto max-w-full select-none" draggable={false} />}
          {!failed && (
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
              <div className="rc-scanline absolute inset-x-0 top-0 h-[28%]">
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-indigo-400/10 to-indigo-400/35" />
                <div className="absolute inset-x-0 bottom-0 h-0.5 bg-indigo-200 shadow-[0_0_14px_4px_rgba(129,140,248,0.9)]" />
              </div>
              {PINGS.map(([x, y], i) => (
                <span key={i} className="rc-ping absolute h-2.5 w-2.5 rounded-full bg-indigo-400 shadow-[0_0_10px_3px_rgba(129,140,248,0.75)]" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${i * 0.23}s` }} />
              ))}
            </div>
          )}
        </div>
        <span className={`${BRACKET} -left-1.5 -top-1.5 rounded-tl-lg border-l-2 border-t-2`} aria-hidden />
        <span className={`${BRACKET} -right-1.5 -top-1.5 rounded-tr-lg border-r-2 border-t-2`} aria-hidden />
        <span className={`${BRACKET} -bottom-1.5 -left-1.5 rounded-bl-lg border-b-2 border-l-2`} aria-hidden />
        <span className={`${BRACKET} -bottom-1.5 -right-1.5 rounded-br-lg border-b-2 border-r-2`} aria-hidden />
      </div>

      {failed ? (
        <div className="rc-rise flex w-full max-w-md flex-col gap-3 rounded-xl bg-white p-4 text-sm shadow-xl">
          <p className="text-slate-800">{scan.error}</p>
          <div className="flex justify-end gap-2">
            <button className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100" onClick={cancelScan}>
              Close
            </button>
            <button className="rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700" onClick={retryScan}>
              Try again
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-full bg-white/95 py-2 pl-4 pr-2 text-sm text-slate-800 shadow-xl" aria-live="polite">
          <Loader2 size={16} className="animate-spin text-indigo-600" aria-hidden />
          <span className="relative grid h-5 w-[15.5rem]">
            {STAGES.map((label, i) => (
              <span key={label} className={`col-start-1 row-start-1 whitespace-nowrap transition-all duration-300 ${i === stage ? "translate-y-0 opacity-100" : i < stage ? "-translate-y-2 opacity-0" : "translate-y-2 opacity-0"}`}>
                {label}
              </span>
            ))}
          </span>
          <span className="flex gap-1" aria-hidden>
            {STAGES.map((_, i) => (
              <span key={i} className={`h-1.5 w-4 rounded-full transition-colors duration-300 ${i <= stage ? "bg-indigo-600" : "bg-slate-200"}`} />
            ))}
          </span>
          <button className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700 hover:bg-slate-200" onClick={cancelScan}>
            <X size={14} /> Cancel
          </button>
        </div>
      )}
      {scan.local && !scan.demo && !failed && <p className="-mt-2 text-xs text-white/70">Reading this chart on your device.</p>}
      {scan.demo && !failed && <p className="-mt-2 text-xs text-white/70">Demo screenshot with a bundled extraction. No API key needed.</p>}
    </div>
  );
}
