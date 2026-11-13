import { useState } from "react";
import { useDocumentStore } from "../../store/documentStore";
import { useKitStore } from "../../brand/kitStore";
import { CommitInput } from "../CommitInput";
import { Section } from "./fields";

const btn = "rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium hover:bg-slate-50";

export function BrandKitVault() {
  const kits = useKitStore((s) => s.kits);
  const error = useKitStore((s) => s.error);
  const { save, apply, remove, rename } = useKitStore.getState();
  const [name, setName] = useState("");
  // Ephemeral UI: which kit is awaiting delete confirmation.
  const [confirming, setConfirming] = useState<string | null>(null);

  const saveCurrent = () => {
    if (save(useDocumentStore.getState().doc, name || `Brand kit ${kits.length + 1}`)) setName("");
  };

  return (
    <Section title="Brand kits">
      <div className="flex gap-2">
        <input
          aria-label="Kit name"
          className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
          placeholder={`Brand kit ${kits.length + 1}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && saveCurrent()}
        />
        <button className={`${btn} shrink-0 border-indigo-300 text-indigo-700`} onClick={saveCurrent}>
          Save current
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {kits.length === 0 ? (
        <p className="text-xs text-slate-500">Save the current logo, palette, typeface and background as a reusable kit.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {kits.map((k) => (
            <li key={k.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-2" data-testid="brand-kit">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-slate-200" style={{ background: k.background }}>
                  {k.brand.logoDataUrl && <img src={k.brand.logoDataUrl} alt="" className="max-h-6 max-w-6 object-contain" />}
                </span>
                <CommitInput ariaLabel="Kit name" className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-sm font-medium hover:border-slate-200 focus:border-indigo-400 focus:outline-none" value={k.name} onCommit={(v) => rename(k.id, v)} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex gap-1">
                  {k.palette.slice(0, 6).map((c, i) => (
                    <span key={i} className="h-4 w-4 rounded-full border border-slate-200" style={{ background: c }} title={c} />
                  ))}
                </span>
                <span className="flex gap-1.5">
                  <button className={`${btn} text-indigo-700`} onClick={() => apply(k.id)}>
                    Apply
                  </button>
                  {confirming === k.id ? (
                    <button
                      className={`${btn} border-red-300 text-red-600`}
                      onClick={() => {
                        remove(k.id);
                        setConfirming(null);
                      }}
                      onBlur={() => setConfirming(null)}
                      autoFocus
                    >
                      Confirm delete
                    </button>
                  ) : (
                    <button className={`${btn} text-red-600`} onClick={() => setConfirming(k.id)}>
                      Delete
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
