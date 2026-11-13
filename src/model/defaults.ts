import type { AspectPreset, ChartDocument, ChartType } from "./types";

export const ASPECT_PRESETS: Record<Exclude<AspectPreset, "custom">, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
};

export const SERIES_PALETTE = ["#6366F1", "#F59E0B", "#10B981", "#EF4444", "#06B6D4", "#A855F7", "#EC4899", "#84CC16"];

export function createDefaultDocument(): ChartDocument {
  return {
    id: "doc-default",
    title: "Quarterly Revenue",
    subtitle: "Revenue by quarter, in $M",
    sourceFooter: "Source: Internal finance",
    canvas: {
      ...ASPECT_PRESETS["16:9"],
      aspectPreset: "16:9",
      background: "#FFFFFF",
      transparent: false,
      textColor: null,
      padding: [72, 96, 72, 96],
    },
    data: {
      locale: "en-US",
      unitPrefix: "$",
      unitSuffix: "M",
      compactNotation: false,
      labels: ["Q1", "Q2", "Q3", "Q4"],
      series: [
        {
          id: "s1",
          name: "Revenue",
          color: SERIES_PALETTE[0]!,
          values: [42, 58, 51, 77],
          provenance: ["USER_INPUT", "USER_INPUT", "USER_INPUT", "USER_INPUT"],
        },
      ],
    },
    geometry: {
      type: "bar",
      barRadius: [8, 8, 0, 0],
      barGapRatio: 0.3,
      strokeWidth: 4,
      curveTension: 0.5,
      donutInnerRatio: 0.6,
      yMin: "auto",
      yMax: "auto",
      showAxisBreak: false,
      showGridlines: true,
      gridlineOpacity: 0.12,
      showDataLabels: true,
      showXAxis: true,
      showYAxis: true,
      dataLabelPosition: "outside-top",
      groupSmallSlicesBelowPct: 3,
    },
    motion: {
      enabled: false,
      physicsMode: "bezier",
      durationMs: 1200,
      easing: [0.22, 1, 0.36, 1],
      springStiffness: 170,
      springDamping: 22,
      staggerMs: 60,
      maxTotalStaggerMs: 600,
      staggerDirection: "left-to-right",
      numberRollUp: true,
      holdEndMs: 1000,
      loopResetMs: 400,
      totalDurationMs: null,
    },
    brand: {
      logoDataUrl: null,
      anchor: "top-right",
      sizePx: 64,
      opacity: 1,
      contrastBackdrop: "none",
      logoAspect: 1,
      logoLuminance: 0.5,
      logoInvertedDataUrl: null,
      fontFamily: "inter",
    },
  };
}

/** Single-series document from a fixture-style {labels, values} pair. */
export function createDocumentFromColumns(labels: string[], values: number[], title: string, type: ChartType = "bar"): ChartDocument {
  const doc = createDefaultDocument();
  doc.title = title;
  doc.subtitle = "";
  doc.sourceFooter = "";
  doc.geometry.type = type;
  doc.data.labels = labels;
  doc.data.unitPrefix = "";
  doc.data.unitSuffix = "";
  doc.data.series = [
    { id: "s1", name: "Value", color: SERIES_PALETTE[0]!, values, provenance: values.map(() => "USER_INPUT" as const) },
  ];
  return doc;
}
