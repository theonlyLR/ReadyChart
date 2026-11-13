import type { ReactNode } from "react";
import { useDocumentStore } from "../../store/documentStore";
import { CommitInput } from "../CommitInput";

const label = "text-xs font-medium text-slate-600";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-slate-100 px-4 py-3">
      <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}

/** One drag = one undo step: the store transaction opens on pointer-down and commits on release/blur. */
export function SliderField({ label: text, value, min, max, step = 1, onChange, format }: SliderProps) {
  const { beginTransaction, commitTransaction } = useDocumentStore.getState();
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between">
        <span className={label}>{text}</span>
        <span className="text-xs tabular-nums text-slate-500">{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        className="w-full accent-indigo-600"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={beginTransaction}
        onPointerUp={commitTransaction}
        onPointerCancel={commitTransaction}
        onBlur={commitTransaction}
        onKeyDown={beginTransaction}
        onKeyUp={commitTransaction}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function ToggleField({ label: text, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between">
      <span className={label}>{text}</span>
      <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function SelectField<T extends string>({ label: text, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className={label}>{text}</span>
      <select className="min-w-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TextField({ label: text, value, onCommit, placeholder }: { label: string; value: string; onCommit: (v: string) => void; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={label}>{text}</span>
      <CommitInput ariaLabel={text} className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" value={value} placeholder={placeholder} onCommit={onCommit} />
    </label>
  );
}

/** Colour picker; the whole picker interaction is one undo step. */
export function ColorField({ value, onChange, ariaLabel, label: text }: { value: string; onChange: (v: string) => void; ariaLabel?: string; label?: string }) {
  const { beginTransaction, commitTransaction } = useDocumentStore.getState();
  const input = (
    <input
      type="color"
      aria-label={ariaLabel ?? text}
      className="h-6 w-8 shrink-0 cursor-pointer rounded border border-slate-200 bg-transparent p-0"
      value={value}
      onFocus={beginTransaction}
      onBlur={commitTransaction}
      onChange={(e) => onChange(e.target.value)}
    />
  );
  if (!text) return input;
  return (
    <label className="flex items-center justify-between">
      <span className={label}>{text}</span>
      {input}
    </label>
  );
}
