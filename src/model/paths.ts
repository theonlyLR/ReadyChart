// Root JSON-pointer prefixes. M4's RFC 6902 style-patch guard allows only STYLE_ROOTS (never /data/series).
export const STYLE_ROOTS = ["/geometry", "/motion", "/canvas", "/brand"] as const;
export const DATA_ROOT = "/data";

export function isStylePath(path: string): boolean {
  return STYLE_ROOTS.some((r) => path === r || path.startsWith(r + "/"));
}
