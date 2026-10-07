import { LayerTransform, cosSin } from "../geometry/layer-transform";
import { LayerContent } from "../project/schema";
import { RawImage } from "./raw-image";
import { DrawCtx, drawContent, strokeOverhang, vectorFrameBounds } from "./vector";

/** A vector layer drawn into a bitmap at 1:1, positioned at whole frame pixels. */
export type Rasterized = { image: RawImage; x: number; y: number };

export type Rasterize = (content: LayerContent, transform: LayerTransform, frame: { width: number; height: number }) => Rasterized | null;

/** A vector layer's picture on its own (upright, margin for the stroke), for the clipboard. Browser only. */
export function rasterizeContentAlone(content: LayerContent, rasterize: Rasterize = rasterizeVectorLayer): RawImage | null {
  const m = Math.ceil(strokeOverhang(content));
  const frame = { width: Math.ceil(content.width) + 2 * m + 1, height: Math.ceil(content.height) + 2 * m + 1 };
  return rasterize(content, { x: m, y: m, scaleX: 1, scaleY: 1, rotation: 0 }, frame)?.image ?? null;
}

/** Draws the layer exactly as the canvas does (same drawContent, same translate and rotate), onto a canvas that covers only the part
 *  of the layer inside the frame. The bitmap then composites as a plain moved layer, so nothing is resampled and the edges keep the
 *  anti-aliasing the canvas gave them. Browser only (needs OffscreenCanvas). */
export const rasterizeVectorLayer: Rasterize = (content, t, frame) => {
  const b = vectorFrameBounds(content, t);
  const x0 = Math.max(0, Math.floor(b.x));
  const y0 = Math.max(0, Math.floor(b.y));
  const x1 = Math.min(frame.width, Math.ceil(b.x + b.width));
  const y1 = Math.min(frame.height, Math.ceil(b.y + b.height));
  if (x1 <= x0 || y1 <= y0) return null;
  const canvas = new OffscreenCanvas(x1 - x0, y1 - y0);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas is not available");
  const { cos, sin } = cosSin(t.rotation);
  ctx.setTransform(1, 0, 0, 1, -x0, -y0);
  ctx.transform(cos, sin, -sin, cos, t.x, t.y);
  drawContent(ctx as unknown as DrawCtx, content);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { image: { width, height, data }, x: x0, y: y0 };
};
