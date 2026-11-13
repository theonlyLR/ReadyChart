import { useRef, useState } from "react";
import type { ChartDocument, ContrastBackdrop } from "../../model/types";
import { FONT_IDS, FONTS } from "../../engine/fonts";
import { resolveLogoTreatment } from "../../brand/contrast";
import { ingestLogo, LOGO_MIME_TYPES } from "../../brand/logoIngest";
import { useDocumentStore } from "../../store/documentStore";
import { Section, SelectField, SliderField } from "./fields";

type Anchor = ChartDocument["brand"]["anchor"];

const ANCHORS: { value: Anchor; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
];

const BACKDROPS: { value: ContrastBackdrop; label: string }[] = [
  { value: "none", label: "None" },
  { value: "frosted-pill", label: "Frosted pill" },
  { value: "auto-invert", label: "Auto-invert" },
];

const px = (v: number) => `${Math.round(v)}px`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function BrandSection() {
  const doc = useDocumentStore((s) => s.doc);
  const update = useDocumentStore((s) => s.update);
  const { brand } = doc;
  const inputRef = useRef<HTMLInputElement>(null);
  // Ephemeral UI only: the upload error message and drag-hover highlight. The logo itself lives in the document.
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const treatment = resolveLogoTreatment(doc);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const asset = await ingestLogo(file);
      setError(null);
      update((d) => {
        d.brand.logoDataUrl = asset.dataUrl;
        d.brand.logoInvertedDataUrl = asset.invertedDataUrl;
        d.brand.logoAspect = asset.aspect;
        d.brand.logoLuminance = asset.luminance;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load that logo.");
    }
  };

  const remove = () =>
    update((d) => {
      d.brand.logoDataUrl = null;
      d.brand.logoInvertedDataUrl = null;
      d.brand.logoAspect = 1;
      d.brand.logoLuminance = 0.5;
    });

  return (
    <Section title="Brand">
      <div
        className={`flex flex-col items-center gap-2 rounded-lg border border-dashed px-3 py-3 text-center text-xs ${over ? "border-indigo-400 bg-indigo-50" : "border-slate-300 bg-slate-50"}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload(e.dataTransfer.files[0]);
        }}
      >
        {brand.logoDataUrl ? (
          <img src={brand.logoDataUrl} alt="Current logo" className="max-h-12 max-w-full rounded bg-[repeating-conic-gradient(#e2e8f0_0%_25%,#f8fafc_0%_50%)] bg-[length:12px_12px] object-contain" />
        ) : (
          <span className="text-slate-500">Drop a PNG, SVG, JPG or WebP logo</span>
        )}
        <div className="flex gap-2">
          <button className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-100" onClick={() => inputRef.current?.click()}>
            {brand.logoDataUrl ? "Replace" : "Upload logo"}
          </button>
          {brand.logoDataUrl && (
            <button className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-medium text-red-600 hover:bg-red-50" onClick={remove}>
              Remove
            </button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          hidden
          accept={LOGO_MIME_TYPES.join(",")}
          aria-label="Logo file"
          onChange={(e) => {
            void upload(e.target.files?.[0]);
            e.target.value = ""; // allow re-selecting the same file
          }}
        />
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}

      {brand.logoDataUrl && (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Anchor</span>
            <div className="grid grid-cols-2 gap-1.5">
              {ANCHORS.map((a) => (
                <button
                  key={a.value}
                  aria-pressed={brand.anchor === a.value}
                  className={`rounded-md border px-2 py-1 text-xs ${brand.anchor === a.value ? "border-indigo-500 bg-indigo-50 font-medium text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                  onClick={() => update((d) => void (d.brand.anchor = a.value))}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
          <SliderField label="Logo size" value={brand.sizePx} min={24} max={320} format={px} onChange={(v) => update((d) => void (d.brand.sizePx = v))} />
          <SliderField label="Logo opacity" value={brand.opacity} min={0.1} max={1} step={0.01} format={pct} onChange={(v) => update((d) => void (d.brand.opacity = v))} />
          <SelectField label="Contrast backdrop" value={brand.contrastBackdrop} options={BACKDROPS} onChange={(v) => update((d) => void (d.brand.contrastBackdrop = v))} />
          {treatment?.inverted && <p className="text-xs text-slate-500">Logo inverted for contrast on this background.</p>}
        </>
      )}

      <SelectField label="Typeface" value={brand.fontFamily} options={FONT_IDS.map((id) => ({ value: id, label: FONTS[id].label }))} onChange={(v) => update((d) => void (d.brand.fontFamily = v))} />
    </Section>
  );
}
