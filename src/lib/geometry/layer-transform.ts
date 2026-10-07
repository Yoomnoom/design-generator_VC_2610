import { Point } from "./coords";

/* A layer's placement (see BitmapLayer.transform in schema.ts): a bitmap pixel p lands at T(x, y) · R(rotation) · S(sx, sy) · p.
 * Frame pixels, y down, rotation in degrees and clockwise on screen. This is the same model Konva uses for a node whose
 * offset is (0, 0), so the canvas and the exported PNG are placed by the same rule. */

export type LayerTransform = { x: number; y: number; scaleX: number; scaleY: number; rotation: number };

/** a layer needs no resampling when it is only moved */
export const isOnlyMoved = (t: LayerTransform) => t.scaleX === 1 && t.scaleY === 1 && t.rotation === 0;

/** Exact values at multiples of 90°, so a quarter turn lands every pixel on a pixel instead of a hair off it. */
export function cosSin(degrees: number): { cos: number; sin: number } {
  const turns = degrees / 90;
  if (Number.isInteger(turns)) {
    const q = ((turns % 4) + 4) % 4;
    return [{ cos: 1, sin: 0 }, { cos: 0, sin: 1 }, { cos: -1, sin: 0 }, { cos: 0, sin: -1 }][q];
  }
  const r = (degrees * Math.PI) / 180;
  return { cos: Math.cos(r), sin: Math.sin(r) };
}

/** a point in the bitmap's own pixels (0…width, 0…height) → frame pixels */
export function layerPointToFrame(t: LayerTransform, p: Point): Point {
  const { cos, sin } = cosSin(t.rotation);
  const sx = p.x * t.scaleX;
  const sy = p.y * t.scaleY;
  return { x: t.x + cos * sx - sin * sy + 0, y: t.y + sin * sx + cos * sy + 0 };
}

/** frame pixels → the bitmap's own pixels; the inverse of layerPointToFrame */
export function frameToLayerPoint(t: LayerTransform, p: Point): Point {
  const { cos, sin } = cosSin(t.rotation);
  const dx = p.x - t.x;
  const dy = p.y - t.y;
  return { x: (cos * dx + sin * dy) / t.scaleX + 0, y: (-sin * dx + cos * dy) / t.scaleY + 0 };
}

/** the four corners in frame pixels, in the order top-left, top-right, bottom-right, bottom-left of the bitmap */
export const layerCorners = (t: LayerTransform, width: number, height: number): Point[] =>
  [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }].map((c) => layerPointToFrame(t, c));

/** the smallest upright rectangle around the placed layer */
export function layerBounds(t: LayerTransform, width: number, height: number) {
  const c = layerCorners(t, width, height);
  const xs = c.map((p) => p.x);
  const ys = c.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** the layer's own width and height once scaled (before rotation) */
export const scaledSize = (t: LayerTransform, width: number, height: number) => ({ width: width * Math.abs(t.scaleX), height: height * Math.abs(t.scaleY) });

/** an angle in degrees, brought into (-180, 180] */
export function normalizeRotation(degrees: number): number {
  const r = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return r === -180 ? 180 : r;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 50;

const clampScale = (s: number) => Math.sign(s || 1) * Math.min(Math.max(Math.abs(s), MIN_SCALE), MAX_SCALE);
const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places + 0;

/** What the editor stores for a placement that came from a drag: finite, scale kept within limits and never 0,
 *  rotation within (-180, 180], and numbers rounded to a precision nobody can see, so files do not fill up with noise. */
export function sanitizeTransform(t: LayerTransform): LayerTransform | null {
  if (![t.x, t.y, t.scaleX, t.scaleY, t.rotation].every(Number.isFinite)) return null;
  return { x: round(t.x, 2), y: round(t.y, 2), scaleX: round(clampScale(t.scaleX), 4), scaleY: round(clampScale(t.scaleY), 4), rotation: round(normalizeRotation(t.rotation), 2) };
}
