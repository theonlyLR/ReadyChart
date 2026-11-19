# Product Specification: Universal Chart Recreation & Motion Studio

## 1. Core Scene Graph (ChartDocument)
export type ChartType = "bar" | "horizontal-bar" | "stacked-bar" | "line" | "area" | "pie" | "donut";
export type CellProvenance = "USER_INPUT" | "PARSED" | "OCR_EXACT" | "AXIS_MEASURED" | "LOW_CONFIDENCE" | "ESTIMATED" | "MISSING";

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
7. Self-Healing Scan: the dev proxy cascades Gemini models/endpoints and caches the first working route. If the proxy, key or provider fails for any reason, the same scan animation runs an on-device scanner (canvas bar clustering + tesseract.js OCR) through the identical crop/sampling/apply pipeline; no key prompt or HTTP error is shown to the user. It reads bar charts only.
8. Hybrid 4-stage reconstruction: (0) dual-image pre-processing: the full screenshot plus a 2x bicubic, sharpened crop of the chart region; (1) coordinate geometry first: plotBox, zeroBaselineY, yAxisTicks and an element (label, value, rawText, bounds, confidence) for every mark, measured on the pixels so unreadable or label-less values are computed from distances and OCR numbers off by more than 10% lose to geometry; (2) full style DNA: title alignment/scale, legend position, corner radius, gap, stroke, markers, donut hole, colours, axes; (3) closed-loop render-and-critique via /api/refine-chart (Gemini flash, low thinking, 8 s) whose allowlisted patch lands in the same single undo step. The Compare Original overlay docks at 0% with a one-click 50% toggle.
9. Onion-Skin Compare: A top-right "Compare Original" pill overlays the cropped screenshot at 0-100% opacity on the live canvas with pointer-events disabled so sculpting and inline text editing work through it.

## 5. Build Milestones
- Milestone 1 (Core Studio & Static Export): ChartDocument Zustand store + Undo/Redo, pure layout engine with collision solver, live SVG renderer, inline data table, right-hand Mechanical Inspector sliders, and Flight Check static export (SVG, PNG, JPG, WebP).
- Milestone 2 (Deterministic Motion & Animated Export): computeFrameState(doc, timeMs) supporting cubic-bezier + damped harmonic spring physics, multi-track choreography (grid -> bars -> number roll-up), interactive timeline scrubber, and WebWorker streaming GIF + Animated WebP export.
- Milestone 3 (Brand Kit & Direct Canvas Sculpting): Logo upload with luminance contrast badge + safe-zone margin avoidance, localStorage Brand Kit presets, inline text editing, and drag-on-canvas bar/point value sculpting.
- Milestone 4 (Screenshot-to-Chart & Smart Text Ingestion): Zero-modal Cmd+V / drag-and-drop ingestion, deterministic table/text parser, multi-provider Vision extraction (/api/scan-chart dev proxy) with auto-crop and pixel-sampled colours, full visual reconstruction, Compare Original onion-skin overlay. Later: Visual Self-Refine loop and RFC 6902 natural-language style tweaks.
- Milestone 5A (Production Deployment & Serverless Vision API): the app ships as a static Vite SPA on Vercel while `/api/scan-chart` and `/api/refine-chart` run as Vercel Serverless Functions. See Section 6.

## 6. Production Deployment (Milestone 5A)
Architecture: one framework-agnostic core, two thin adapters, zero duplicated logic.
- `server/scanCore.ts`: provider requests (Gemini model cascade with fast failover, Anthropic, OpenAI), timeouts, JSON extraction, `handleScan`, `handleRefine`, and `handleApi`, which applies the guards below. Takes a parsed request plus an env object; imports no framework.
- `server/nodeAdapter.ts`: the Node `IncomingMessage`/`ServerResponse` bridge (body read with an early size abort, Cancel to `AbortSignal`, JSON reply).
- `server/scanProxy.ts`: Vite dev/preview middleware (`npm run dev`, `vite preview`); guards are off and the body cap stays 32 MB, so local behaviour is unchanged.
- `api/scan-chart.ts`, `api/refine-chart.ts`: Vercel Functions that pass `process.env` to the same core. Guards are on when `NODE_ENV=production`.
- `vercel.json`: `maxDuration: 30` for `api/**/*.ts`; `/api/scan-chart/status` is rewritten to the scan function (the client's `probeProxy` call); every other non-`/api/` path rewrites to `/index.html` for the SPA.

Guards (production), in order: (1) `GET` on the scan route is the status probe and returns `{ configured }` (provider name only, never a key); (2) any non-POST method returns 405 with `Allow: POST`; (3) body over 6 MB returns 413; (4) `Origin` (else `Referer`) must match the request host (`x-forwarded-host` / `host`) or an entry of `ALLOWED_ORIGINS`, otherwise 403 (a request with neither header is rejected); (5) an in-memory sliding window allows 15 requests per 60 s per client IP (first `x-forwarded-for` hop), per route, otherwise 429 `rate_limited` with `Retry-After`. The window is per warm function instance, so it is best-effort abuse protection, not a global quota. The client scanner treats every non-OK reply as "use the on-device scan", so each guard degrades gracefully. Provider errors are logged with the key redacted; keys never appear in responses.

Note: Vercel itself caps Function request bodies at 4.5 MB, so on Vercel the effective limit is lower than the 6 MB guard (the platform rejects first and the client falls back).

Environment variables (Vercel Project Settings, or `.env.local` locally):
| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Preferred provider (Gemini > Anthropic > OpenAI) |
| `ANTHROPIC_API_KEY` | Anthropic vision fallback |
| `OPENAI_API_KEY` | OpenAI vision fallback |
| `GEMINI_MODEL` / `ANTHROPIC_MODEL` / `OPENAI_MODEL` | Optional pin; `GEMINI_MODEL` replaces the Gemini cascade (and the refine model) |
| `ALLOWED_ORIGINS` | Comma-separated extra origins or hosts allowed to call the API (same-host is always allowed) |
