import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { runNodeHandler } from "./nodeAdapter.ts";
import { DEV_MAX_BODY_BYTES } from "./scanCore.ts";
import type { Env, Route } from "./scanCore.ts";

/**
 * Vite dev/preview wrapper around server/scanCore.ts: mounts POST /api/scan-chart (+ GET /status) and POST
 * /api/refine-chart so `npm run dev` and `vite preview` work without deploying. Production guards (origin check, rate
 * limit, 6 MB cap) are off here; the Vercel Functions in api/ run the same core with them on.
 */
export function scanChartProxy(env: Env): Plugin {
  type Server = { middlewares: { use: (path: string, fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } };
  const mount = (server: Server, route: Route, prefix: string) =>
    server.middlewares.use(prefix, (req, res, next) => {
      const path = (req.url ?? "/").split("?")[0] || "/"; // Connect has already stripped the mount prefix
      const known = route === "scan" ? (req.method === "GET" && path === "/status") || (req.method === "POST" && path === "/") : req.method === "POST" && path === "/";
      if (!known) return next();
      void runNodeHandler(route, req, res, env, { enforce: false, maxBodyBytes: DEV_MAX_BODY_BYTES });
    });
  const both = (server: Server) => {
    mount(server, "scan", "/api/scan-chart");
    mount(server, "refine", "/api/refine-chart");
  };
  return { name: "readychart-scan-chart", configureServer: both, configurePreviewServer: both };
}
