import { create } from "zustand";
import { DEFAULT_VISION_MODEL } from "./anthropicProvider";

export const VISION_STORAGE_KEY = "readychart.vision.v1";

export interface VisionSettings {
  apiKey: string;
  model: string;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked (private mode / disabled site data)
  }
}

export function parseVisionSettings(raw: string | null): VisionSettings {
  const empty: VisionSettings = { apiKey: "", model: DEFAULT_VISION_MODEL };
  if (!raw) return empty;
  try {
    const o = JSON.parse(raw) as Partial<VisionSettings> | null;
    return {
      apiKey: typeof o?.apiKey === "string" ? o.apiKey.trim() : "",
      model: typeof o?.model === "string" && o.model.trim() ? o.model.trim() : DEFAULT_VISION_MODEL,
    };
  } catch {
    return empty;
  }
}

export function loadVisionSettings(storage: Store | null = defaultStorage()): VisionSettings {
  try {
    return parseVisionSettings(storage?.getItem(VISION_STORAGE_KEY) ?? null);
  } catch {
    return parseVisionSettings(null);
  }
}

/** Returns an error message when the write failed, else null. */
export function persistVisionSettings(s: VisionSettings, storage: Store | null = defaultStorage()): string | null {
  if (!storage) return "Browser storage is unavailable, so the key won't be remembered after you close this tab.";
  try {
    if (s.apiKey === "") storage.removeItem(VISION_STORAGE_KEY);
    else storage.setItem(VISION_STORAGE_KEY, JSON.stringify(s));
    return null;
  } catch {
    return "Couldn't save: browser storage is full or blocked.";
  }
}

/**
 * App-level setting (like the Brand Kit vault), not chart state. The key never enters the ChartDocument, an export
 * or a log; it is only read when the user clicks Extract.
 */
interface VisionState extends VisionSettings {
  error: string | null;
  set: (patch: Partial<VisionSettings>) => void;
  clearKey: () => void;
}

export const useVisionStore = create<VisionState>((set, get) => ({
  ...loadVisionSettings(),
  error: null,
  set: (patch) => {
    const next = { apiKey: get().apiKey, model: get().model, ...patch };
    set({ ...next, error: persistVisionSettings(next) });
  },
  clearKey: () => get().set({ apiKey: "" }),
}));
