import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useUiStore } from "../../store/uiStore";

/**
 * Draggable right edge of the Data panel (col-resize cursor, 240..460 px, clamped by the store). Lives on the border
 * between the panel and the canvas; the line turns indigo on hover and while dragging.
 */
export function PanelResizer() {
  const setWidth = useUiStore((s) => s.setDataPanelWidth);
  const [active, setActive] = useState(false);
  const drag = useRef<{ x: number; width: number } | null>(null);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, width: useUiStore.getState().dataPanelWidth };
    setActive(true);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) setWidth(drag.current.width + (e.clientX - drag.current.x));
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
      aria-label="Resize Data panel"
      title="Drag to resize the Data panel"
      className="group absolute -right-1 top-0 z-20 flex h-full w-2 cursor-col-resize touch-none select-none justify-center"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <span className={`h-full transition-colors ${active ? "w-0.5 bg-indigo-500" : "w-px bg-transparent group-hover:w-0.5 group-hover:bg-indigo-500"}`} />
    </div>
  );
}
