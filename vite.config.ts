import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Export encoders run in an ES-module WebWorker; the jSquash WASM is resolved via import.meta.url, so it must not be pre-bundled.
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@jsquash/webp"] },
  test: { environment: "node", include: ["src/**/*.test.ts", "src/**/*.test.tsx"] },
});
