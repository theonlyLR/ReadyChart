import { ImagePlus } from "lucide-react";
import { useUiStore } from "../../store/uiStore";

/** Full-viewport drop target shown while a file is dragged over the window. The drop itself is handled by useGlobalIngest. */
export function DropOverlay() {
  const active = useUiStore((s) => s.dropActive);
  if (!active) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-indigo-950/55 p-8 backdrop-blur-sm" aria-hidden>
      <div className="rc-rise flex h-full w-full max-w-5xl flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-indigo-200/80 bg-white/10 text-white">
        <ImagePlus size={44} strokeWidth={1.5} />
        <p className="text-xl font-semibold tracking-tight">Drop a chart screenshot</p>
        <p className="text-sm text-indigo-100">PNG, JPG or WebP. We'll scan it and rebuild the chart. CSV and TSV files work too.</p>
      </div>
    </div>
  );
}
