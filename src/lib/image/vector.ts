import { LayerTransform, layerPointToFrame } from "../geometry/layer-transform";
import { LayerContent, Rect } from "../project/schema";

/* Vector layers: a description (LayerContent) and one function that draws it. The canvas on screen and the PNG export both call
 * drawContent, so what you see and what you save cannot drift apart; only the pixel grid they are drawn onto differs. */

/** the part of a 2D canvas context that drawing needs; both CanvasRenderingContext2D and OffscreenCanvasRenderingContext2D fit */
export type DrawCtx = {
  beginPath(): void;
  closePath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  fill(): void;
  stroke(): void;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
};

export const MIN_VECTOR_SIDE = 1;
export const MAX_STROKE_WIDTH = 200;

export const contentSize = (c: LayerContent) => ({ width: c.width, height: c.height });
export const contentStroke = (c: LayerContent): string | null => c.stroke;
export const contentFill = (c: LayerContent): string | null => (c.kind === "line" ? null : c.fill);

/** how far the stroke reaches outside the box (a stroke is centred on the edge) */
export const strokeOverhang = (c: LayerContent) => (c.stroke && c.strokeWidth > 0 ? c.strokeWidth / 2 : 0);

/** the box plus whatever the stroke adds around it, in the layer's own pixels */
export function contentBounds(c: LayerContent): Rect {
  const m = strokeOverhang(c);
  return { x: -m + 0, y: -m + 0, width: c.width + 2 * m, height: c.height + 2 * m }; // (+ 0 turns -0 into 0)
}

/** The upright rectangle (frame pixels) a placed vector layer can touch, stroke included. */
export function vectorFrameBounds(c: LayerContent, t: LayerTransform): Rect {
  const b = contentBounds(c);
  const placed = { ...t, scaleX: 1, scaleY: 1 }; // a vector layer is never scaled: its size is in the content
  const corners = [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x + b.width, y: b.y + b.height },
    { x: b.x, y: b.y + b.height },
  ].map((p) => layerPointToFrame(placed, p));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Draws the layer's content with its top-left at the context's current origin. */
export function drawContent(ctx: DrawCtx, c: LayerContent): void {
  ctx.lineJoin = "miter";
  ctx.beginPath();
  if (c.kind === "line") {
    if (c.direction === "down") {
      ctx.moveTo(0, 0);
      ctx.lineTo(c.width, c.height);
    } else {
      ctx.moveTo(0, c.height);
      ctx.lineTo(c.width, 0);
    }
    ctx.lineCap = "butt";
    ctx.lineWidth = c.strokeWidth;
    ctx.strokeStyle = c.stroke;
    if (c.strokeWidth > 0) ctx.stroke();
    return;
  }
  if (c.kind === "rect") ctx.rect(0, 0, c.width, c.height);
  else ctx.ellipse(c.width / 2, c.height / 2, c.width / 2, c.height / 2, 0, 0, Math.PI * 2);
  if (c.fill) {
    ctx.fillStyle = c.fill;
    ctx.fill();
  }
  if (c.stroke && c.strokeWidth > 0) {
    ctx.lineWidth = c.strokeWidth;
    ctx.strokeStyle = c.stroke;
    ctx.stroke();
  }
}

const clampSide = (v: number) => Math.max(MIN_VECTOR_SIDE, Math.round(v * 100) / 100);

/** the same shape with a new box; sizes stay positive, strokes keep their thickness */
export const withSize = (c: LayerContent, width: number, height: number): LayerContent => ({ ...c, width: clampSide(width), height: clampSide(height) });

/** the content a fresh drag from (x0, y0) to (x1, y1) describes, and where its top-left sits; null when it is too small to be one */
export function shapeFromDrag(kind: LayerContent["kind"], a: { x: number; y: number }, b: { x: number; y: number }, style: { stroke: string; fill: string | null; strokeWidth: number }): { content: LayerContent; x: number; y: number } | null {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.abs(a.x - b.x);
  const height = Math.abs(a.y - b.y);
  if (kind === "line") {
    if (Math.hypot(width, height) < 2) return null;
    const down = (b.x - a.x) * (b.y - a.y) >= 0; // same sign: the segment runs top-left to bottom-right
    return { x, y, content: { kind: "line", width: Math.max(width, MIN_VECTOR_SIDE), height: Math.max(height, MIN_VECTOR_SIDE), direction: down ? "down" : "up", stroke: style.stroke, strokeWidth: Math.max(style.strokeWidth, 1) } };
  }
  if (width < 2 || height < 2) return null;
  return { x, y, content: { kind, width, height, stroke: style.strokeWidth > 0 ? style.stroke : null, strokeWidth: style.strokeWidth, fill: style.fill } as LayerContent };
}

export const SHAPE_LABEL: Record<LayerContent["kind"], string> = { rect: "사각형", ellipse: "원", line: "선" };
