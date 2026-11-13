import type { CellProvenance, ChartType } from "../model/types";
import { parseCellNumber } from "../model/dataOps";

/**
 * Deterministic (zero-AI) parser for pasted data: CSV/TSV, spreadsheet and markdown tables, JSON, bulleted lists,
 * "label: value" lines and even loose prose. Pure and DOM-free (except parseHtmlTable) so it is fully unit tested.
 * Numbers are never silently rescaled across units; mixed units become warnings the user can see.
 */

export interface ParsedSeries {
  name: string;
  values: (number | null)[];
  /** Series whose unit differs from the chart's unit start excluded; the user can tick them back on. */
  included: boolean;
  /** Per-cell provenance when the source knows better than a blanket "PARSED" (screenshot extraction). */
  provenance?: CellProvenance[];
  /** Series colour sampled from a screenshot. */
  color?: string;
}

export interface ParsedTable {
  labels: string[];
  series: ParsedSeries[];
  units: { prefix: string; suffix: string };
  chart: ChartType;
  warnings: string[];
}

const CURRENCY = "$€£¥₦";
const MAG_NORMAL: Record<string, string> = { k: "K", m: "M", mm: "M", b: "B", bn: "B", t: "T" };
const MAG_MULT: Record<string, number> = { "": 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

export interface UnitCell {
  /** number, null (blank) or undefined (unreadable) */
  value: number | null | undefined;
  prefix: string;
  /** "%" or a trailing currency symbol, "" if none */
  sym: string;
  /** "K" | "M" | "B" | "T" | "" */
  mag: string;
}

/** Parse one cell like "$4.2M", "12%", "£312.4k", "1.250,50 €", "(3.5)" into a number plus its unit pieces. */
export function parseUnitCell(text: string): UnitCell {
  let t = text.trim();
  let prefix = "";
  let sym = "";
  let mag = "";
  let neg = false;
  const par = /^\((.*)\)$/.exec(t);
  if (par) {
    neg = true;
    t = par[1]!.trim();
  }
  const lead = new RegExp(`^([-−–+]?)\\s*([${CURRENCY}])\\s*(.*)$`).exec(t);
  if (lead) {
    prefix = lead[2]!;
    t = lead[1]! + lead[3]!;
  }
  const trail = new RegExp(`^(.*?)\\s*([%${CURRENCY}])$`).exec(t);
  if (trail) {
    sym = trail[2]!;
    t = trail[1]!;
  }
  const m = /^(.*\d[\d.,]*)\s?(bn|mm|[kKmMbBtT])$/i.exec(t);
  if (m) {
    mag = MAG_NORMAL[m[2]!.toLowerCase()] ?? "";
    t = m[1]!;
  }
  const value = parseCellNumber((neg ? "-" : "") + t);
  return { value, prefix, sym, mag };
}

const isNum = (cell: string): boolean => typeof parseUnitCell(cell).value === "number";

/** Share of non-empty cells that read as numbers. */
function numRatio(cells: string[]): number {
  const nonEmpty = cells.filter((c) => c.trim() !== "");
  return nonEmpty.length === 0 ? 0 : nonEmpty.filter(isNum).length / nonEmpty.length;
}

const YEAR_RE = /^(19|20)\d{2}$/;

// ---------------------------------------------------------------------------------------------
// Chart suggestion
// ---------------------------------------------------------------------------------------------

const TIME_RE =
  /^(\d{4}([-/]\d{1,2}([-/]\d{1,2})?|[-/ ]?w\d{1,2}|[- ]?q[1-4])?|q[1-4]\b.*|fy\d{2,4}.*|h[12]\b.*|w\d{1,2}\b.*|\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b.*)$/i;

export function suggestChart(labels: string[], series: { values: (number | null)[] }[], suffix: string): ChartType {
  const n = labels.length;
  const nums = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (n === 0 || nums.length === 0) return "bar";
  const timeLike = labels.filter((l) => TIME_RE.test(l.trim())).length / n >= 0.7;
  if (timeLike) return n >= 8 ? "line" : "bar";
  const hasNeg = nums.some((v) => v < 0);
  if (series.length > 1) {
    const rowSums = labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
    const partsOfWhole = !hasNeg && suffix === "%" && rowSums.every((x) => Math.abs(x - 100) <= 3);
    return partsOfWhole ? "stacked-bar" : "bar";
  }
  const vals = series[0]!.values.filter((v): v is number => v !== null);
  const sum = vals.reduce((a, v) => a + v, 0);
  if (!hasNeg && n >= 2 && n <= 8 && (suffix === "%" || Math.abs(sum - 100) <= 3)) return "donut";
  const avgLabel = labels.reduce((a, l) => a + l.length, 0) / n;
  if (n > 12 && avgLabel > 8) return "horizontal-bar";
  return "bar";
}

// ---------------------------------------------------------------------------------------------
// Rows -> table
// ---------------------------------------------------------------------------------------------

interface ColUnits {
  prefix: string;
  sym: string;
  mag: string;
}

/** Unit hint hidden in a header such as "Revenue ($M)" or "Share (%)". Returns the cleaned name. */
function headerUnits(name: string): { name: string; units: ColUnits | null } {
  const m = /\(([^)]*)\)\s*$/.exec(name);
  if (!m) return { name, units: null };
  const hint = new RegExp(`^([${CURRENCY}])?\\s*(bn|mm|[kKmMbBtT])?\\s*([%${CURRENCY}])?$`).exec(m[1]!.trim());
  if (!hint || (!hint[1] && !hint[2] && !hint[3])) return { name, units: null };
  return {
    name: name.slice(0, m.index).trim() || name,
    units: { prefix: hint[1] ?? "", sym: hint[3] ?? "", mag: MAG_NORMAL[(hint[2] ?? "").toLowerCase()] ?? "" },
  };
}

function dominant(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = "";
  let bestN = 0;
  for (const [v, c] of counts) if (c > bestN || (c === bestN && v !== "" && best === "")) ((best = v), (bestN = c));
  return best;
}

interface Column {
  name: string;
  cells: string[];
}

function buildSeries(cols: Column[], warnings: string[]): { series: ParsedSeries[]; colUnits: ColUnits[] } {
  let unreadable = 0;
  const colUnits: ColUnits[] = [];
  const series: ParsedSeries[] = cols.map((col, ci) => {
    const parsed = col.cells.map(parseUnitCell);
    const numeric = parsed.filter((p) => typeof p.value === "number");
    const hint = headerUnits(col.name);
    // Cell-level units win; a header hint is only a fallback when the cells carry none.
    const u: ColUnits = {
      prefix: dominant(numeric.map((p) => p.prefix).filter(Boolean)) || hint.units?.prefix || "",
      sym: dominant(numeric.map((p) => p.sym).filter(Boolean)) || hint.units?.sym || "",
      mag: dominant(numeric.map((p) => p.mag).filter(Boolean)) || hint.units?.mag || "",
    };
    colUnits[ci] = u;
    let converted = false;
    const values = parsed.map((p, i) => {
      if (p.value === undefined) {
        if (col.cells[i]!.trim() !== "") unreadable++;
        return null;
      }
      if (p.value === null) return null;
      if (p.mag && u.mag && p.mag !== u.mag) {
        converted = true;
        return (p.value * MAG_MULT[p.mag]!) / MAG_MULT[u.mag]!;
      }
      return p.value;
    });
    if (converted) warnings.push(`"${hint.name}" mixed K/M/B values; converted everything to ${u.mag}.`);
    return { name: hint.name || `Series ${ci + 1}`, values, included: true };
  });
  if (unreadable > 0) warnings.push(`${unreadable} cell${unreadable === 1 ? " was" : "s were"} not readable as numbers and left empty.`);
  return { series, colUnits };
}

/** Turn a rectangular grid of strings into a table (header/label/orientation detection, units, chart suggestion). */
export function interpretRows(rowsIn: string[][]): ParsedTable | null {
  const warnings: string[] = [];
  let rows = rowsIn.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
  if (rows.length === 0) return null;
  const width = Math.max(...rows.map((r) => r.length));
  rows = rows.map((r) => (r.length < width ? r.concat(Array<string>(width - r.length).fill("")) : r));

  let labels: string[];
  let cols: Column[];

  const row0 = rows[0]!;
  const body = rows.slice(1);

  if (width === 1) {
    if (numRatio(rows.map((r) => r[0]!)) < 0.8) return null;
    labels = rows.map((_, i) => `Item ${i + 1}`);
    cols = [{ name: "Value", cells: rows.map((r) => r[0]!) }];
  } else if (rows.length === 2 && width >= 3 && numRatio(row0) === 0 && numRatio(rows[1]!) === 1) {
    // "Q1 Q2 Q3 / 10 20 30": one series laid out horizontally.
    labels = row0;
    cols = [{ name: "Value", cells: rows[1]! }];
  } else {
    const bodyData = body.flatMap((r) => r.slice(1));
    const bodyRatio = numRatio(bodyData);
    const col0Text = body.length > 0 && numRatio(body.map((r) => r[0]!)) < 0.4;
    const yearHeader = row0.slice(1).length >= 2 && row0.slice(1).every((c) => YEAR_RE.test(c)) && !isNum(row0[0]!);
    const hasHeader = body.length > 0 && bodyRatio >= 0.6 && (numRatio(row0.slice(1)) < 0.5 || (col0Text && yearHeader));

    if (hasHeader) {
      const dataRows = body;
      const dataCols = width - 1;
      if (col0Text && dataRows.length < dataCols) {
        // More columns than rows: the header holds the labels (series are laid out as rows).
        labels = row0.slice(1);
        cols = dataRows.map((r, i) => ({ name: r[0] || `Series ${i + 1}`, cells: r.slice(1) }));
      } else {
        labels = dataRows.map((r, i) => r[0] || `Item ${i + 1}`);
        cols = row0.slice(1).map((name, ci) => ({ name, cells: dataRows.map((r) => r[ci + 1]!) }));
      }
    } else if (numRatio(rows.map((r) => r[0]!)) < 0.4) {
      labels = rows.map((r) => r[0]!);
      cols = Array.from({ length: width - 1 }, (_, ci) => ({ name: width === 2 ? "Value" : `Series ${ci + 1}`, cells: rows.map((r) => r[ci + 1]!) }));
    } else if (rows.every((r) => YEAR_RE.test(r[0]!))) {
      labels = rows.map((r) => r[0]!);
      cols = Array.from({ length: width - 1 }, (_, ci) => ({ name: width === 2 ? "Value" : `Series ${ci + 1}`, cells: rows.map((r) => r[ci + 1]!) }));
    } else if (numRatio(rows.flat()) >= 0.8) {
      labels = rows.map((_, i) => `Item ${i + 1}`);
      cols = Array.from({ length: width }, (_, ci) => ({ name: width === 1 ? "Value" : `Series ${ci + 1}`, cells: rows.map((r) => r[ci]!) }));
    } else {
      return null;
    }
  }

  const { series, colUnits } = buildSeries(cols, warnings);
  if (series.every((s) => s.values.every((v) => v === null))) return null;

  // The document has one unit for the whole chart: take the first series', and leave out series that disagree.
  const base = colUnits[0]!;
  series.forEach((s, i) => {
    const u = colUnits[i]!;
    if (i > 0 && (u.prefix !== base.prefix || u.sym !== base.sym || u.mag !== base.mag)) {
      s.included = false;
      warnings.push(`"${s.name}" uses different units than "${series[0]!.name}", so it was left out. Tick it to include it anyway.`);
    }
  });
  const units = { prefix: base.prefix, suffix: base.mag + base.sym };
  const chart = suggestChart(labels, series.filter((s) => s.included), units.suffix);
  return { labels, series, units, chart, warnings };
}

// ---------------------------------------------------------------------------------------------
// Text -> rows
// ---------------------------------------------------------------------------------------------

/** Quote-aware split on a single-character delimiter. */
export function splitDelimited(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"', i++);
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur.trim() === "") quoted = true;
    else if (ch === delim) (out.push(cur), (cur = ""));
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const MD_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function delimitedRows(lines: string[]): string[][] | null {
  if (lines.length < 2) return null;
  const strategies: { test: (l: string) => boolean; split: (l: string) => string[] }[] = [
    { test: (l) => l.includes("\t"), split: (l) => splitDelimited(l, "\t") },
    { test: (l) => l.includes("|"), split: (l) => splitDelimited(l.replace(/^\s*\|/, "").replace(/\|\s*$/, ""), "|") },
    { test: (l) => l.includes(";"), split: (l) => splitDelimited(l, ";") },
    { test: (l) => l.includes(","), split: (l) => splitDelimited(l, ",") },
    { test: (l) => /\S\s{2,}\S/.test(l), split: (l) => l.trim().split(/\s{2,}/) },
  ];
  for (const st of strategies) {
    if (lines.filter(st.test).length / lines.length < 0.7) continue;
    const rows = lines.map(st.split);
    const counts = new Map<number, number>();
    for (const r of rows) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
    let modal = 0;
    let modalN = 0;
    for (const [len, c] of counts) if (c > modalN) ((modal = len), (modalN = c));
    if (modal < 2 || modalN / rows.length < 0.7) continue;
    // "Lagos 1,250" is a thousands separator, not a column break.
    const thousands = rows.filter((r) => r.slice(1).some((c, i) => /^\d{3}$/.test(c.trim()) && /\d$/.test(r[i]!.trim()))).length;
    if (thousands / rows.length > 0.5) continue;
    return rows;
  }
  return null;
}

const BULLET = /^\s*(?:[-*•·▪‣–]|\d+[.)])\s+/;
const TRAILING_NUMBER = new RegExp(`^(.*?\\S)\\s+([-−(]?[${CURRENCY}]?\\s?\\d[\\d.,]*\\s?(?:bn|mm|[%kKmMbBtT${CURRENCY}])?\\)?)$`);

function lineRows(lines: string[]): { rows: string[][]; skipped: number } {
  const rows: string[][] = [];
  let skipped = 0;
  for (const raw of lines) {
    const l = raw.replace(BULLET, "").trim();
    const m = /^(.*?)\s*[:=]\s*(\S.*)$/.exec(l) ?? /^(.*?)\s+[-–—]\s+(\S.*)$/.exec(l) ?? TRAILING_NUMBER.exec(l);
    if (m && m[1]!.trim() !== "" && isNum(m[2]!)) rows.push([m[1]!.trim(), m[2]!.trim()]);
    else skipped++;
  }
  return { rows, skipped };
}

const NUMBER_TOKEN = `[${CURRENCY}]?\\s?-?\\d[\\d.,]*\\s?(?:bn|mm|[%kKmMbB${CURRENCY}])?`;
const PROSE_CLAUSE = new RegExp(`([A-Z][\\p{L}-]+(?: [A-Z][\\p{L}-]+)*)(?:\\s+[a-z]+){0,3}\\s+(${NUMBER_TOKEN})(?![\\p{L}\\d])`, "u");

/** Last resort: "Lagos hit ₦48,500,000 (+18%), London closed at £312.4k" -> [[Lagos, ₦48,500,000], [London, £312.4k]]. */
function proseRows(raw: string): string[][] {
  const rows: string[][] = [];
  for (const clause of raw.split(/[,;]\s+(?:and\s+)?|\n|\.\s+/)) {
    const m = PROSE_CLAUSE.exec(clause.replace(/\([^)]*\)/g, ""));
    if (m && isNum(m[2]!)) rows.push([m[1]!, m[2]!.trim()]);
  }
  return rows;
}

function jsonRows(raw: string): string[][] | null {
  if (!/^\s*[[{]/.test(raw)) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
  if (Array.isArray(data) && data.length > 0 && data.every((d) => d && typeof d === "object" && !Array.isArray(d))) {
    const keys = Object.keys(data[0] as object);
    return [keys, ...data.map((d) => keys.map((k) => str((d as Record<string, unknown>)[k])))];
  }
  if (Array.isArray(data) && data.every((d) => Array.isArray(d))) return (data as unknown[][]).map((r) => r.map(str));
  if (data && typeof data === "object" && !Array.isArray(data)) return Object.entries(data).map(([k, v]) => [k, str(v)]);
  return null;
}

/** Parse arbitrary pasted text. Returns null when nothing numeric could be recovered. */
export function parsePastedText(raw: string): ParsedTable | null {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (text === "") return null;

  const fromJson = jsonRows(text);
  if (fromJson) {
    const t = interpretRows(fromJson);
    if (t) return t;
  }

  const lines = text.split("\n").filter((l) => l.trim() !== "" && !MD_SEPARATOR.test(l));
  const grid = delimitedRows(lines);
  if (grid) {
    const t = interpretRows(grid);
    if (t) return t;
  }

  const { rows, skipped } = lineRows(lines);
  if (rows.length >= 2) {
    const t = interpretRows(rows);
    if (t) {
      if (skipped > 0) t.warnings.push(`${skipped} line${skipped === 1 ? "" : "s"} without a number ${skipped === 1 ? "was" : "were"} skipped.`);
      return t;
    }
  }

  const prose = proseRows(text);
  if (prose.length >= 1) {
    const t = interpretRows(prose);
    if (t) {
      t.warnings.push("Read from free text. Double-check every label and value.");
      return t;
    }
  }
  return null;
}

/** Pull the first <table> out of clipboard HTML (browser only). */
export function parseHtmlTable(html: string): ParsedTable | null {
  if (typeof DOMParser === "undefined") return null;
  const table = new DOMParser().parseFromString(html, "text/html").querySelector("table");
  if (!table) return null;
  const rows = [...table.querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("th,td")].map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim()));
  return interpretRows(rows);
}
