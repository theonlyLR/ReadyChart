import { useEffect } from "react";
import { X } from "lucide-react";
import { useUiStore } from "../../store/uiStore";

const AUTO_DISMISS_MS = 7000;

/** Floating toast with an optional 1-click action (Undo). */
export function ToastHost() {
  const toast = useUiStore((s) => s.toast);
  const dismiss = useUiStore((s) => s.dismissToast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [toast, dismiss]);
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex justify-center px-4">
      <div
        key={toast.id}
        role="status"
        className={`rc-rise pointer-events-auto flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm shadow-xl ${toast.tone === "error" ? "bg-rose-600 text-white" : "bg-slate-900 text-white"}`}
      >
        <span>{toast.message}</span>
        {toast.actionLabel && (
          <button className="rounded-md bg-white/15 px-2.5 py-1 font-medium hover:bg-white/25" onClick={toast.onAction}>
            {toast.actionLabel}
          </button>
        )}
        <button aria-label="Dismiss" className="rounded p-0.5 text-white/60 hover:text-white" onClick={dismiss}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
