import type { AspectPreset, DataLabelPosition } from "../../model/types";
import type { ParsedTable } from "../parseTable";
import type { ExtractedChart } from "../../vision/VisionProvider";

/** Visual DNA read from the screenshot: everything except the data table. */
export interface ScanDesign {
  /** Sampled page colour, or null when it couldn't be read (keeps the current background). */
  background: string | null;
  /** Readable chart text colour, or null for automatic. */
  textColor: string | null;
  /** Colour per bar index that differs from its series colour (single-series bar / horizontal-bar only). */
  barColors: Record<number, string>;
  aspect: Exclude<AspectPreset, "custom">;
  showXAxis: boolean | null;
  showYAxis: boolean | null;
  showGridlines: boolean | null;
  showDataLabels: boolean | null;
  dataLabelPosition: DataLabelPosition | null;
}

export interface ScanResult {
  chart: ExtractedChart;
  /** Table with per-cell provenance and sampled series colours already applied. */
  table: ParsedTable;
  design: ScanDesign;
  /** Cropped original, shown by the Compare Original overlay. */
  croppedBlob: Blob;
  warnings: string[];
}
