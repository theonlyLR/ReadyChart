import { fontDef } from "../engine/fonts";
import { CUSTOM_FONT_FAMILY, dataUrlToBuffer } from "../brand/fontIngest";
import type { CustomFont } from "../model/types";
import { resetMeasurer } from "./measurer";
import { useUiStore } from "../store/uiStore";

let registered: { dataUrl: string; face: FontFace } | null = null;

/**
 * Registers the uploaded font under the single CUSTOM_FONT_FAMILY name on the main thread (the export worker
 * registers its own copy from the same Data URL). Idempotent; swapping files replaces the old face.
 * Returns true when the registered face changed, so callers know cached measurements are stale.
 */
export async function registerCustomFont(font: CustomFont | undefined): Promise<boolean> {
  if (!font) return false;
  if (registered?.dataUrl === font.dataUrl) return false;
  const face = new FontFace(CUSTOM_FONT_FAMILY, dataUrlToBuffer(font.dataUrl), { weight: "100 900", style: "normal" });
  await face.load();
  if (registered) document.fonts.delete(registered.face);
  document.fonts.add(face);
  registered = { dataUrl: font.dataUrl, face };
  resetMeasurer();
  return true;
}

/** Loads both weights of a brand font, then drops stale measurements and tells the canvas to re-layout. */
export async function loadFontFamily(id: string | undefined, customFont?: CustomFont): Promise<void> {
  const { family } = fontDef(id);
  if (id === "custom") await registerCustomFont(customFont).catch(() => false);
  await Promise.all([document.fonts.load(`400 16px ${family}`), document.fonts.load(`600 16px ${family}`)]);
  resetMeasurer();
  useUiStore.setState((s) => ({ fontsVersion: s.fontsVersion + 1 }));
}
