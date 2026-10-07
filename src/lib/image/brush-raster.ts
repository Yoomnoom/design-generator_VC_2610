import { RawImage } from "./raw-image";

export type Pt = { x: number; y: number };
export type IRect = { x: number; y: number; width: number; height: number };

/** a finished stroke in frame pixels */
export type StrokeSpec = { points: Pt[]; size: number; color: string; erase: boolean };

/** Longest stroke kept (points). A stroke that long is already a scribble; more points would only slow the preview. */
export const MAX_STROKE_POINTS = 20000;
export const MIN_BRUSH_SIZE = 1;
export const MAX_BRUSH_SIZE = 200;

/** the whole-pixel box a stroke can touch (its points plus half the brush, plus a pixel for the soft edge) */
export function strokeBounds(points: readonly Pt[], size: number): IRect | null {
  if (points.length === 0) return null;
  const pad = Math.ceil(size / 2) + 1;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = Math.floor(Math.min(...xs)) - pad;
  const y0 = Math.floor(Math.min(...ys)) - pad;
  return { x: x0, y: y0, width: Math.ceil(Math.max(...xs)) + pad - x0, height: Math.ceil(Math.max(...ys)) + pad - y0 };
}

export function intersectRect(a: IRect, b: IRect): IRect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

export function unionRect(a: IRect, b: IRect): IRect {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  return { x: x0, y: y0, width: Math.max(a.x + a.width, b.x + b.width) - x0, height: Math.max(a.y + a.height, b.y + b.height) - y0 };
}

export type Base = { raw: RawImage; x: number; y: number };
export type Painted = { raw: RawImage; x: number; y: number };

/** Paints a stroke onto a layer's bitmap and returns the new bitmap (the old one is never touched) and where it sits.
 *  A brush stroke may grow the bitmap, but only within the frame; an eraser stroke never changes its size. Null: nothing to change. */
export type PaintStroke = (base: Base | null, stroke: StrokeSpec, frame: { width: number; height: number }) => Painted | null;

/** Browser implementation: a round-capped, round-joined stroke on a canvas, so the edge is anti-aliased. */
export const paintStroke: PaintStroke = (base, stroke, frame) => {
  const sb = strokeBounds(stroke.points, stroke.size);
  if (!sb) return null;
  const baseRect = base ? { x: base.x, y: base.y, width: base.raw.width, height: base.raw.height } : null;
  let target: IRect;
  if (stroke.erase) {
    if (!baseRect || !intersectRect(baseRect, sb)) return null; // an eraser only removes what is there
    target = baseRect;
  } else {
    const inFrame = intersectRect(sb, { x: 0, y: 0, width: frame.width, height: frame.height });
    if (!inFrame) return null;
    target = baseRect ? unionRect(baseRect, inFrame) : inFrame;
  }
  const canvas = new OffscreenCanvas(target.width, target.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas is not available");
  if (base && baseRect) ctx.putImageData(new ImageData(new Uint8ClampedArray(base.raw.data), base.raw.width, base.raw.height), baseRect.x - target.x, baseRect.y - target.y);
  ctx.translate(-target.x, -target.y);
  ctx.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
  ctx.strokeStyle = stroke.erase ? "#000000" : stroke.color;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = stroke.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const [first, ...rest] = stroke.points;
  if (rest.length === 0) {
    ctx.beginPath();
    ctx.arc(first.x, first.y, stroke.size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (const p of rest) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  const { data, width, height } = ctx.getImageData(0, 0, target.width, target.height);
  return { raw: { width, height, data }, x: target.x, y: target.y };
};
