import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SceneNode } from "../engine/types";
import { SvgScene } from "../render/SvgScene";

/** Standalone SVG file text. External (non data:) image URLs are dropped so the file is fully self-contained. */
export function serializeSvg(nodes: SceneNode[], width: number, height: number, fontCss: string, fontFamily?: string): string {
  const safe = nodes.filter((n) => n.kind !== "image" || n.href.startsWith("data:"));
  const markup = renderToStaticMarkup(createElement(SvgScene, { nodes: safe, width, height, css: fontCss, fontFamily }));
  return `<?xml version="1.0" encoding="UTF-8"?>\n${markup}`;
}
