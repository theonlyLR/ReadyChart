import { create } from "zustand";
import type { TextField } from "../engine/textTargets";
import type { ExportFormat } from "../export/pipeline";
import type { Platform } from "../components/FlightCheck/safeZones";

export type Backdrop = "checker" | "dark" | "white";

/** Ephemeral UI chrome only. Never chart data, styling or animation state (that lives in ChartDocument). */
interface UiState {
  flightCheckOpen: boolean;
  setFlightCheckOpen: (open: boolean) => void;
  /** Import Data modal (ephemeral chrome). `importTab` picks the tab it opens on. */
  importOpen: boolean;
  importTab: "text" | "screenshot";
  /** Text or image waiting to be loaded into the Import modal (from ⌘V or drag/drop). Throwaway input, never chart state. */
  importSeed: { text?: string; image?: Blob } | null;
  openImport: (tab: "text" | "screenshot", seed?: { text?: string; image?: Blob }) => void;
  closeImport: () => void;
  /** Flips true once Inter is loaded, so layout re-measures with real glyph widths. */
  fontsReady: boolean;
  /** Bumped whenever another brand font finishes loading, so layout re-measures. */
  fontsVersion: number;
  /** Canvas text field currently being edited inline (ephemeral UI; the text itself lives in the document). */
  editingField: TextField | null;
  setEditingField: (f: TextField | null) => void;
  /** Flight Check export settings. */
  exportFormat: ExportFormat;
  exportScale: number;
  exportFps: number;
  backdrop: Backdrop;
  safeZone: Platform | null;
  /** Timeline transport (ephemeral). null = resting frame (end of hero, so editing shows the finished chart). */
  playheadMs: number | null;
  playing: boolean;
  loop: boolean;
  setPlayheadMs: (ms: number | null) => void;
  setPlaying: (playing: boolean) => void;
  setLoop: (loop: boolean) => void;
  setExport: (patch: Partial<Pick<UiState, "exportFormat" | "exportScale" | "exportFps" | "backdrop" | "safeZone">>) => void;
}

export const useUiStore = create<UiState>((set) => ({
  flightCheckOpen: false,
  setFlightCheckOpen: (flightCheckOpen) => set({ flightCheckOpen }),
  importOpen: false,
  importTab: "text",
  importSeed: null,
  openImport: (importTab, seed) => set({ importOpen: true, importTab, importSeed: seed ?? null }),
  closeImport: () => set({ importOpen: false, importSeed: null }),
  fontsReady: false,
  fontsVersion: 0,
  editingField: null,
  setEditingField: (editingField) => set({ editingField }),
  exportFormat: "png",
  exportScale: 2,
  exportFps: 30,
  backdrop: "checker",
  safeZone: null,
  playheadMs: null,
  playing: false,
  loop: true,
  setPlayheadMs: (playheadMs) => set({ playheadMs }),
  setPlaying: (playing) => set({ playing }),
  setLoop: (loop) => set({ loop }),
  setExport: (patch) => set(patch),
}));
