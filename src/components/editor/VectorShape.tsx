"use client";

import type { ComponentProps } from "react";
import { Shape } from "react-konva";
import { DrawCtx, drawContent } from "@/lib/image/vector";
import { LayerContent } from "@/lib/project/schema";

type Props = { content: LayerContent } & Omit<ComponentProps<typeof Shape>, "sceneFunc" | "hitFunc" | "width" | "height" | "fill" | "stroke" | "strokeEnabled">;

/** the browser's own 2D context behind Konva's wrapper: drawContent draws on it exactly as the PNG export draws on an OffscreenCanvas */
const rawContext = (ctx: unknown) => (ctx as { _context: DrawCtx })._context;

/** the smallest thickness a line is clickable at, in image pixels, so a 1px line can still be picked */
const MIN_LINE_HIT = 10;

/** A vector layer on the canvas. It draws with the same drawContent the export uses; only the hit area is its own: the shape itself
 *  (a line gets a thickened strip), so clicking beside a shape does not grab it. */
export default function VectorShape({ content, ...rest }: Props) {
  return (
    <Shape
      {...rest}
      width={content.width}
      height={content.height}
      fill="#000" // only the hit graph reads it; the scene is drawn by sceneFunc
      strokeEnabled={false}
      sceneFunc={(ctx) => drawContent(rawContext(ctx), content)}
      hitFunc={(ctx, shape) => {
        const { width: w, height: h } = content;
        ctx.beginPath();
        if (content.kind !== "line") {
          if (content.kind === "ellipse") ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2, false);
          else ctx.rect(0, 0, w, h);
        } else {
          const [x0, y0, x1, y1] = content.direction === "down" ? [0, 0, w, h] : [0, h, w, 0];
          const len = Math.hypot(x1 - x0, y1 - y0) || 1;
          const half = Math.max(content.strokeWidth, MIN_LINE_HIT) / 2;
          const nx = (-(y1 - y0) / len) * half;
          const ny = ((x1 - x0) / len) * half;
          ctx.moveTo(x0 + nx, y0 + ny);
          ctx.lineTo(x1 + nx, y1 + ny);
          ctx.lineTo(x1 - nx, y1 - ny);
          ctx.lineTo(x0 - nx, y0 - ny);
        }
        ctx.closePath();
        ctx.fillShape(shape);
      }}
    />
  );
}
