import { useEffect, useRef, useState } from "react";
import { ChevronDown, ClipboardPaste, ImagePlus, Sparkles } from "lucide-react";
import { SCREENSHOT_MIME_TYPES } from "../ingest/image/loadImage";
import { ingestText } from "../ingest/ingest";
import { loadSampleScreenshot } from "../ingest/sample";
import { startScan } from "../ingest/scanController";
import { useUiStore } from "../store/uiStore";

const item = "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100";

/** The whole import surface: three actions, no modal. (⌘V and drag-and-drop work anywhere too.) */
export function ImportMenu() {
  const [open, setOpen] = useState(false);
  const [pasteBox, setPasteBox] = useState(false);
  const [draft, setDraft] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);

  const close = () => {
    setOpen(false);
    setPasteBox(false);
    setDraft("");
  };

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && close();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim() && ingestText(text)) return close();
    } catch {
      // Clipboard permission denied or unavailable: fall through to the inline box.
    }
    setPasteBox(true);
  };

  const trySample = async () => {
    close();
    try {
      await startScan(await loadSampleScreenshot(), { demo: true });
    } catch (e) {
      useUiStore.getState().showToast({ message: e instanceof Error ? e.message : "Couldn't load the sample.", tone: "error" });
    }
  };

  return (
    <div ref={root} className="relative">
      <button
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        title="Import a screenshot or data. You can also paste (⌘V) or drop a file anywhere."
      >
        <ClipboardPaste size={16} /> Import <ChevronDown size={14} className="text-slate-400" />
      </button>
      <input
        ref={file}
        type="file"
        hidden
        accept={SCREENSHOT_MIME_TYPES.join(",")}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void startScan(f);
        }}
      />
      {open && (
        <div role="menu" className="absolute left-0 top-full z-40 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
          <button
            role="menuitem"
            className={item}
            onClick={() => {
              close();
              file.current?.click();
            }}
          >
            <ImagePlus size={16} className="text-indigo-600" /> Upload Screenshot
          </button>
          <button role="menuitem" className={item} onClick={() => void pasteFromClipboard()}>
            <ClipboardPaste size={16} className="text-indigo-600" /> Paste Data / CSV
          </button>
          {pasteBox && (
            <div className="flex flex-col gap-2 px-2 pb-2 pt-1">
              <textarea
                autoFocus
                aria-label="Paste data"
                className="h-28 resize-none rounded-md border border-slate-200 p-2 font-mono text-xs focus:border-indigo-400 focus:outline-none"
                placeholder={"Paste a spreadsheet range or CSV/TSV:\nQuarter\tRevenue\nQ1\t$4.2M\nQ2\t$5.1M"}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button
                className="self-end rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                disabled={!draft.trim()}
                onClick={() => ingestText(draft) && close()}
              >
                Build chart
              </button>
            </div>
          )}
          <button role="menuitem" className={item} onClick={() => void trySample()}>
            <Sparkles size={16} className="text-amber-500" /> Try Sample Screenshot
          </button>
        </div>
      )}
    </div>
  );
}
