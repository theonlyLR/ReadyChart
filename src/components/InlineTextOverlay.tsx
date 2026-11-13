import { useRef, useState } from "react";
import type { ChartDocument } from "../model/types";
import type { LayoutResult } from "../engine/layout";
import { themeFor } from "../engine/theme";
import { textTargets } from "../engine/textTargets";
import type { TextField, TextTarget } from "../engine/textTargets";
import { fontStack } from "../engine/fonts";
import { useDocumentStore } from "../store/documentStore";
import { useUiStore } from "../store/uiStore";

const FIELD_LABEL: Record<TextField, string> = { title: "title", subtitle: "subtitle", sourceFooter: "source footer" };

interface EditorProps {
  value: string;
  target: TextTarget;
  doc: ChartDocument;
  onDone: (next: string | null) => void;
}

/**
 * Edits a throwaway draft and writes to the ChartDocument once (Enter/blur), so a text edit is one undo step.
 * Esc reverts. It is opaque and exactly covers the drawn text so the SVG underneath is hidden while editing.
 */
function Editor({ value, target, doc, onDone }: EditorProps) {
  const { width: W, height: H, background, transparent, textColor } = doc.canvas;
  const theme = themeFor(background, transparent, textColor);
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  const finished = useRef(false);
  const { x, y, width, height } = target.rect;

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    const next = draft.replace(/\s*\n\s*/g, " ").trim();
    onDone(cancelled.current || next === value.trim() ? null : next);
  };

  return (
    <textarea
      autoFocus
      aria-label={`Edit ${FIELD_LABEL[target.field]}`}
      value={draft}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      className="absolute m-0 resize-none overflow-hidden border-0 p-0 outline outline-2 outline-indigo-500"
      style={{
        left: `${(x / W) * 100}%`,
        top: `${(y / H) * 100}%`,
        width: `${(width / W) * 100}%`,
        height: `${(height / H) * 100}%`,
        // Font size scales with the displayed canvas via container-query units (1cqw = 1% of its width).
        fontSize: `${(target.fontSize / W) * 100}cqw`,
        lineHeight: `${(target.lineHeight / W) * 100}cqw`,
        fontWeight: target.fontWeight,
        fontFamily: fontStack(doc.brand.fontFamily),
        color: target.tone === "ink" ? theme.ink : theme.muted,
        background: transparent ? "#FFFFFF" : background,
      }}
    />
  );
}

/** Transparent double-click targets over the title, subtitle and footer; mounts the inline editor on demand. */
export function InlineTextOverlay({ doc, layout }: { doc: ChartDocument; layout: LayoutResult }) {
  const editing = useUiStore((s) => s.editingField);
  const setEditing = useUiStore((s) => s.setEditingField);
  const update = useDocumentStore((s) => s.update);
  const { width: W, height: H } = doc.canvas;

  const commit = (field: TextField, next: string | null) => {
    if (next !== null) update((d) => void (d[field] = next));
    setEditing(null);
  };

  return (
    <>
      {textTargets(layout).map((t) =>
        editing === t.field ? (
          <Editor key={t.field} value={doc[t.field]} target={t} doc={doc} onDone={(next) => commit(t.field, next)} />
        ) : (
          <div
            key={t.field}
            role="button"
            tabIndex={0}
            aria-label={`Edit ${FIELD_LABEL[t.field]} (double-click)`}
            title="Double-click to edit"
            className="absolute cursor-text rounded-sm hover:outline hover:outline-1 hover:outline-indigo-300"
            style={{ left: `${(t.rect.x / W) * 100}%`, top: `${(t.rect.y / H) * 100}%`, width: `${(t.rect.width / W) * 100}%`, height: `${(t.rect.height / H) * 100}%` }}
            onDoubleClick={() => setEditing(t.field)}
            onKeyDown={(e) => e.key === "Enter" && setEditing(t.field)}
          />
        ),
      )}
    </>
  );
}
