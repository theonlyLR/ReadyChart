# Project Rules & Architectural Invariants

## Stack & Commands
- Stack: Vite, React 19, TypeScript (strict), Tailwind CSS, Zustand + Immer (undo/redo), d3-scale & d3-shape (math/path generation only).
- Typecheck: npm run typecheck
- Tests: npm test
- Dev Server: npm run dev

## Non-Negotiable Architecture Rules
1. Single Source of Truth (ChartDocument): Every UI slider, canvas drag handle, AI parser, and exporter MUST read from and mutate the single serializable ChartDocument store. Never store chart data, styling, or animation state in local component useState.
2. Math vs. Rendering Split: Use d3-scale and d3-shape strictly for mathematical scales and path strings. Never install full charting libraries (Recharts, Chart.js, ECharts). Render exclusively via custom React SVG and OffscreenCanvas.
3. Deterministic Motion (computeFrameState): Never use CSS transitions or requestAnimationFrame delta timers for chart animations. All motion (springs, cubic-bezier, multi-track staggers, number roll-ups, loop holds) MUST be computed by a pure function computeFrameState(doc, timeMs) so live timeline scrubbing and 60fps GIF/WebP frame-stepping produce pixel-identical output.
4. Bulletproof Exports:
   - Never render external HTTP URLs on canvas (convert uploaded logos to local Data URLs/Blobs on upload to prevent tainted canvas SecurityError).
   - Snap 1px gridlines/axes to Math.round(coord) + 0.5.
   - Embed active WOFF2 fonts and brand logos as inline Base64 inside exported SVG files.
   - Encode animated GIFs/WebPs in a WebWorker by streaming single frames (renderFrame(t) -> encodeFrame() -> release buffer), using a single locked palette sampled from t = durationMs for GIFs and WASM @jsquash/webp for cross-browser WebP support.
5. Anti-Hallucination Boundary: Natural language styling edits MUST emit RFC 6902 JSON Patches restricted strictly to /geometry, /motion, /canvas, and /brand—never allow styling prompts to mutate /data/series. Sole exception: the screenshot refinement pass (`/api/refine-chart`, src/ingest/refinePatch.ts) repairs a reconstruction against its own source image, so it may also correct text, labels, units and individual cell values, strictly through that file's allowlist (no row/series add/remove, no /brand or /motion, changed cells re-tagged for review), applied in the same single undo step as the scan.
6. Static SPA + Thin Vision Functions: The shipped build is a static Vite SPA; do not add Node/Express servers or any long-lived backend. The only server code allowed is the framework-agnostic `server/scanCore.ts` (`POST /api/scan-chart`, `GET /api/scan-chart/status`, `POST /api/refine-chart`, with the 405/413/403/429 guards) and its two thin adapters, both going through `server/nodeAdapter.ts`: the Vite dev/preview middleware (`server/scanProxy.ts`, guards off) and the Vercel Serverless Functions `api/scan-chart.ts` / `api/refine-chart.ts` (guards on in production, `vercel.json` sets `maxDuration: 30` and the SPA rewrite). Never duplicate logic into an adapter. Provider keys come from `.env.local` locally and Vercel env vars in production (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `*_MODEL`, `ALLOWED_ORIGINS`) and are never logged. Route AI Vision calls through the VisionProvider interface: the proxy provider when `/api/scan-chart` is present, otherwise the browser-direct provider using a user-supplied API key in localStorage. Keys never enter ChartDocument, exports or logs.
7. Verification Gate: Run npm run typecheck && npm test before completing any task. Favor simple, explicit code over speculative abstractions.
