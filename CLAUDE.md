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
5. Anti-Hallucination Boundary: Natural language styling edits MUST emit RFC 6902 JSON Patches restricted strictly to /geometry, /motion, /canvas, and /brand—never allow styling prompts to mutate /data/series.
6. 100% Client-Side Static App: Do not add Node/Express servers or backend routes. Route AI Vision calls (Milestone 4) through a VisionProvider interface using a user-supplied API key in localStorage.
7. Verification Gate: Run npm run typecheck && npm test before completing any task. Favor simple, explicit code over speculative abstractions.
