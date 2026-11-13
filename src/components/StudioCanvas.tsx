import { useEffect, useMemo } from "react";
import { buildScene } from "../engine/scene";
import { computeFrameState } from "../engine/motion/frameState";
import { buildTimeline } from "../engine/motion/timeline";
import { pieGuard } from "../engine/guards";
import { getMeasurer } from "../render/measurer";
import { fontStack } from "../engine/fonts";
import { loadFontFamily } from "../render/fontLoader";
import { SculptOverlay } from "./SculptOverlay";
import { InlineTextOverlay } from "./InlineTextOverlay";
import { SvgScene } from "../render/SvgScene";
import { useDocumentStore } from "../store/documentStore";
import { useUiStore } from "../store/uiStore";

const CHECKER =
  "conic-gradient(#e2e8f0 25%, #f8fafc 0 50%, #e2e8f0 0 75%, #f8fafc 0) 0 0 / 24px 24px";

export function StudioCanvas() {
  const doc = useDocumentStore((s) => s.doc);
  const update = useDocumentStore((s) => s.update);
  const fontsReady = useUiStore((s) => s.fontsReady);
  const fontsVersion = useUiStore((s) => s.fontsVersion);
  const fontFamily = doc.brand.fontFamily;

  // Brand fonts load lazily; once ready the store bumps fontsVersion and the scene re-measures.
  useEffect(() => {
    void loadFontFamily(fontFamily);
  }, [fontFamily]);
  const playheadMs = useUiStore((s) => s.playheadMs);

  // fontsReady is a deliberate dependency: re-measure once Inter is available.
  const scene = useMemo(() => {
    // Resting playhead = settled frame, so editing always shows the finished chart.
    const t = playheadMs ?? (doc.motion.enabled ? buildTimeline(doc).heroEndMs : 0);
    return buildScene(doc, getMeasurer(fontFamily), computeFrameState(doc, t));
  }, [doc, fontsReady, fontsVersion, playheadMs, fontFamily]);
  const guard = pieGuard(doc);
  const { width, height, transparent } = doc.canvas;

  return (
    <div className="relative h-full w-full" style={{ containerType: "size" }}>
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="group relative shadow-xl ring-1 ring-slate-300"
          style={{
            containerType: "inline-size",
            width: `min(100cqw, calc(100cqh * ${width} / ${height}))`,
            aspectRatio: `${width} / ${height}`,
            background: transparent ? CHECKER : undefined,
          }}
        >
          <SvgScene nodes={scene.nodes} width={width} height={height} fontFamily={fontStack(fontFamily)} style={{ display: "block", width: "100%", height: "100%" }} />
          <SculptOverlay doc={doc} layout={scene.layout} />
          <InlineTextOverlay doc={doc} layout={scene.layout} />
        </div>
      </div>

      {guard.blocked && (
        <div className="absolute inset-x-0 top-6 mx-auto flex w-fit max-w-md items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow">
          <span>{guard.reason}</span>
          <button
            className="shrink-0 rounded-md bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700"
            onClick={() => update((d) => void (d.geometry.type = "horizontal-bar"))}
          >
            Switch to Horizontal Bar
          </button>
        </div>
      )}
    </div>
  );
}
