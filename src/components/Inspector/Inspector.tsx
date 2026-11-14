import { ASPECT_PRESETS } from "../../model/defaults";
import type { AspectPreset, ChartDocument } from "../../model/types";
import { clearSliceColors, colorEachItem, itemColorsActive, parseCellNumber, setSliceColor } from "../../model/dataOps";
import { SERIES_PALETTE } from "../../model/defaults";
import { buildNaturalTimeline, buildTimeline, TOTAL_DURATION_MAX_MS, TOTAL_DURATION_MIN_MS } from "../../engine/motion/timeline";
import { useDocumentStore } from "../../store/documentStore";
import { CommitInput } from "../CommitInput";
import { BrandSection } from "./BrandSection";
import { BrandKitVault } from "./BrandKitVault";
import { ColorField, Section, SelectField, SliderField, TextField, ToggleField } from "./fields";

const ASPECTS: { value: AspectPreset; label: string }[] = [
  { value: "16:9", label: "16:9 Landscape" },
  { value: "4:5", label: "4:5 Portrait" },
  { value: "9:16", label: "9:16 Story" },
  { value: "1:1", label: "1:1 Square" },
  { value: "custom", label: "Custom" },
];

const pct = (v: number) => `${Math.round(v * 100)}%`;
const px = (v: number) => `${v}px`;

/** Numeric axis bound: "auto" toggle plus a committed number field. */
function AxisBound({ label, value, onChange }: { label: string; value: number | "auto"; onChange: (v: number | "auto") => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <div className="flex items-center gap-2">
        <CommitInput
          ariaLabel={label}
          inputMode="decimal"
          className="w-20 rounded-md border border-slate-200 px-2 py-1 text-right text-sm tabular-nums focus:border-indigo-400 focus:outline-none"
          value={value === "auto" ? "" : String(value)}
          placeholder="auto"
          onCommit={(t) => {
            const n = parseCellNumber(t);
            if (n === null) onChange("auto");
            else if (n !== undefined) onChange(n);
          }}
        />
      </div>
    </div>
  );
}

const ms = (v: number) => `${v}ms`;

function MotionControls() {
  const doc = useDocumentStore((s) => s.doc);
  const update = useDocumentStore((s) => s.update);
  const m = doc.motion;
  const set = (recipe: (d: ChartDocument) => void) => update(recipe);
  return (
    <>
      <SelectField
        label="Physics"
        value={m.physicsMode}
        options={[
          { value: "bezier", label: "Cubic bezier" },
          { value: "spring", label: "Spring" },
        ]}
        onChange={(v) => set((d) => void (d.motion.physicsMode = v))}
      />
      {m.physicsMode === "bezier" ? (
        <>
          <SliderField label="Duration" value={m.durationMs} min={200} max={4000} step={50} format={ms} onChange={(v) => set((d) => void (d.motion.durationMs = v))} />
          {(["x1", "y1", "x2", "y2"] as const).map((name, i) => (
            <SliderField
              key={name}
              label={`Easing ${name}`}
              value={m.easing[i]!}
              min={i % 2 === 0 ? 0 : -1}
              max={i % 2 === 0 ? 1 : 2}
              step={0.01}
              format={(v) => v.toFixed(2)}
              onChange={(v) => set((d) => void (d.motion.easing[i] = v))}
            />
          ))}
        </>
      ) : (
        <>
          <SliderField label="Spring stiffness" value={m.springStiffness} min={20} max={600} step={5} onChange={(v) => set((d) => void (d.motion.springStiffness = v))} />
          <SliderField label="Spring damping" value={m.springDamping} min={2} max={80} step={1} onChange={(v) => set((d) => void (d.motion.springDamping = v))} />
        </>
      )}
      <SelectField
        label="Stagger order"
        value={m.staggerDirection}
        options={[
          { value: "left-to-right", label: "Left to right" },
          { value: "center-out", label: "Center out" },
          { value: "smallest-to-largest", label: "Smallest to largest" },
        ]}
        onChange={(v) => set((d) => void (d.motion.staggerDirection = v))}
      />
      <SliderField label="Stagger per item" value={m.staggerMs} min={0} max={400} step={5} format={ms} onChange={(v) => set((d) => void (d.motion.staggerMs = v))} />
      <SliderField label="Max total stagger" value={m.maxTotalStaggerMs} min={0} max={3000} step={50} format={ms} onChange={(v) => set((d) => void (d.motion.maxTotalStaggerMs = v))} />
      <ToggleField label="Number roll-up" value={m.numberRollUp} onChange={(v) => set((d) => void (d.motion.numberRollUp = v))} />
      <SliderField label="Readability hold" value={m.holdEndMs} min={0} max={5000} step={100} format={ms} onChange={(v) => set((d) => void (d.motion.holdEndMs = v))} />
      <SliderField label="Loop reset" value={m.loopResetMs} min={0} max={2000} step={50} format={ms} onChange={(v) => set((d) => void (d.motion.loopResetMs = v))} />
      <SliderField
        label="Total duration"
        value={buildTimeline(doc).totalMs / 1000}
        min={TOTAL_DURATION_MIN_MS / 1000}
        max={TOTAL_DURATION_MAX_MS / 1000}
        step={0.1}
        format={(v) => `${v.toFixed(1)}s`}
        onChange={(v) => set((d) => void (d.motion.totalDurationMs = Math.round(v * 1000)))}
      />
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {m.totalDurationMs == null ? "Auto" : `Auto would be ${(buildNaturalTimeline(doc).totalMs / 1000).toFixed(1)}s`} · loop length {(buildTimeline(doc).totalMs / 1000).toFixed(2)}s
        </span>
        <button className="font-medium text-indigo-700 hover:underline disabled:text-slate-300 disabled:no-underline" disabled={m.totalDurationMs == null} onClick={() => set((d) => void (d.motion.totalDurationMs = null))}>
          Reset to Auto
        </button>
      </div>
    </>
  );
}

export function Inspector() {
  const doc = useDocumentStore((s) => s.doc);
  const update = useDocumentStore((s) => s.update);
  const set = (recipe: (d: ChartDocument) => void) => update(recipe);
  const { canvas, geometry: g, data } = doc;
  const type = g.type;
  const isBar = type === "bar" || type === "horizontal-bar" || type === "stacked-bar";
  const isLine = type === "line" || type === "area";
  const isRadial = type === "pie" || type === "donut";

  return (
    <div className="pb-8">
      <h2 className="border-b border-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Inspector</h2>

      <Section title="Text">
        <TextField label="Title" value={doc.title} onCommit={(v) => set((d) => void (d.title = v))} />
        <TextField label="Subtitle" value={doc.subtitle} onCommit={(v) => set((d) => void (d.subtitle = v))} />
        <TextField label="Source footer" value={doc.sourceFooter} onCommit={(v) => set((d) => void (d.sourceFooter = v))} />
        <SelectField
          label="Title alignment"
          value={doc.canvas.titleAlign}
          options={[
            { value: "left", label: "Left" },
            { value: "center", label: "Center" },
          ]}
          onChange={(v) => set((d) => void (d.canvas.titleAlign = v))}
        />
        <SliderField label="Title size" value={doc.canvas.titleScale} min={0.6} max={1.6} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set((d) => void (d.canvas.titleScale = v))} />
      </Section>

      <Section title="Canvas">
        <SelectField
          label="Aspect"
          value={canvas.aspectPreset}
          options={ASPECTS}
          onChange={(v) =>
            set((d) => {
              d.canvas.aspectPreset = v;
              if (v !== "custom") Object.assign(d.canvas, ASPECT_PRESETS[v]);
            })
          }
        />
        {canvas.aspectPreset === "custom" && (
          <>
            <SliderField label="Width" value={canvas.width} min={320} max={3840} step={10} format={px} onChange={(v) => set((d) => void (d.canvas.width = v))} />
            <SliderField label="Height" value={canvas.height} min={320} max={3840} step={10} format={px} onChange={(v) => set((d) => void (d.canvas.height = v))} />
          </>
        )}
        <ColorField label="Background" value={canvas.background} onChange={(v) => set((d) => void (d.canvas.background = v))} />
        <ToggleField label="Transparent background" value={canvas.transparent} onChange={(v) => set((d) => void (d.canvas.transparent = v))} />
        {(["Top", "Right", "Bottom", "Left"] as const).map((side, i) => (
          <SliderField key={side} label={`Padding ${side.toLowerCase()}`} value={canvas.padding[i]!} min={0} max={240} format={px} onChange={(v) => set((d) => void (d.canvas.padding[i] = v))} />
        ))}
      </Section>

      <BrandSection />
      <BrandKitVault />

      <Section title="Number format">
        <TextField label="Locale" value={data.locale} onCommit={(v) => set((d) => void (d.data.locale = v.trim() || "en-US"))} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Prefix" value={data.unitPrefix} onCommit={(v) => set((d) => void (d.data.unitPrefix = v))} />
          <TextField label="Suffix" value={data.unitSuffix} onCommit={(v) => set((d) => void (d.data.unitSuffix = v))} />
        </div>
        <ToggleField label="Compact notation (1.2K)" value={data.compactNotation} onChange={(v) => set((d) => void (d.data.compactNotation = v))} />
      </Section>

      <Section title="Geometry">
        {isBar && (
          <>
            <SliderField label="Top corner radius" value={g.barRadius[0]} min={0} max={48} format={px} onChange={(v) => set((d) => void ((d.geometry.barRadius[0] = v), (d.geometry.barRadius[1] = v)))} />
            <SliderField label="Bottom corner radius" value={g.barRadius[2]} min={0} max={48} format={px} onChange={(v) => set((d) => void ((d.geometry.barRadius[2] = v), (d.geometry.barRadius[3] = v)))} />
            <SliderField label="Bar gap" value={g.barGapRatio} min={0} max={0.9} step={0.01} format={pct} onChange={(v) => set((d) => void (d.geometry.barGapRatio = v))} />
          </>
        )}
        {isLine && (
          <>
            <SliderField label="Stroke width" value={g.strokeWidth} min={1} max={16} format={px} onChange={(v) => set((d) => void (d.geometry.strokeWidth = v))} />
            <ToggleField label="Point markers" value={g.showMarkers} onChange={(v) => set((d) => void (d.geometry.showMarkers = v))} />
            <SliderField label="Curve smoothness" value={g.curveTension} min={0} max={1} step={0.01} format={pct} onChange={(v) => set((d) => void (d.geometry.curveTension = v))} />
          </>
        )}
        {type === "donut" && (
          <SliderField label="Donut hole" value={g.donutInnerRatio} min={0.2} max={0.9} step={0.01} format={pct} onChange={(v) => set((d) => void (d.geometry.donutInnerRatio = v))} />
        )}
        {isRadial && (
          <SliderField label="Group slices below" value={g.groupSmallSlicesBelowPct} min={0} max={15} step={0.5} format={(v) => (v === 0 ? "off" : `${v}%`)} onChange={(v) => set((d) => void (d.geometry.groupSmallSlicesBelowPct = v))} />
        )}
        <SelectField
          label="Legend"
          value={g.legendPosition}
          options={[
            { value: "top", label: "Top" },
            { value: "bottom", label: "Bottom" },
            { value: "hidden", label: "Hidden" },
          ]}
          onChange={(v) => set((d) => void (d.geometry.legendPosition = v))}
        />
        <ToggleField label="Data labels" value={g.showDataLabels} onChange={(v) => set((d) => void (d.geometry.showDataLabels = v))} />
      </Section>

      {isRadial && (
        <Section title="Slice colors">
          {data.labels.map((label, i) => (
            <ColorField
              key={i}
              label={label || `Slice ${i + 1}`}
              value={data.series[0]?.pointColorOverrides?.[i] ?? SERIES_PALETTE[i % SERIES_PALETTE.length]!}
              onChange={(c) => set((d) => setSliceColor(d.data, i, c))}
            />
          ))}
          <button
            className="text-xs font-medium text-indigo-700 hover:underline disabled:text-slate-300 disabled:no-underline"
            disabled={!data.series[0]?.pointColorOverrides}
            onClick={() => set((d) => clearSliceColors(d.data))}
          >
            Reset slice colors
          </button>
        </Section>
      )}

      {(type === "bar" || type === "horizontal-bar") && data.series.length === 1 && (
        <Section title="Bar colors">
          <ToggleField label="Color each bar" value={itemColorsActive(data)} onChange={(on) => set((d) => colorEachItem(d.data, on))} />
          {itemColorsActive(data) &&
            data.labels.map((label, i) => (
              <ColorField
                key={i}
                label={label || `Bar ${i + 1}`}
                value={data.series[0]?.pointColorOverrides?.[i] ?? data.series[0]!.color}
                onChange={(c) => set((d) => setSliceColor(d.data, i, c))}
              />
            ))}
        </Section>
      )}

      <Section title="Motion">
        <ToggleField label="Enable motion" value={doc.motion.enabled} onChange={(v) => set((d) => void (d.motion.enabled = v))} />
        {doc.motion.enabled && <MotionControls />}
      </Section>

      {!isRadial && (
        <Section title="Axes & grid">
          <AxisBound label="Axis min" value={g.yMin} onChange={(v) => set((d) => void (d.geometry.yMin = v))} />
          <AxisBound label="Axis max" value={g.yMax} onChange={(v) => set((d) => void (d.geometry.yMax = v))} />
          <ToggleField label="Axis break mark" value={g.showAxisBreak} onChange={(v) => set((d) => void (d.geometry.showAxisBreak = v))} />
          <ToggleField label="Gridlines" value={g.showGridlines} onChange={(v) => set((d) => void (d.geometry.showGridlines = v))} />
          <SliderField label="Gridline opacity" value={g.gridlineOpacity} min={0} max={0.5} step={0.01} format={pct} onChange={(v) => set((d) => void (d.geometry.gridlineOpacity = v))} />
        </Section>
      )}
    </div>
  );
}
