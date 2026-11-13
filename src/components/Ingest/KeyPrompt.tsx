import { useState } from "react";
import { retryScan } from "../../ingest/scanController";
import type { VisionProviderId } from "../../vision/visionSettings";
import { useVisionStore } from "../../vision/visionSettings";

const PROVIDERS: { id: VisionProviderId; label: string }[] = [
  { id: "gemini", label: "Gemini" },
  { id: "anthropic", label: "Claude" },
  { id: "openai", label: "OpenAI" },
];

/**
 * Minimal inline key prompt, shown only when no key is configured (.env.local or here). The key lives in this
 * browser's localStorage and goes only to the scan service; it never enters the document or an export.
 */
export function KeyPrompt() {
  const provider = useVisionStore((s) => s.provider);
  const storageError = useVisionStore((s) => s.error);
  const set = useVisionStore((s) => s.set);
  const [draft, setDraft] = useState("");
  const [choice, setChoice] = useState<VisionProviderId>(provider);
  const save = () => {
    if (!draft.trim()) return;
    set({ apiKey: draft.trim(), provider: choice });
    setDraft("");
    retryScan();
  };
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-slate-50 p-3">
      <div className="flex flex-wrap gap-2">
        <select aria-label="Provider" className="rounded-md border border-slate-200 bg-white px-2 py-1.5" value={choice} onChange={(e) => setChoice(e.target.value as VisionProviderId)}>
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <input
          type="password"
          autoComplete="off"
          aria-label="Vision API key"
          placeholder="API key"
          className="min-w-[8rem] flex-1 rounded-md border border-slate-200 px-2 py-1.5 focus:border-indigo-400 focus:outline-none"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        <button className="whitespace-nowrap rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-40" disabled={!draft.trim()} onClick={save}>
          Save & scan
        </button>
      </div>
      <p className="text-xs text-slate-500">Or add GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY to .env.local and restart the dev server. Stored only in this browser.</p>
      {storageError && <p className="text-xs text-rose-600">{storageError}</p>}
    </div>
  );
}
