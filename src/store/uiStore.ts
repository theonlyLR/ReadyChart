import { create } from "zustand";
import type { TextField } from "../engine/textTargets";
import type { ExportFormat } from "../export/pipeline";
import type { Platform } from "../components/FlightCheck/safeZones";
import { PANEL_DEFAULT, clampLabel, clampPanel, clampSeries } from "../components/DataTable/columns";

export type Backdrop = "checker" | "dark" | "white";

/** 0 detecting, 1 sampling, 2 reconstructing, 3 refining (closed-loop critique). */
/** Screenshot scan overlay. Pure UI state: the chart document is only touched when a scan succeeds. */
export interface ScanUi {
  /** "docking" = the result is applied and the card is flying into the Compare pill. */
  status: "idle" | "scanning" | "error" | "docking";
  /** Real milestone reached (0 detecting, 1 sampling, 2 reconstructing). The pill may run ahead of 0 -> 1 on a timer. */
  stage: 0 | 1 | 2 | 3;
  image: Blob | null;
  error: string | null;
  /** The on-device scan is doing the reading (no remote vision service available or it failed). Not an error. */
  local: boolean;
  /** Bundled sample: canned extraction, no network. */
  demo: boolean;
}

export interface CompareUi {
  /** Cropped original screenshot. */
  blob: Blob | null;
  /** Controls folded away (the overlay itself stays). */
  collapsed: boolean;
  /** 0..100 */
  opacity: number;
}

export interface Toast {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: "info" | "error";
}

/** Ephemeral UI chrome only. Never chart data, styling or animation state (that lives in ChartDocument). */
interface UiState {
  flightCheckOpen: boolean;
  setFlightCheckOpen: (open: boolean) => void;
  /** Data panel layout (pure UI state: never part of the ChartDocument, so Undo/Redo and exports are untouched). */
  dataPanelWidth: number;
  /** null = automatic: the Label column takes whatever the numeric columns leave. */
  labelColWidth: number | null;
  seriesColWidths: Record<string, number>;
  setDataPanelWidth: (w: number) => void;
  setLabelColWidth: (w: number) => void;
  setSeriesColWidth: (seriesId: string, w: number) => void;
  /** A file is being dragged over the window. */
  dropActive: boolean;
  setDropActive: (active: boolean) => void;
  scan: ScanUi;
  setScan: (patch: Partial<ScanUi>) => void;
  compare: CompareUi;
  setCompare: (patch: Partial<CompareUi>) => void;
  /** True while the one-shot entrance playback after a scan is running. */
  reveal: boolean;
  setReveal: (reveal: boolean) => void;
  toast: Toast | null;
  showToast: (t: Omit<Toast, "id">) => void;
  dismissToast: () => void;
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

export const IDLE_SCAN: ScanUi = { status: "idle", stage: 0, image: null, error: null, local: false, demo: false };
export const NO_COMPARE: CompareUi = { blob: null, collapsed: false, opacity: 45 };

let toastId = 0;

export const useUiStore = create<UiState>((set) => ({
  flightCheckOpen: false,
  setFlightCheckOpen: (flightCheckOpen) => set({ flightCheckOpen }),
  dataPanelWidth: PANEL_DEFAULT,
  labelColWidth: null,
  seriesColWidths: {},
  setDataPanelWidth: (w) => set({ dataPanelWidth: clampPanel(w) }),
  setLabelColWidth: (w) => set({ labelColWidth: clampLabel(w) }),
  setSeriesColWidth: (id, w) => set((s) => ({ seriesColWidths: { ...s.seriesColWidths, [id]: clampSeries(w) } })),
  dropActive: false,
  setDropActive: (dropActive) => set({ dropActive }),
  scan: IDLE_SCAN,
  setScan: (patch) => set((s) => ({ scan: { ...s.scan, ...patch } })),
  compare: NO_COMPARE,
  setCompare: (patch) => set((s) => ({ compare: { ...s.compare, ...patch } })),
  reveal: false,
  setReveal: (reveal) => set({ reveal }),
  toast: null,
  showToast: (t) => set({ toast: { ...t, id: ++toastId } }),
  dismissToast: () => set({ toast: null }),
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
