import type { IncomingMessage, ServerResponse } from "node:http";
import { runNodeHandler } from "../server/nodeAdapter.ts";

/**
 * Vercel Function for /api/refine-chart. All logic lives in server/scanCore.ts (shared with the Vite dev middleware).
 * Reads GEMINI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY, the optional *_MODEL overrides and ALLOWED_ORIGINS
 * from process.env. Guards (same-host/ALLOWED_ORIGINS check, 15 req/min/IP, 6 MB cap) apply when NODE_ENV=production.
 */
export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return runNodeHandler("refine", req, res, process.env, { enforce: process.env.NODE_ENV === "production" });
}
