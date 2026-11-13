import type { CSSProperties } from "react";
import { FONT_FAMILY } from "../engine/types";
import type { SceneNode } from "../engine/types";

interface Props {
  nodes: SceneNode[];
  width: number;
  height: number;
  /** Extra CSS (e.g. @font-face) injected as a <style> element — used by the SVG exporter. */
  css?: string;
  style?: CSSProperties;
  /** Font stack for all text (defaults to Inter). */
  fontFamily?: string;
}

const translate = (tx?: number, ty?: number) => (tx || ty ? `translate(${tx ?? 0} ${ty ?? 0})` : undefined);

/** Renders the scene model as SVG. Used for the live canvas and (via renderToStaticMarkup) the SVG export. */
export function SvgScene({ nodes, width, height, css, style, fontFamily = FONT_FAMILY }: Props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={style} fontFamily={fontFamily}>
      {css ? <style>{css}</style> : null}
      {nodes.map((n, i) => {
        switch (n.kind) {
          case "rect":
            return <rect key={i} x={n.x} y={n.y} width={n.width} height={n.height} fill={n.fill} opacity={n.opacity} />;
          case "path":
            return (
              <path
                key={i}
                d={n.d}
                transform={translate(n.tx, n.ty)}
                fill={n.fill ?? "none"}
                stroke={n.stroke}
                strokeWidth={n.strokeWidth}
                strokeLinejoin={n.linejoin}
                opacity={n.opacity}
              />
            );
          case "line":
            return <line key={i} x1={n.x1} y1={n.y1} x2={n.x2} y2={n.y2} stroke={n.stroke} strokeWidth={n.strokeWidth} opacity={n.opacity} />;
          case "text":
            return (
              <text
                key={i}
                x={n.x}
                y={n.y}
                fontSize={n.fontSize}
                fontWeight={n.fontWeight}
                fill={n.fill}
                textAnchor={n.anchor}
                opacity={n.opacity}
                transform={n.rotate ? `rotate(${n.rotate} ${n.x} ${n.y})` : undefined}
              >
                {n.text}
              </text>
            );
          case "image":
            return <image key={i} href={n.href} x={n.x} y={n.y} width={n.width} height={n.height} preserveAspectRatio="xMidYMid meet" opacity={n.opacity} />;
        }
      })}
    </svg>
  );
}
