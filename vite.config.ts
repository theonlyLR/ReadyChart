import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { scanChartProxy } from "./server/scanProxy.ts";

export default defineConfig(({ mode }) => {
  // Empty prefix: read GEMINI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY from .env.local on the server only.
  // They have no VITE_ prefix, so they are never exposed to client code or written to the build.
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), tailwindcss(), scanChartProxy(env)],
    // Export encoders run in an ES-module WebWorker; the jSquash WASM is resolved via import.meta.url, so it must not be pre-bundled.
    worker: { format: "es" as const },
    optimizeDeps: { exclude: ["@jsquash/webp"] },
    test: { environment: "node", include: ["src/**/*.test.ts", "src/**/*.test.tsx", "server/**/*.test.ts"] },
  };
});
