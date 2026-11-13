# Product Specification: Universal Chart Recreation & Motion Studio

## 1. Core Scene Graph (ChartDocument)
export type ChartType = "bar" | "horizontal-bar" | "stacked-bar" | "line" | "area" | "pie" | "donut";
export type CellProvenance = "USER_INPUT" | "OCR_EXACT" | "AXIS_MEASURED" | "LOW_CONFIDENCE" | "MISSING";

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
    aspectPreset: "16:9" | "4:5" | "9:16" | "1:1" | "custom";
    background: string;
    transparent: boolean;
    padding: [number, number, number, number];
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
    barRadius: [number, number, number, number];
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
  };
  brand: {
    logoDataUrl: string | null;
    anchor: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    sizePx: number;
    opacity: number;
    contrastBackdrop: "none" | "frosted-pill" | "auto-invert";
  };
}

## 2. Layout & Edge-Case Rules
- Negative Values: Support negative zero-line baselines on bar/line/area charts (flip bar corner radii to bottom corners and grow downward from zero). Block pie/donut rendering when negative values exist and surface a 1-click switch to Horizontal Bar.
- Label Collision Solver: Measure label widths (measureText); progressively apply 0deg -> -45deg tilt -> skip every Nth tick when X-axis labels collide.
- Safe-Zone Reflow: Subtract the brand logo bounding box from available plot/legend margins so logos never overlap legends or titles across aspect ratios (16:9, 4:5, 9:16).

## 3. Pre-Export Flight Check Modal
Clicking Export opens a preview modal running on the exact offscreen export pipeline:
- Backdrop Toggle: Transparency checkerboard, Dark Slide (#0F172A), White Paper (#FFFFFF).
- Format Fidelity Preview: Live quantized 256-color preview when GIF is selected, with 1-click switch to Animated WebP.
- File-Size Budget & Auto-Optimizer: Displays estimated output size and a 1-click Fit Under 5 MB button (steps down FPS 60 -> 24 and scale 2x -> 1.5x).
- Platform Safe-Zone Overlay: Toggleable crop guides for LinkedIn, X, and TikTok/Reels.

## 4. Anti-Hallucination Vision Pipeline (Milestone 4)
1. Zero-AI Fast Path: CSV, TSV, JSON, and HTML table pastes bypass LLMs completely via deterministic parsing.
2. Two-Pass Visual Self-Refine: Vision LLM extracts initial ChartDocument + bounding boxes -> engine renders temporary SVG -> Vision critique compares original screenshot vs. rendered SVG side-by-side and emits a corrective JSON patch.
3. Deterministic Pixel Math: When bars lack printed value labels, compute values via linear interpolation from AI-detected [y_baseline, y_top_tick, y_bar_top] pixel coordinates.
4. Ghost X-Ray Overlay: Render live chart at adjustable opacity directly over the pasted screenshot with draggable Zero Baseline and Top Tick calibration lines.

## 5. Build Milestones
- Milestone 1 (Core Studio & Static Export): ChartDocument Zustand store + Undo/Redo, pure layout engine with collision solver, live SVG renderer, inline data table, right-hand Mechanical Inspector sliders, and Flight Check static export (SVG, PNG, JPG, WebP).
- Milestone 2 (Deterministic Motion & Animated Export): computeFrameState(doc, timeMs) supporting cubic-bezier + damped harmonic spring physics, multi-track choreography (grid -> bars -> number roll-up), interactive timeline scrubber, and WebWorker streaming GIF + Animated WebP export.
- Milestone 3 (Brand Kit & Direct Canvas Sculpting): Logo upload with luminance contrast badge + safe-zone margin avoidance, localStorage Brand Kit presets, inline text editing, and drag-on-canvas bar/point value sculpting.
- Milestone 4 (Screenshot-to-Chart & Smart Text Ingestion): Cmd+V clipboard ingestion, deterministic table/text parser, Vision extraction + Visual Self-Refine loop, Ghost X-Ray calibration overlay, and RFC 6902 natural-language style tweaks.
