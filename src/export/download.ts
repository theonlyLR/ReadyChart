export function fileNameFor(title: string, format: string, scale: number): string {
  const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "chart";
  const suffix = format === "svg" || scale === 1 ? "" : `@${scale}x`;
  return `${slug}${suffix}.${format}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
