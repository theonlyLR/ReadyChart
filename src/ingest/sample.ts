const base = (): string => import.meta.env.BASE_URL;

/**
 * The bundled demo screenshot: a chart inside browser chrome (so auto-crop has something to strip).
 * Rasterised from a same-origin SVG to a local PNG Blob, so the canvas is never tainted and no API key is needed.
 */
export async function loadSampleScreenshot(): Promise<Blob> {
  const img = new Image();
  img.src = `${base()}samples/sample-chart.svg`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 800;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't prepare the sample screenshot.");
  ctx.drawImage(img, 0, 0, 1280, 800);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't prepare the sample screenshot."))), "image/png"));
}

/** Canned vision output for the sample, replayed through the real pipeline (crop, 5x5 sampling, atomic apply). */
export async function loadSampleExtraction(): Promise<unknown> {
  const res = await fetch(`${base()}samples/sample-chart.extraction.json`);
  if (!res.ok) throw new Error("Couldn't load the sample extraction.");
  return res.json();
}
