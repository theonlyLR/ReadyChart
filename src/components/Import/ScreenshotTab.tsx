import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { loadScreenshot, SCREENSHOT_MIME_TYPES } from "../../ingest/image/loadImage";
import type { LoadedScreenshot } from "../../ingest/image/loadImage";
import { sampleDominantColors } from "../../ingest/image/sampleColors";
import { parsePastedText } from "../../ingest/parseTable";
import type { ParsedTable } from "../../ingest/parseTable";
import { createAnthropicProvider } from "../../vision/anthropicProvider";
import { valuesFromPixels } from "../../vision/pixelMath";
import { extractionToTable, validateExtraction } from "../../vision/VisionProvider";
import { useVisionStore } from "../../vision/visionSettings";
import { ParsedPreview } from "./ImportModal";

type Candidate = { id: number; table: ParsedTable; provenance: "PARSED" | "AXIS_MEASURED" | "LOW_CONFIDENCE"; meta?: { title: string; subtitle: string } };
type PickStep = "baseline" | "top" | "bars";

const input = "rounded-md border border-slate-200 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none";
const secondary = "rounded-md border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40";

export function ScreenshotTab({ seed, onDone }: { seed: Blob | null; onDone: () => void }) {
  const [loaded, setLoaded] = useState<LoadedScreenshot | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const nextId = useRef(1);
  const fileRef = useRef<HTMLInputElement>(null);

  const colors = useMemo(() => (loaded ? sampleDominantColors(loaded.pixels) : []), [loaded]);

  const load = async (file: Blob) => {
    setError(null);
    setCandidate(null);
    try {
      const l = await loadScreenshot(file);
      setLoaded(l);
      setUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(l.blob);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open that image.");
    }
  };

  useEffect(() => {
    if (seed) void load(seed);
  }, [seed]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const offer = (table: ParsedTable, provenance: Candidate["provenance"], meta?: Candidate["meta"]) => setCandidate({ id: nextId.current++, table, provenance, meta });

  if (!loaded) {
    return (
      <div
        className="m-auto flex w-full max-w-md flex-col items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 p-10 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) void load(f);
        }}
      >
        <ImagePlus size={28} className="text-slate-400" />
        <p className="text-sm text-slate-700">Paste a chart screenshot (⌘V), drop one here, or choose a file.</p>
        <button className={secondary} onClick={() => fileRef.current?.click()}>
          Choose image…
        </button>
        <input ref={fileRef} type="file" hidden accept={SCREENSHOT_MIME_TYPES.join(",")} onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <p className="text-xs text-slate-400">The image is processed in your browser. It is only sent anywhere if you add a vision key and click Extract.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <div className="flex w-[360px] shrink-0 flex-col gap-3 overflow-auto">
        <Measurer loaded={loaded} url={url!} onBuild={(t) => offer(t, "AXIS_MEASURED")} colors={colors.map((c) => c.hex)} />
        <div>
          <p className="mb-1 text-xs font-medium text-slate-500">Colours found</p>
          <div className="flex flex-wrap gap-1.5">
            {colors.length === 0 && <span className="text-xs text-slate-400">No distinct colours found.</span>}
            {colors.map((c) => (
              <span key={c.hex} className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600" title={`${Math.round(c.share * 100)}% of coloured pixels`}>
                <span className="h-3 w-3 rounded-full" style={{ background: c.hex }} />
                {c.hex}
              </span>
            ))}
          </div>
        </div>
        <button className={secondary} onClick={() => (setLoaded(null), setCandidate(null))}>
          Use a different image
        </button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto">
        <AiExtract loaded={loaded} colors={colors} onResult={(t, meta) => offer(t, "LOW_CONFIDENCE", meta)} />
        <TypedData colors={colors.map((c) => c.hex)} onBuild={(t) => offer(t, "PARSED")} />
        {candidate && (
          <div className="flex min-h-[260px] flex-1 flex-col border-t border-slate-200 pt-3">
            <ParsedPreview key={candidate.id} table={candidate.table} provenance={candidate.provenance} meta={candidate.meta} onDone={onDone} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function AiExtract({ loaded, colors, onResult }: { loaded: LoadedScreenshot; colors: { hex: string }[]; onResult: (t: ParsedTable, meta: { title: string; subtitle: string }) => void }) {
  const { apiKey, model, error: storageError, set, clearKey } = useVisionStore();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const extract = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const provider = createAnthropicProvider(apiKey, model);
      const raw = await provider.extractChart(loaded.blob, { width: loaded.width, height: loaded.height, colors: colors.map((c) => c.hex) });
      const { chart, warnings } = validateExtraction(raw);
      if (!chart) {
        setMsg(warnings.join(" ") || "Couldn't read a chart from that image.");
        return;
      }
      const table = extractionToTable(chart, colors.map((c) => ({ hex: c.hex, share: 0 })));
      table.warnings.push(...warnings);
      onResult(table, { title: chart.title, subtitle: chart.subtitle });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Extraction failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-slate-200 p-3">
      <h3 className="mb-1 text-sm font-semibold text-slate-800">Extract with a vision model</h3>
      {apiKey ? (
        <div className="flex flex-wrap items-center gap-2">
          <button className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40" disabled={busy} onClick={extract}>
            {busy ? "Reading chart…" : "Extract chart"}
          </button>
          <span className="text-xs text-slate-500">Sends this image to the provider using your key.</span>
          <button className="ml-auto text-xs text-slate-500 underline hover:text-rose-600" onClick={clearKey}>
            Remove key
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input type="password" autoComplete="off" aria-label="Vision API key" placeholder="Anthropic API key (optional)" className={`${input} w-64`} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button className={secondary} disabled={draft.trim() === ""} onClick={() => (set({ apiKey: draft.trim() }), setDraft(""))}>
            Save key
          </button>
          <p className="w-full text-xs text-slate-400">Stored only in this browser's localStorage and sent only to the provider when you click Extract. No key? Use the manual options below.</p>
        </div>
      )}
      {(msg || storageError) && <p className="mt-2 text-sm text-rose-600">{msg ?? storageError}</p>}
    </section>
  );
}

function TypedData({ colors, onBuild }: { colors: string[]; onBuild: (t: ParsedTable) => void }) {
  const [text, setText] = useState("");
  const parsed = useMemo(() => parsePastedText(text), [text]);
  return (
    <section className="rounded-lg border border-slate-200 p-3">
      <h3 className="mb-1 text-sm font-semibold text-slate-800">Type or paste the numbers you can see</h3>
      <textarea
        aria-label="Values from the screenshot"
        className="h-20 w-full resize-none rounded-md border border-slate-200 p-2 font-mono text-xs focus:border-indigo-400 focus:outline-none"
        placeholder={"Q1\t42\nQ2\t58\nQ3\t51"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button className={`${secondary} mt-1.5`} disabled={!parsed} onClick={() => parsed && onBuild({ ...parsed, series: parsed.series.map((s, i) => ({ ...s, color: colors[i] })) })}>
        Preview with screenshot colours
      </button>
    </section>
  );
}

function Measurer({ loaded, url, colors, onBuild }: { loaded: LoadedScreenshot; url: string; colors: string[]; onBuild: (t: ParsedTable) => void }) {
  const [pick, setPick] = useState<PickStep>("baseline");
  const [baseline, setBaseline] = useState<number | null>(null);
  const [top, setTop] = useState<number | null>(null);
  const [topValue, setTopValue] = useState("100");
  const [tops, setTops] = useState<number[]>([]);
  const [labels, setLabels] = useState("");

  const click = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = Math.round(((e.clientY - r.top) / r.height) * loaded.height);
    if (pick === "baseline") (setBaseline(y), setPick("top"));
    else if (pick === "top") (setTop(y), setPick("bars"));
    else setTops((t) => [...t, y]);
  };

  const cal = baseline !== null && top !== null ? { baselinePx: baseline, baselineValue: 0, topTickPx: top, topTickValue: Number(topValue) } : null;
  const values = cal && tops.length ? valuesFromPixels(cal, tops) : null;
  const pct = (y: number) => `${(y / loaded.height) * 100}%`;
  const step = (id: PickStep, label: string) => (
    <button className={`rounded-md border px-2 py-1 text-xs ${pick === id ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600"}`} onClick={() => setPick(id)}>
      {label}
    </button>
  );

  return (
    <section className="rounded-lg border border-slate-200 p-3">
      <h3 className="mb-1 text-sm font-semibold text-slate-800">Measure bars from pixels</h3>
      <p className="mb-2 text-xs text-slate-500">Click the zero line, then a labelled top tick (enter its value), then each bar top.</p>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {step("baseline", "1 Zero line")}
        {step("top", "2 Top tick")}
        <input aria-label="Top tick value" inputMode="decimal" className={`${input} w-16 py-0.5 text-xs`} value={topValue} onChange={(e) => setTopValue(e.target.value)} />
        {step("bars", "3 Bar tops")}
      </div>
      <div className="relative cursor-crosshair select-none overflow-hidden rounded border border-slate-200" onClick={click}>
        <img src={url} alt="Uploaded chart screenshot" className="block w-full" draggable={false} />
        {baseline !== null && <div className="pointer-events-none absolute inset-x-0 h-px bg-emerald-500" style={{ top: pct(baseline) }} />}
        {top !== null && <div className="pointer-events-none absolute inset-x-0 h-px bg-violet-500" style={{ top: pct(top) }} />}
        {tops.map((y, i) => (
          <div key={i} className="pointer-events-none absolute inset-x-0 h-px bg-amber-500" style={{ top: pct(y) }} />
        ))}
      </div>
      {values && <p className="mt-1.5 text-xs text-slate-600">Measured: {values.join(", ")}</p>}
      <textarea aria-label="Bar labels" className="mt-2 h-14 w-full resize-none rounded-md border border-slate-200 p-2 text-xs focus:border-indigo-400 focus:outline-none" placeholder="Labels, one per line (optional)" value={labels} onChange={(e) => setLabels(e.target.value)} />
      <div className="mt-1.5 flex gap-2">
        <button
          className={secondary}
          disabled={!values}
          onClick={() => {
            if (!values) return;
            const given = labels.split("\n").map((l) => l.trim()).filter(Boolean);
            onBuild({
              labels: values.map((_, i) => given[i] ?? `Item ${i + 1}`),
              series: [{ name: "Value", values, included: true, color: colors[0] }],
              units: { prefix: "", suffix: "" },
              chart: "bar",
              warnings: ["Values were measured from pixel positions. Estimates can be off by a pixel or two."],
            });
          }}
        >
          Preview measured values
        </button>
        <button className={secondary} onClick={() => (setBaseline(null), setTop(null), setTops([]), setPick("baseline"))}>
          Reset
        </button>
      </div>
    </section>
  );
}
