/**
 * CSS for the split swatch shown in place of a single colour when every bar has its own colour: equal hard-stop
 * bands, one per distinct colour in item order (capped so it stays readable at 24 px).
 */
export function splitGradient(colors: string[], max = 6): string {
  const shown = colors.slice(0, max);
  if (shown.length === 0) return "transparent";
  if (shown.length === 1) return shown[0]!;
  const step = 100 / shown.length;
  const stops = shown.map((c, i) => `${c} ${+(i * step).toFixed(2)}% ${+((i + 1) * step).toFixed(2)}%`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}
