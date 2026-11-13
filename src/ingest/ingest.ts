import { useDocumentStore } from "../store/documentStore";
import { NO_COMPARE, useUiStore } from "../store/uiStore";
import { parsePastedText } from "./parseTable";
import { startScan } from "./scanController";
import { applyParsedTable } from "./toDocument";

const TYPE_NAME: Record<string, string> = {
  bar: "bar",
  "horizontal-bar": "horizontal bar",
  "stacked-bar": "stacked bar",
  line: "line",
  area: "area",
  pie: "pie",
  donut: "donut",
};

/** Raw text / CSV / TSV -> chart with zero modals. Deterministic parser, no AI. Returns whether a chart was built. */
export function ingestText(text: string): boolean {
  const ui = useUiStore.getState();
  const table = parsePastedText(text);
  if (!table || table.series.every((s) => !s.included)) {
    ui.showToast({ message: "Couldn't find any numbers to chart in that text.", tone: "error" });
    return false;
  }
  const store = useDocumentStore.getState();
  store.replaceDoc(applyParsedTable(store.doc, table, { mode: "replace", chart: table.chart, provenance: "PARSED" }));
  ui.setCompare(NO_COMPARE);
  const rows = table.labels.length;
  ui.showToast({
    message: `Built a ${TYPE_NAME[table.chart] ?? table.chart} chart from ${rows} row${rows === 1 ? "" : "s"}.`,
    actionLabel: "Undo",
    onAction: () => {
      useDocumentStore.getState().undo();
      useUiStore.getState().dismissToast();
    },
  });
  return true;
}

const TEXT_FILE = /\.(csv|tsv|txt|json|md)$/i;

/** A dropped or uploaded file: image -> scan, text-like -> parse, anything else -> a friendly toast. */
export async function ingestFile(file: File): Promise<void> {
  if (file.type.startsWith("image/")) return startScan(file);
  if (file.type.startsWith("text/") || file.type === "application/json" || TEXT_FILE.test(file.name)) {
    ingestText(await file.text());
    return;
  }
  useUiStore.getState().showToast({ message: "Drop a PNG, JPG or WebP screenshot, or a CSV/TSV file.", tone: "error" });
}
