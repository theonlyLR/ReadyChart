export type ChartType = "bar" | "horizontal-bar" | "stacked-bar" | "line" | "area" | "pie" | "donut";
export type CellProvenance = "USER_INPUT" | "OCR_EXACT" | "AXIS_MEASURED" | "LOW_CONFIDENCE" | "MISSING";
export type AspectPreset = "16:9" | "4:5" | "9:16" | "1:1" | "custom";
export type ContrastBackdrop = "none" | "frosted-pill" | "auto-invert";
export type FontFamilyId = "inter" | "lora" | "space-grotesk" | "custom";
export type CustomFontFormat = "woff2" | "woff" | "ttf" | "otf";
/** A user-uploaded font, kept as a local Data URL (never an external URL) so exports and the worker can embed it. */
export interface CustomFont {
  name: string;
  format: CustomFontFormat;
  bytes: number;
  dataUrl: string;
}
export type Corners =[number, number, number, number];

export interface DataSeries {
  id: string;
  name: string;
  color: string;
  values: (number | null)[];
  provenance: CellProvenance[];
  pointColorOverrides?: Record<number, string>;
}

export interface ChartDocument {
  id: string;
  title: string;
  subtitle: string;
  sourceFooter: string;
  canvas: {
    width: number;
    height: number;
    aspectPreset: AspectPreset;
    background: string;
    transparent: boolean;
    padding: Corners;
  };
  data: {
    locale: string;
    unitPrefix: string;
    unitSuffix: string;
    compactNotation: boolean;
    labels: string[];
    series: DataSeries[];
  };
  geometry: {
    type: ChartType;
    barRadius: Corners;
    barGapRatio: number;
    strokeWidth: number;
    curveTension: number;
    donutInnerRatio: number;
    yMin: number | "auto";
    yMax: number | "auto";
    showAxisBreak: boolean;
    showGridlines: boolean;
    gridlineOpacity: number;
    showDataLabels: boolean;
    groupSmallSlicesBelowPct: number;
  };
  motion: {
    enabled: boolean;
    physicsMode: "bezier" | "spring";
    durationMs: number;
    easing: [number, number, number, number];
    springStiffness: number;
    springDamping: number;
    staggerMs: number;
    maxTotalStaggerMs: number;
    staggerDirection: "left-to-right" | "center-out" | "smallest-to-largest";
    numberRollUp: boolean;
    holdEndMs: number;
    loopResetMs: number;
    /** Total animation length override in ms (500..10000). null = Auto (derived from the settings above). */
    totalDurationMs: number | null;
  };
  brand: {
    logoDataUrl: string | null;
    anchor: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    sizePx: number;
    opacity: number;
    contrastBackdrop: ContrastBackdrop;
    /** Width / height of the stored logo bitmap (layout is synchronous, so it can't decode images). */
    logoAspect: number;
    /** Alpha-weighted relative luminance (0..1) of the logo's visible pixels, measured at upload. */
    logoLuminance: number;
    /** Colour-inverted copy baked at upload, used by the auto-invert contrast mode. */
    logoInvertedDataUrl: string | null;
    fontFamily: FontFamilyId;
    /** Present when fontFamily is "custom". */
    customFont?: CustomFont;
  };
}
