# Product Specification: Universal Chart Recreation & Motion Studio

## 1. Core Scene Graph (ChartDocument)
export type ChartType = "bar" | "horizontal-bar" | "stacked-bar" | "line" | "area" | "pie" | "donut";
export type CellProvenance = "USER_INPUT" | "PARSED" | "OCR_EXACT" | "AXIS_MEASURED" | "LOW_CONFIDENCE" | "MISSING";

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
4. Zero-Modal Ingest: Cmd+V (image, or text/CSV/TSV outside text fields) and full-window file drop start immediately. Images run a CSS-only scan choreography (dimmed stage, viewfinder card, laser scanline, stepped progress pill with Cancel); text builds the chart at once with a toast and 1-click Undo. The Import menu has three actions: Upload Screenshot, Paste Data / CSV, Try Sample Screenshot (bundled demo, no key).
5. Auto-Crop + Coordinate-Guided Sampling: The vision model returns chartBounds [ymin,xmin,ymax,xmax] and samplePoints (0-1000). The client crops to the chart and reads exact colours as 5x5 pixel averages at those points; model-guessed hex strings are never trusted.
6. Visual DNA Reconstruction: One atomic ChartDocument update (one Undo step) applies chart type, texts, labels, series, units, aspect ratio, background, text colour, axis/gridline/data-label flags, data label position and per-bar colours. Values under 0.85 confidence are tagged LOW_CONFIDENCE and ringed in amber on the canvas (editor-only, never exported) until clicked or edited.
7. Onion-Skin Compare: A top-right "Compare Original" pill overlays the cropped screenshot at 0-100% opacity on the live canvas with pointer-events disabled so sculpting and inline text editing work through it.

## 5. Build Milestones
- Milestone 1 (Core Studio & Static Export): ChartDocument Zustand store + Undo/Redo, pure layout engine with collision solver, live SVG renderer, inline data table, right-hand Mechanical Inspector sliders, and Flight Check static export (SVG, PNG, JPG, WebP).
- Milestone 2 (Deterministic Motion & Animated Export): computeFrameState(doc, timeMs) supporting cubic-bezier + damped harmonic spring physics, multi-track choreography (grid -> bars -> number roll-up), interactive timeline scrubber, and WebWorker streaming GIF + Animated WebP export.
- Milestone 3 (Brand Kit & Direct Canvas Sculpting): Logo upload with luminance contrast badge + safe-zone margin avoidance, localStorage Brand Kit presets, inline text editing, and drag-on-canvas bar/point value sculpting.
- Milestone 4 (Screenshot-to-Chart & Smart Text Ingestion): Zero-modal Cmd+V / drag-and-drop ingestion, deterministic table/text parser, multi-provider Vision extraction (/api/scan-chart dev proxy) with auto-crop and pixel-sampled colours, full visual reconstruction, Compare Original onion-skin overlay. Later: Visual Self-Refine loop and RFC 6902 natural-language style tweaks.
