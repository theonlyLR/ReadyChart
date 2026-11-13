import { create } from "zustand";
import type { ExportFormat } from "../export/pipeline";
import type { Platform } from "../components/FlightCheck/safeZones";

export type Backdrop = "checker" | "dark" | "white";

/** Ephemeral UI chrome only. Never chart data, styling or animation state (that lives in ChartDocument). */
interface UiState {
  flightCheckOpen: boolean;
  setFlightCheckOpen: (open: boolean) => void;
  /** Flips true once Inter is loaded, so layout re-measures with real glyph widths. */
  fontsReady: boolean;
  /** Flight Check export settings. */
  exportFormat: ExportFormat;
  exportScale: number;
  backdrop: Backdrop;
  safeZone: Platform | null;
  setExport: (patch: Partial<Pick<UiState, "exportFormat" | "exportScale" | "backdrop" | "safeZone">>) => void;
}

export const useUiStore = create<UiState>((set) => ({
  flightCheckOpen: false,
  setFlightCheckOpen: (flightCheckOpen) => set({ flightCheckOpen }),
  fontsReady: false,
  exportFormat: "png",
  exportScale: 2,
  backdrop: "checker",
  safeZone: null,
  setExport: (patch) => set(patch),
}));
