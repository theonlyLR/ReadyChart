import { create } from "zustand";
import { applyPatches, enablePatches, produceWithPatches } from "immer";
import type { Draft } from "immer";
import type { ChartDocument } from "../model/types";
import { createDefaultDocument } from "../model/defaults";
import { emptyHistory, popRedo, popUndo, pushEntry } from "./history";
import type { History, HistoryEntry } from "./history";

enablePatches();

interface DocumentState extends History {
  doc: ChartDocument;
  /** Open while a slider drag is in progress; coalesces many updates into one undo step. */
  txn: HistoryEntry | null;
  update: (recipe: (draft: Draft<ChartDocument>) => void) => void;
  beginTransaction: () => void;
  commitTransaction: () => void;
  undo: () => void;
  redo: () => void;
  /** Replace the whole document (load fixture / import). Recorded as one undoable step. */
  replaceDoc: (doc: ChartDocument) => void;
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  doc: createDefaultDocument(),
  ...emptyHistory(),
  txn: null,

  update: (recipe) => {
    const { doc, txn } = get();
    const [next, patches, inverse] = produceWithPatches(doc, recipe);
    if (patches.length === 0) return;
    if (txn) {
      set({ doc: next, txn: { patches: [...txn.patches, ...patches], inverse: [...inverse, ...txn.inverse] } });
    } else {
      set((s) => ({ doc: next, ...pushEntry(s, { patches, inverse }) }));
    }
  },

  beginTransaction: () => {
    if (!get().txn) set({ txn: { patches: [], inverse: [] } });
  },

  commitTransaction: () => {
    const { txn } = get();
    if (!txn) return;
    if (txn.patches.length === 0) set({ txn: null });
    else set((s) => ({ txn: null, ...pushEntry(s, txn) }));
  },

  undo: () => {
    if (get().txn) get().commitTransaction();
    const s = get();
    const r = popUndo(s);
    if (r) set({ doc: applyPatches(s.doc, r.entry.inverse), ...r.history });
  },

  redo: () => {
    if (get().txn) get().commitTransaction();
    const s = get();
    const r = popRedo(s);
    if (r) set({ doc: applyPatches(s.doc, r.entry.patches), ...r.history });
  },

  replaceDoc: (doc) => {
    get().update((d) => {
      Object.assign(d, doc);
    });
  },
}));
