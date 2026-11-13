import type { Patch } from "immer";

export interface HistoryEntry {
  patches: Patch[];
  inverse: Patch[];
}

export interface History {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export const HISTORY_LIMIT = 200;
export const emptyHistory = (): History => ({ past: [], future: [] });

/** A new edit always clears the redo stack. */
export function pushEntry(h: History, entry: HistoryEntry): History {
  const past = [...h.past, entry];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { past, future: [] };
}

export function popUndo(h: History): { history: History; entry: HistoryEntry } | null {
  const entry = h.past[h.past.length - 1];
  if (!entry) return null;
  return { entry, history: { past: h.past.slice(0, -1), future: [...h.future, entry] } };
}

export function popRedo(h: History): { history: History; entry: HistoryEntry } | null {
  const entry = h.future[h.future.length - 1];
  if (!entry) return null;
  return { entry, history: { past: [...h.past, entry], future: h.future.slice(0, -1) } };
}
