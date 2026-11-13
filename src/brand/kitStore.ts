import { create } from "zustand";
import type { ChartDocument } from "../model/types";
import { useDocumentStore } from "../store/documentStore";
import { applyKitToDraft, customFontTooLargeForKit, KIT_STORAGE_KEY, kitFromDoc, MAX_KITS, parseKits, serializeKits } from "./kits";
import type { BrandKit } from "./kits";

type KitStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): KitStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked (private mode / disabled site data)
  }
}

export function loadKits(storage: KitStorage | null = defaultStorage()): BrandKit[] {
  try {
    return parseKits(storage?.getItem(KIT_STORAGE_KEY) ?? null);
  } catch {
    return [];
  }
}

/** Returns an error message when the write failed (quota, blocked storage), else null. */
export function persistKits(kits: BrandKit[], storage: KitStorage | null = defaultStorage()): string | null {
  if (!storage) return "Browser storage is unavailable, so kits won't be remembered.";
  try {
    storage.setItem(KIT_STORAGE_KEY, serializeKits(kits));
    return null;
  } catch {
    return "Couldn't save: browser storage is full. Delete a kit or use a smaller logo.";
  }
}

const newId = (): string => globalThis.crypto?.randomUUID?.() ?? `kit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The Brand Kit vault is an app-level library (like a saved-templates list), not chart state, so it lives in its
 * own persisted store. Applying a kit goes through the ChartDocument store as a single undoable update.
 */
interface KitState {
  kits: BrandKit[];
  /** Last storage problem, shown in the UI. */
  error: string | null;
  save: (doc: ChartDocument, name: string) => boolean;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  apply: (id: string) => void;
  reload: () => void;
}

export const useKitStore = create<KitState>((set, get) => {
  const commit = (kits: BrandKit[]): boolean => {
    const error = persistKits(kits);
    // Keep the in-memory vault even if persisting failed, so the session still works; surface the reason.
    set({ kits, error });
    return error === null;
  };
  return {
    kits: loadKits(),
    error: null,
    save: (doc, name) => {
      const { kits } = get();
      if (kits.length >= MAX_KITS) {
        set({ error: `The vault holds up to ${MAX_KITS} kits. Delete one first.` });
        return false;
      }
      const ok = commit([...kits, kitFromDoc(doc, name, newId())]);
      if (ok && customFontTooLargeForKit(doc)) set({ error: "Kit saved, but its uploaded font is over 1.5 MB, so the kit uses Inter instead. Use a smaller font file to include it." });
      return ok;
    },
    rename: (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      commit(get().kits.map((k) => (k.id === id ? { ...k, name: trimmed.slice(0, 60) } : k)));
    },
    remove: (id) => void commit(get().kits.filter((k) => k.id !== id)),
    apply: (id) => {
      const kit = get().kits.find((k) => k.id === id);
      if (kit) useDocumentStore.getState().update((d) => applyKitToDraft(d, kit));
    },
    reload: () => set({ kits: loadKits(), error: null }),
  };
});
