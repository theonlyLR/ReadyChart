import { useMemo } from "react";
import { buildScene } from "../engine/scene";
import { pieGuard } from "../engine/guards";
import { getMeasurer } from "../render/measurer";
import { SvgScene } from "../render/SvgScene";
import { useDocumentStore } from "../store/documentStore";
import { useUiStore } from "../store/uiStore";

const CHECKER =
  "conic-gradient(#e2e8f0 25%, #f8fafc 0 50%, #e2e8f0 0 75%, #f8fafc 0) 0 0 / 24px 24px";

export function StudioCanvas() {
  const doc = useDocumentStore((s) => s.doc);
  const update = useDocumentStore((s) => s.update);
  const fontsReady = useUiStore((s) => s.fontsReady);

  // fontsReady is a deliberate dependency: re-measure once Inter is available.
  const scene = useMemo(() => buildScene(doc, getMeasurer()), [doc, fontsReady]);
  const guard = pieGuard(doc);
  const { width, height, transparent } = doc.canvas;

  return (
    <div className="relative h-full w-full" style={{ containerType: "size" }}>
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="shadow-xl ring-1 ring-slate-300"
          style={{
            width: `min(100cqw, calc(100cqh * ${width} / ${height}))`,
            aspectRatio: `${width} / ${height}`,
            background: transparent ? CHECKER : undefined,
          }}
        >
          <SvgScene nodes={scene.nodes} width={width} height={height} style={{ display: "block", width: "100%", height: "100%" }} />
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
