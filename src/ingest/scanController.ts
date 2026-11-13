import { createAnthropicProvider } from "../vision/anthropicProvider";
import { VisionError } from "../vision/prompt";
import { createProxyProvider, probeProxy } from "../vision/proxyProvider";
import type { VisionProvider } from "../vision/VisionProvider";
import { useVisionStore } from "../vision/visionSettings";
import { playReveal } from "../hooks/usePlayback";
import { useDocumentStore } from "../store/documentStore";
import { IDLE_SCAN, NO_COMPARE, useUiStore } from "../store/uiStore";
import { loadScreenshot } from "./image/loadImage";
import { scanChart } from "./image/scanChart";
import type { ScanResult } from "./image/scanTypes";
import { loadSampleExtraction } from "./sample";
import { applyScanResult } from "./toDocument";

/** How long the card takes to fly into the Compare pill. Mirrored by the transition in ScanStage. */
export const DOCK_MS = 480;
/** Lets the last progress step ("Reconstructing...") be seen even when the response is instant. */
const MIN_FINAL_STAGE_MS = 500;
/** The sample's canned answer takes about as long as a real scan, so the choreography reads the same. */
const DEMO_LATENCY_MS = 2600;

let current: AbortController | null = null;
let runId = 0;

const isAbort = (e: unknown): boolean => (e instanceof DOMException && e.name === "AbortError") || (e instanceof Error && e.name === "AbortError");

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Cancel: stops the in-flight request (the proxy aborts upstream too) and leaves the document untouched. */
export function cancelScan(): void {
  current?.abort();
  current = null;
  runId++;
  useUiStore.getState().setScan(IDLE_SCAN);
}

async function pickProvider(): Promise<VisionProvider> {
  const { apiKey, provider, model } = useVisionStore.getState();
  const proxy = await probeProxy();
  if (proxy.available) {
    if (!proxy.configured && !apiKey) throw new VisionError("Add an API key to scan screenshots, or put one in .env.local.", "no_key");
    return createProxyProvider(() => ({ apiKey: useVisionStore.getState().apiKey, provider: useVisionStore.getState().provider }));
  }
  // Static build: no server, so the browser calls Anthropic itself with the user's own key.
  if (apiKey && provider === "anthropic") return createAnthropicProvider(apiKey, model);
  throw new VisionError(apiKey ? "This build can only call Anthropic directly. Switch your key's provider to Anthropic." : "Add an Anthropic API key to scan screenshots.", "no_key");
}

function demoProvider(signal: AbortSignal): VisionProvider {
  return {
    name: "Demo",
    async extractChart() {
      const [raw] = await Promise.all([loadSampleExtraction(), sleep(DEMO_LATENCY_MS, signal)]);
      return raw;
    },
  };
}

/** Pasted, dropped or uploaded screenshot -> scan animation -> one atomic document update -> reveal. */
export async function startScan(image: Blob, opts: { demo?: boolean } = {}): Promise<void> {
  current?.abort();
  const ac = new AbortController();
  current = ac;
  const id = ++runId;
  const ui = useUiStore.getState();
  ui.setCompare(NO_COMPARE);
  ui.setReveal(false);
  ui.setScan({ ...IDLE_SCAN, status: "scanning", image, demo: !!opts.demo });
  const live = () => id === runId && !ac.signal.aborted;

  try {
    const loaded = await loadScreenshot(image);
    const provider = opts.demo ? demoProvider(ac.signal) : await pickProvider();
    const result = await scanChart(loaded, {
      provider,
      signal: ac.signal,
      onStage: (stage) => live() && useUiStore.getState().setScan({ stage: Math.max(stage, useUiStore.getState().scan.stage) as 0 | 1 | 2 }),
    });
    await sleep(MIN_FINAL_STAGE_MS, ac.signal);
    if (live()) commit(result);
  } catch (e) {
    if (!live() || isAbort(e)) return;
    const code = e instanceof VisionError ? e.code : "error";
    useUiStore.getState().setScan({
      status: "error",
      error: e instanceof Error && e.message ? e.message : "Couldn't read that screenshot.",
      needsKey: code === "no_key" || code === "bad_key",
    });
  }
}

/** Re-run the last screenshot (after saving a key, or "Try again"). */
export function retryScan(): void {
  const { image, demo } = useUiStore.getState().scan;
  if (image) void startScan(image, { demo });
}

function commit(result: ScanResult): void {
  const ui = useUiStore.getState();
  const store = useDocumentStore.getState();
  // One replaceDoc = one undo step covering data, labels, units, aspect and every visual field.
  store.replaceDoc(applyScanResult(store.doc, result));
  ui.setCompare({ ...NO_COMPARE, blob: result.croppedBlob });
  ui.setReveal(true);
  ui.setPlaying(false);
  ui.setPlayheadMs(0); // chart starts empty under the dimmed stage, then grows into place
  ui.setScan({ status: "docking" });
  setTimeout(() => playReveal(), 160);
  setTimeout(() => {
    if (useUiStore.getState().scan.status === "docking") useUiStore.getState().setScan(IDLE_SCAN);
  }, DOCK_MS);

  const low = useDocumentStore.getState().doc.data.series.reduce((n, s) => n + s.provenance.filter((p) => p === "LOW_CONFIDENCE").length, 0);
  ui.showToast({
    message: low > 0 ? `Chart rebuilt. ${low} value${low === 1 ? "" : "s"} marked for a second look.` : "Chart rebuilt from your screenshot.",
    actionLabel: "Undo",
    onAction: () => {
      useDocumentStore.getState().undo();
      useUiStore.getState().setCompare(NO_COMPARE);
      useUiStore.getState().dismissToast();
    },
  });
}
