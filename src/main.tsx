import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/lora/400.css";
import "@fontsource/lora/600.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/600.css";
import "./index.css";
import App from "./App.tsx";
import { resetMeasurer } from "./render/measurer";
import { useUiStore } from "./store/uiStore";

// Re-measure text with real Inter metrics once the webfont is available.
void Promise.all([document.fonts.load("400 16px Inter"), document.fonts.load("600 16px Inter")]).then(() => {
  resetMeasurer();
  useUiStore.setState({ fontsReady: true });
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
