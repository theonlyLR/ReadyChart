export interface Theme {
  ink: string;
  muted: string;
  /** Text drawn on top of series fills. */
  onAccent: string;
  /** Slice / marker separator colour. */
  surface: string;
  dark: boolean;
}

function parseHex(c: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luminance(color: string): number {
  const rgb = parseHex(color);
  if (!rgb) return 1;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function themeFor(background: string, transparent: boolean): Theme {
  const dark = !transparent && luminance(background) < 0.25;
  return dark
    ? { ink: "#F8FAFC", muted: "#94A3B8", onAccent: "#FFFFFF", surface: background, dark }
    : { ink: "#0F172A", muted: "#64748B", onAccent: "#FFFFFF", surface: transparent ? "#FFFFFF" : background, dark };
}
