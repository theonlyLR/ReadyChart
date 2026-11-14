import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

interface Props {
  ariaLabel: string;
  /** Current rendered width of the column being resized (read at drag start). */
  getWidth: () => number;
  /** Called continuously with the raw new width; the store clamps it. */
  onResize: (width: number) => void;
  /** Double-click: snap the column to fit its content. */
  onAutoFit: () => void;
}

/**
 * Excel-style divider on the right edge of a column: a subtle line that turns into a crisp indigo bar on hover or drag,
 * with a col-resize cursor. Sits inside a `relative` header cell. Pointer capture keeps the drag smooth when the
 * cursor leaves the 8 px hit area.
 */
export function ColumnResizer({ ariaLabel, getWidth, onResize, onAutoFit }: Props) {
  const [active, setActive] = useState(false);
  const drag = useRef<{ x: number; width: number } | null>(null);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, width: getWidth() };
    setActive(true);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) onResize(drag.current.width + (e.clientX - drag.current.x));
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    setActive(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      title="Drag to resize. Double-click to fit."
      className="group absolute -right-1 top-0 z-10 flex h-full w-2 cursor-col-resize touch-none select-none justify-center"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={(e) => {
        e.preventDefault();
        onAutoFit();
      }}
    >
      <span className={`h-full transition-colors ${active ? "w-0.5 bg-indigo-500" : "w-px bg-slate-200 group-hover:w-0.5 group-hover:bg-indigo-500"}`} />
    </div>
  );
}
