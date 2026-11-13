import { useEffect } from "react";
import { useDocumentStore } from "../store/documentStore";
import { useUiStore } from "../store/uiStore";
import { togglePlay } from "./usePlayback";

/** ⌘Z / ⇧⌘Z / ⌘Y. Leaves native text undo alone while typing in a field. */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range") || t.isContentEditable)) return;
      const onControl = !!t && (t.tagName === "BUTTON" || t.tagName === "SELECT");
      if (e.key === " " && !mod && !onControl && !useUiStore.getState().flightCheckOpen) {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (!mod) return;
      const k = e.key.toLowerCase();
      const { undo, redo } = useDocumentStore.getState();
      if (k === "z" && !e.shiftKey) undo();
      else if ((k === "z" && e.shiftKey) || k === "y") redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
