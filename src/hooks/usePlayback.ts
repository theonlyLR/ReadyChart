import { useEffect } from "react";
import { buildTimeline } from "../engine/motion/timeline";
import type { ChartDocument } from "../model/types";
import { useDocumentStore } from "../store/documentStore";
import { useUiStore } from "../store/uiStore";

/** Starts playback from the right place: from 0 unless a loop is mid-way. */
export function togglePlay(): void {
  const ui = useUiStore.getState();
  const { doc } = useDocumentStore.getState();
  if (!doc.motion.enabled) return;
  if (ui.playing) return ui.setPlaying(false);
  const tl = buildTimeline(doc);
  if (ui.playheadMs === null || ui.playheadMs >= (ui.loop ? tl.totalMs : tl.holdEndMs)) ui.setPlayheadMs(0);
  ui.setPlaying(true);
}

/**
 * Transport clock only: advances the playhead by wall-clock time. Every pixel still comes from
 * computeFrameState(doc, playheadMs), so playback, scrubbing and export frames cannot diverge.
 */
export function usePlayback(): void {
  const playing = useUiStore((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const ui = useUiStore.getState();
      const { doc } = useDocumentStore.getState();
      if (!doc.motion.enabled) return ui.setPlaying(false);
      const tl = buildTimeline(doc);
      let t = (ui.playheadMs ?? 0) + (now - last);
      last = now;
      if (ui.loop && t >= tl.totalMs) t %= tl.totalMs;
      else if (!ui.loop && t >= tl.holdEndMs) {
        ui.setPlayheadMs(tl.holdEndMs);
        return ui.setPlaying(false);
      }
      ui.setPlayheadMs(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

/** The document with its entrance motion forced on (the user's own `motion.enabled` is never changed). */
export function revealDoc(doc: ChartDocument): ChartDocument {
  return doc.motion.enabled ? doc : { ...doc, motion: { ...doc.motion, enabled: true } };
}

let revealRun = 0;

/**
 * One-shot entrance playback after a scan: playhead 0 -> end of the hero motion, then back to the resting frame.
 * Transport clock only; every pixel still comes from computeFrameState(revealDoc(doc), playheadMs), so it is
 * identical to scrubbing there or exporting that frame.
 */
export function playReveal(): void {
  const run = ++revealRun;
  const ui = useUiStore.getState();
  const end = buildTimeline(revealDoc(useDocumentStore.getState().doc)).heroEndMs;
  let t = 0;
  let last = performance.now();
  const tick = (now: number) => {
    if (run !== revealRun || !useUiStore.getState().reveal) return;
    t += now - last;
    last = now;
    if (t >= end) {
      ui.setPlayheadMs(null);
      ui.setReveal(false);
      return;
    }
    ui.setPlayheadMs(t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
