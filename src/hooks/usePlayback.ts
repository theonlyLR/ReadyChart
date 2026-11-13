import { useEffect } from "react";
import { buildTimeline } from "../engine/motion/timeline";
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
