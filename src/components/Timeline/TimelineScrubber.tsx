import { Pause, Play, Repeat } from "lucide-react";
import { buildTimeline } from "../../engine/motion/timeline";
import { MOTION_PRESETS, matchingPreset } from "../../model/motionPresets";
import { togglePlay } from "../../hooks/usePlayback";
import { useDocumentStore } from "../../store/documentStore";
import { useUiStore } from "../../store/uiStore";

const fmtMs = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
const chip = "rounded-md border px-2.5 py-1 text-xs font-medium";

/** Transport + presets. Reads/writes only the store: the playhead is just a time fed to computeFrameState. */
export function TimelineScrubber() {
  const doc = useDocumentStore((s) => s.doc);
  const update = useDocumentStore((s) => s.update);
  const { playheadMs, playing, loop, setPlayheadMs, setPlaying, setLoop } = useUiStore();
  const motion = doc.motion;

  if (!motion.enabled) {
    return (
      <div className="flex items-center gap-3 border-t border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-600">
        <span>Motion is off. The canvas shows the final chart.</span>
        <button className={`${chip} border-indigo-600 bg-indigo-50 text-indigo-700`} onClick={() => update((d) => void (d.motion.enabled = true))}>
          Enable motion
        </button>
      </div>
    );
  }

  const tl = buildTimeline(doc);
  const t = Math.min(playheadMs ?? tl.heroEndMs, tl.totalMs);
  const pct = (ms: number) => `${(ms / tl.totalMs) * 100}%`;
  const active = matchingPreset(motion);
  const phases = [
    { label: "Stage", from: 0, to: tl.stageMs, color: "bg-sky-200" },
    { label: "Hero + roll-up", from: tl.stageMs, to: tl.heroEndMs, color: "bg-indigo-300" },
    { label: "Hold", from: tl.heroEndMs, to: tl.holdEndMs, color: "bg-emerald-200" },
    { label: "Reset", from: tl.holdEndMs, to: tl.totalMs, color: "bg-slate-200" },
  ];

  return (
    <div className="flex flex-col gap-2 border-t border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        <button aria-label={playing ? "Pause" : "Play"} title="Play / Pause (Space)" className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-white hover:bg-indigo-700" onClick={togglePlay}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button aria-label="Loop" aria-pressed={loop} title="Loop" className={`${chip} inline-flex items-center gap-1 ${loop ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600"}`} onClick={() => setLoop(!loop)}>
          <Repeat size={13} /> Loop
        </button>
        <div className="relative mx-1 h-8 min-w-0 flex-1">
          <div className="absolute inset-x-0 top-3 flex h-2 overflow-hidden rounded-full">
            {phases.map((p) => (
              <div key={p.label} title={p.label} className={`${p.color} h-full`} style={{ width: `${((p.to - p.from) / tl.totalMs) * 100}%` }} />
            ))}
          </div>
          <input
            aria-label="Timeline"
            type="range"
            min={0}
            max={tl.totalMs}
            step={1}
            value={t}
            className="absolute inset-0 h-8 w-full cursor-pointer appearance-none bg-transparent accent-indigo-700"
            onChange={(e) => {
              setPlaying(false);
              setPlayheadMs(Number(e.target.value));
            }}
          />
          <span className="pointer-events-none absolute top-0 h-8 w-px bg-indigo-700" style={{ left: pct(t) }} />
        </div>
        <span className="w-28 text-right text-xs tabular-nums text-slate-500">
          {fmtMs(t)} / {fmtMs(tl.totalMs)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Presets</span>
        {MOTION_PRESETS.map((p) => (
          <button
            key={p.id}
            title={p.hint}
            aria-pressed={active === p.id}
            className={`${chip} ${active === p.id ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
            onClick={() => update((d) => void Object.assign(d.motion, p.motion))}
          >
            {p.label}
          </button>
        ))}
        <button className={`${chip} ml-auto border-slate-200 text-slate-500 hover:bg-slate-50`} onClick={() => (setPlaying(false), update((d) => void (d.motion.enabled = false)))}>
          Turn motion off
        </button>
      </div>
    </div>
  );
}
