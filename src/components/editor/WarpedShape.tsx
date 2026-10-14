"use client";

import type { ComponentProps } from "react";
import { useMemo } from "react";
import { Shape } from "react-konva";
import { LayerWarp } from "@/lib/project/schema";
import { RawImage } from "@/lib/image/raw-image";
import { MAX_RASTER_PIXELS, WarpPlacement, rasterizeWarped, warpedOutlineLocal } from "@/lib/image/warp-raster";
import { warpInverse } from "@/lib/image/warp";
import { rawToCanvas } from "./raw-canvas";

type Props = {
  image: RawImage;
  warp: LayerWarp;
  /** scale and rotation of the layer: the raster has them baked in, so the node itself stays upright at scale 1 */
  placement: WarpPlacement;
  /** the frame, relative to the layer's origin: a raster that would be enormous is cut down to this */
  frame: { x: number; y: number; width: number; height: number };
  /** changes when the picture was painted on (a finger stroke) without being replaced, so the raster is made again */
  rev?: number;
  /** true while a warp drag is going on: the picture is drawn at a lower resolution to keep the drag smooth */
  dragging: boolean;
} & Omit<ComponentProps<typeof Shape>, "sceneFunc" | "hitFunc" | "width" | "height" | "fill" | "stroke" | "strokeEnabled" | "scaleX" | "scaleY" | "rotation">;

/** A layer whose bent shape covers no more than this many pixels is previewed at full resolution while dragging; a bigger one at about
 *  PREVIEW_PIXELS (so a 4000 × 3000 layer stays workable). The real picture is drawn at full resolution when the pointer is released. */
const PREVIEW_FULL_PIXELS = 150_000;
const PREVIEW_PIXELS = 40_000;
/** a raster bigger than this is cut to the frame (so it is redrawn when the layer moves; a normal one is not) */
const UNCLIPPED_PIXELS = 16_000_000;

/** A warped bitmap layer on the canvas. Its pixels come from rasterizeWarped, the very function the PNG export uses, so the screen and the
 *  file agree. The node sits at the layer's origin with no scale or rotation of its own (those are baked into the raster); its hit area is
 *  the warped outline, so clicks follow the bent shape. */
export default function WarpedShape({ image, warp, placement, frame, dragging, rev = 0, ...rest }: Props) {
  const { scaleX, scaleY, rotation } = placement;
  const raster = useMemo(() => {
    const t = { scaleX, scaleY, rotation };
    const outline = warpedOutlineLocal(warpInverse(warp, image.width, image.height), t);
    const xs = outline.map((p) => p.x), ys = outline.map((p) => p.y);
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    const step = dragging && area > PREVIEW_FULL_PIXELS ? Math.ceil(Math.sqrt(area / PREVIEW_PIXELS)) : 1;
    const clip = area > UNCLIPPED_PIXELS ? frame : undefined;
    return { r: rasterizeWarped(image, t, warp, { step, clip }), outline };
    // the frame only matters for a raster too big to keep whole, which is the only case it is part of the key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, rev, warp, scaleX, scaleY, rotation, dragging, frame.x, frame.y, frame.width, frame.height]);
  const { r, outline } = raster;
  return (
    <Shape
      {...rest}
      scaleX={1} // the layer's scale and rotation are baked into the raster; the node itself stays upright (callers pass them along with the rest)
      scaleY={1}
      rotation={0}
      width={r ? r.image.width * r.step : 1}
      height={r ? r.image.height * r.step : 1}
      fill="#000" // only the hit graph reads it
      strokeEnabled={false}
      sceneFunc={(ctx) => {
        if (!r || r.image.width * r.image.height > MAX_RASTER_PIXELS) return;
        (ctx as unknown as { _context: CanvasRenderingContext2D })._context.drawImage(rawToCanvas(r.image), r.x, r.y, r.image.width * r.step, r.image.height * r.step);
      }}
      hitFunc={(ctx, shape) => {
        ctx.beginPath();
        outline.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
        ctx.fillShape(shape);
      }}
    />
  );
}
