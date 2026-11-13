/// <reference lib="webworker" />
import { createCanvasMeasurer } from "../../engine/textMeasure";
import { fontDef } from "../../engine/fonts";
import { createFrameRenderer, frameTimes } from "../frames";
import { encodeGif } from "./gif";
import { encodeAnimatedWebp } from "./webp";
import type { WorkerMessage, WorkerRequest } from "./protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: WorkerMessage, transfer: Transferable[] = []) => scope.postMessage(m, transfer);

async function registerFonts(family: string, fonts: WorkerRequest["fonts"]): Promise<void> {
  for (const f of fonts) {
    const face = new FontFace(family, f.data, { weight: String(f.weight), style: "normal" });
    await face.load();
    scope.fonts.add(face);
  }
}

async function run(req: WorkerRequest): Promise<void> {
  if (!req.doc.motion.enabled) throw new Error("Enable motion to export an animation.");
  const def = fontDef(req.fontFamily);
  await registerFonts(def.family, req.fonts);
  const r = await createFrameRenderer(req.doc, req.scale, createCanvasMeasurer(def.stack));
  const times = frameTimes(r.totalMs, req.fps);
  const onProgress = (done: number, total: number) => post({ type: "progress", done, total });
  const transparent = req.doc.canvas.transparent;

  const result =
    req.format === "gif"
      ? encodeGif(r, { fps: req.fps, transparent, frameTimes: times, maxBytes: req.maxBytes, onProgress })
      : await encodeAnimatedWebp(r, { quality: req.quality, transparent, frameTimes: times, maxBytes: req.maxBytes, onProgress });

  if ("over" in result) return post({ type: "over", bytes: result.over });
  const out = result.bytes.buffer.slice(result.bytes.byteOffset, result.bytes.byteOffset + result.bytes.byteLength) as ArrayBuffer;
  post({ type: "done", buffer: out, mime: req.format === "gif" ? "image/gif" : "image/webp" }, [out]);
}

scope.onmessage = (e: MessageEvent<WorkerRequest>) => {
  run(e.data).catch((err: unknown) => post({ type: "error", message: err instanceof Error ? err.message : String(err) }));
};
