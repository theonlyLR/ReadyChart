import { useRef, useState } from "react";

interface Props {
  value: string;
  onCommit: (value: string) => void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  inputMode?: "text" | "decimal";
  selectOnFocus?: boolean;
}

/**
 * Text input that edits a throwaway draft and writes to the ChartDocument once, on Enter/blur,
 * so typing a value is one undo step rather than one per keystroke. Escape reverts.
 */
export function CommitInput({ value, onCommit, className, placeholder, ariaLabel, inputMode, selectOnFocus }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);

  const finish = () => {
    if (!cancelled.current && draft !== null && draft !== value) onCommit(draft);
    cancelled.current = false;
    setDraft(null);
  };

  return (
    <input
      className={className}
      aria-label={ariaLabel}
      placeholder={placeholder}
      inputMode={inputMode}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={selectOnFocus ? (e) => e.currentTarget.select() : undefined}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
