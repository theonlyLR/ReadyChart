import { useEffect } from "react";
import { ingestFile, ingestText } from "../ingest/ingest";
import { startScan } from "../ingest/scanController";
import { useUiStore } from "../store/uiStore";

const typing = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT" || el.isContentEditable);
};

const hasFiles = (e: DragEvent): boolean => [...(e.dataTransfer?.types ?? [])].includes("Files");

/**
 * Zero-modal ingest. ⌘V anywhere (outside a text field) or a file dropped anywhere on the window:
 * an image starts the scan, text / CSV / TSV builds a chart immediately with an Undo toast.
 */
export function useGlobalIngest(): void {
  useEffect(() => {
    const blocked = () => useUiStore.getState().flightCheckOpen;

    const onPaste = (e: ClipboardEvent) => {
      if (typing(e.target) || blocked()) return;
      const image = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (image) {
        e.preventDefault();
        void startScan(image);
        return;
      }
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (text.trim() !== "") {
        e.preventDefault();
        ingestText(text);
      }
    };

    // dragenter/dragleave also fire for every child element, so count them to know when the pointer truly left.
    let depth = 0;
    const setActive = (v: boolean) => useUiStore.getState().setDropActive(v);
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e) || blocked()) return;
      e.preventDefault();
      depth++;
      setActive(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e) || blocked()) return;
      e.preventDefault(); // required, or the browser navigates to the dropped file
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setActive(false);
      if (blocked()) return;
      const files = [...(e.dataTransfer?.files ?? [])];
      const file = files.find((f) => f.type.startsWith("image/")) ?? files[0];
      if (file) void ingestFile(file);
    };

    window.addEventListener("paste", onPaste);
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);
}
