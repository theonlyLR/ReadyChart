import type { ChartDocument } from "../model/types";

type DataFmt = ChartDocument["data"];
const cache = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, compact: boolean): Intl.NumberFormat {
  const key = `${locale}|${compact}`;
  let f = cache.get(key);
  if (!f) {
    const opts: Intl.NumberFormatOptions = { notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : 2 };
    try {
      f = new Intl.NumberFormat(locale, opts);
    } catch {
      f = new Intl.NumberFormat("en-US", opts);
    }
    cache.set(key, f);
  }
  return f;
}

/** "-$14.2M": sign first, then prefix, number, suffix. */
export function formatValue(data: DataFmt, v: number): string {
  const body = formatter(data.locale, data.compactNotation).format(Math.abs(v));
  const sign = v < 0 && Number(body.replace(/[^0-9.]/g, "")) !== 0 ? "-" : "";
  return `${sign}${data.unitPrefix}${body}${data.unitSuffix}`;
}

export function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(fraction < 0.1 ? 1 : 0)}%`;
}
