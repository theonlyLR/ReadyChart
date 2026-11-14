/** Column / panel sizing rules for the Data Table. Pure, so the limits and auto-fit maths are unit tested. */

export const LABEL_MIN = 64;
export const LABEL_MAX = 320;
export const SERIES_MIN = 52;
export const SERIES_MAX = 180;
/** Numeric columns start compact so the Label column gets the rest of the panel. */
export const SERIES_DEFAULT = 68;
export const PANEL_MIN = 240;
export const PANEL_MAX = 460;
export const PANEL_DEFAULT = 340;
/** Width of the trailing remove-row column. */
export const REMOVE_COL = 24;

export const clampLabel = (w: number): number => clamp(w, LABEL_MIN, LABEL_MAX);
export const clampSeries = (w: number): number => clamp(w, SERIES_MIN, SERIES_MAX);
export const clampPanel = (w: number): number => clamp(w, PANEL_MIN, PANEL_MAX);

function clamp(v: number, lo: number, hi: number): number {
  return Math.round(Math.min(hi, Math.max(lo, v)));
}

/** Excel's double-click: the widest content (text + swatch + cell padding already included) snapped into the allowed range. */
export function autoFit(contentWidths: number[], min: number, max: number): number {
  return clamp(Math.ceil(Math.max(0, ...contentWidths)), min, max);
}

/** Pointer travel -> new width, clamped. */
export function dragWidth(startWidth: number, dx: number, clampFn: (w: number) => number): number {
  return clampFn(startWidth + dx);
}

// Cell chrome, in px (matches the Tailwind classes on the inputs and swatches in DataTable.tsx).
export const INPUT_PAD = 14; // px-1.5 each side + 1px borders + a little slack so the caret never touches the edge
export const SWATCH = 36; // 32px colour field + 4px gap
export const ICON_BTN = 22; // remove / confirm icon buttons
