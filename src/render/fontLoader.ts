import { fontDef } from "../engine/fonts";
import { resetMeasurer } from "./measurer";
import { useUiStore } from "../store/uiStore";

/** Loads both weights of a brand font, then drops stale measurements and tells the canvas to re-layout. */
export async function loadFontFamily(id: string | undefined): Promise<void> {
  const { family } = fontDef(id);
  await Promise.all([document.fonts.load(`400 16px ${family}`), document.fonts.load(`600 16px ${family}`)]);
  resetMeasurer();
  useUiStore.setState((s) => ({ fontsVersion: s.fontsVersion + 1 }));
}
