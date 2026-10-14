import { layerBox } from "@/features/snap/layer-box";
import { Box } from "@/features/snap/snap";
import { MeasureFor, fitHeight } from "@/lib/image/text-measure";
import { MIN_VECTOR_SIDE } from "@/lib/image/vector";
import { BitmapLayer, LayerContent } from "@/lib/project/schema";

/* Free transform of a whole selection: one box around it, one scale or turn applied to every layer about the same point, so the
 * layers keep their positions and proportions relative to each other (a shadow stays under its button).
 *
 * What a layer can take (the simple rules, written down because a layer is  T · R · S  and cannot be sheared):
 *  - a uniform scale (and any turn) goes to every layer;
 *  - a stretch (different horizontal and vertical factors) goes only to layers turned by a multiple of 90°: the factors are swapped for
 *    a layer turned by 90°/270°. A selection with a layer at any other angle can only be scaled proportionally (`canStretch`);
 *  - a scale and a turn are separate gestures, so a stretch never has to be mixed with a turn;
 *  - warped layers (and memos, which are not layers) are not scaled; a warped layer's position follows. A turn does turn it;
 *  - vector layers keep their stroke width: the factor goes into the shape's width and height (a text box: its width, the lines
 *    then decide the height, the letters keep their size). Bitmaps take it in `scale`.
 * Locked layers do not take part at all (they stay where they are, as in a group move). */

export type Point = { x: number; y: number };
export type FreeOp =
  | { kind: "scale"; sx: number; sy: number; pivot: Point }
  | { kind: "rotate"; degrees: number; center: Point }
  | { kind: "move"; dx: number; dy: number };

export type LayerResult = { transform: BitmapLayer["transform"]; content?: LayerContent };
export type Sizes = (l: BitmapLayer) => { width: number; height: number } | undefined;

const r2 = (v: number) => Math.round(v * 100) / 100;
const mod = (deg: number, m: number) => ((deg % m) + m) % m;
/** the layer is turned by a multiple of 90° (within a hair) */
export const quarterTurn = (rotation: number) => {
  const q = mod(rotation, 90);
  return q < 0.01 || q > 89.99;
};
const swapped = (rotation: number) => Math.abs(mod(rotation, 180) - 90) < 0.01;

/** the layers a free transform acts on: not locked */
export const transformable = (layers: readonly BitmapLayer[]) => layers.filter((l) => !l.locked);

/** the upright box around the selected layers that are shown (their real outlines) */
export function selectionBox(layers: readonly BitmapLayer[], sizes: Sizes): Box | null {
  const boxes = layers.filter((l) => l.visible).map((l) => layerBox(l, sizes(l))).filter((b): b is Box => !!b);
  if (boxes.length === 0) return null;
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)), y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Can the horizontal and vertical factors differ? Not when a (scaled) layer stands at an angle that is not a multiple of 90°. */
export const canStretch = (layers: readonly BitmapLayer[]) => transformable(layers).filter((l) => !l.warp).every((l) => quarterTurn(l.transform.rotation));

/** the smallest factor every shape can take without going under the minimum side */
export function minFactor(layers: readonly BitmapLayer[]): number {
  let m = 0.02;
  for (const l of transformable(layers)) if (l.content && !l.warp) m = Math.max(m, MIN_VECTOR_SIDE / Math.max(Math.min(l.content.width, l.content.height), MIN_VECTOR_SIDE));
  return Math.min(m, 1);
}

/** What one layer becomes under `op`. `measure` refits a text box's height. */
export function applyToLayer(layer: BitmapLayer, op: FreeOp, measure: MeasureFor): LayerResult {
  const t = layer.transform;
  const next = { ...t };
  let content = layer.content ? ({ ...layer.content } as LayerContent) : undefined;
  if (op.kind === "move") {
    next.x = r2(t.x + op.dx);
    next.y = r2(t.y + op.dy);
    return { transform: next, content };
  }
  if (op.kind === "rotate") {
    const a = (op.degrees * Math.PI) / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    const dx = t.x - op.center.x, dy = t.y - op.center.y;
    next.x = r2(op.center.x + dx * cos - dy * sin);
    next.y = r2(op.center.y + dx * sin + dy * cos);
    next.rotation = r2(mod(t.rotation + op.degrees + 180, 360) - 180); // kept in -180..180
    return { transform: next, content };
  }
  // scale about the pivot: the layer's top-left corner (its rotation centre) is a point like any other
  next.x = r2(op.pivot.x + (t.x - op.pivot.x) * op.sx);
  next.y = r2(op.pivot.y + (t.y - op.pivot.y) * op.sy);
  if (layer.warp) return { transform: next, content }; // a warped layer is only carried along
  const uniform = Math.abs(op.sx - op.sy) < 1e-9;
  // the factors in the layer's own axes: swapped when the layer stands on its side; a layer at another angle can only take a uniform one
  const swap = swapped(t.rotation);
  const fx = uniform ? op.sx : swap ? op.sy : op.sx;
  const fy = uniform ? op.sy : swap ? op.sx : op.sy;
  if (!uniform && !quarterTurn(t.rotation)) return { transform: next, content }; // cannot be stretched: stays at its size (the caller keeps stretches off such selections)
  if (content) {
    content.width = Math.max(MIN_VECTOR_SIDE, r2(content.width * fx));
    if (content.kind === "text") content.height = fitHeight(content, measure); // the lines decide the height; the letters keep their size
    else content.height = Math.max(MIN_VECTOR_SIDE, r2(content.height * fy));
    if (content.kind === "rect" && content.cornerRadius !== undefined) content.cornerRadius = Math.min(content.cornerRadius, Math.floor((Math.min(content.width, content.height) / 2) * 100) / 100);
  } else {
    next.scaleX = r2(t.scaleX * fx * 1000) / 1000 || t.scaleX;
    next.scaleY = r2(t.scaleY * fy * 1000) / 1000 || t.scaleY;
    if (next.scaleX === 0) next.scaleX = t.scaleX;
    if (next.scaleY === 0) next.scaleY = t.scaleY;
  }
  return { transform: next, content };
}

/** Every layer's result for `op`, in one go (the preview and the commit both use this, so they cannot differ). Locked layers are left out. */
export function applyFreeTransform(layers: readonly BitmapLayer[], op: FreeOp, measure: MeasureFor): Map<string, LayerResult> {
  const out = new Map<string, LayerResult>();
  for (const l of transformable(layers)) out.set(l.id, applyToLayer(l, op, measure));
  return out;
}

export type HandleKind = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate";
export const ROTATE_GAP = 28; // screen pixels above the top edge

/** a handle's position on the box, in image pixels (the rotate handle is placed by the caller, above the top centre) */
export function handlePoint(box: Box, h: Exclude<HandleKind, "rotate">): Point {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const x = h.includes("w") ? box.x : h.includes("e") ? box.x + box.width : cx;
  const y = h.includes("n") ? box.y : h.includes("s") ? box.y + box.height : cy;
  return { x, y };
}
const opposite = (h: Exclude<HandleKind, "rotate">): Exclude<HandleKind, "rotate"> => ({ nw: "se", n: "s", ne: "sw", e: "w", se: "nw", s: "n", sw: "ne", w: "e" } as const)[h];

/** The scale op a handle drag makes. `pointer` is where the pointer is now (image pixels). Shift = proportional, Alt = about the centre;
 *  `stretch` false forces proportional. The pivot is the opposite handle (or the box centre). */
export function scaleFromDrag(box: Box, handle: Exclude<HandleKind, "rotate">, pointer: Point, o: { shift: boolean; alt: boolean; stretch: boolean; min: number }): FreeOp {
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const pivot = o.alt ? centre : handlePoint(box, opposite(handle));
  const grab = handlePoint(box, handle);
  const dx0 = grab.x - pivot.x, dy0 = grab.y - pivot.y;
  let sx = handle === "n" || handle === "s" || dx0 === 0 ? 1 : (pointer.x - pivot.x) / dx0;
  let sy = handle === "e" || handle === "w" || dy0 === 0 ? 1 : (pointer.y - pivot.y) / dy0;
  const edge = handle === "n" || handle === "s" || handle === "e" || handle === "w";
  const proportional = o.shift || !o.stretch;
  if (proportional) {
    // a corner takes the larger of the two; an edge drives both factors from its own axis
    const s = edge ? (handle === "n" || handle === "s" ? sy : sx) : Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy;
    sx = s;
    sy = s;
  }
  const clamp = (v: number) => Math.max(o.min, v); // never flips or collapses
  return { kind: "scale", sx: clamp(sx), sy: clamp(sy), pivot };
}

/** The turn a drag of the rotate handle makes: from the pointer's angle at the start to its angle now, about the box centre. Shift = 15° steps. */
export function rotateFromDrag(box: Box, start: Point, pointer: Point, shift: boolean): FreeOp {
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const a0 = Math.atan2(start.y - c.y, start.x - c.x), a1 = Math.atan2(pointer.y - c.y, pointer.x - c.x);
  let deg = ((a1 - a0) * 180) / Math.PI;
  deg = ((deg + 540) % 360) - 180;
  if (shift) deg = Math.round(deg / 15) * 15;
  return { kind: "rotate", degrees: r2(deg), center: c };
}
