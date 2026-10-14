import { expandToGroups } from "@/features/groups/groups";
import { Box } from "@/features/snap/snap";
import { BitmapLayer } from "@/lib/project/schema";

/* Box selection ("marquee"): drag on an empty place of the select tool, and the layers the box reaches are selected.
 * Everything here is in original image pixels, so zoom, pan and devicePixelRatio cannot change the result. A layer's box is the
 * upright box around its real outline (turned, resized or warped), which `layerBox` gives. */

export type MarqueeMode = "touch" | "contain";
export type MarqueeCombine = "replace" | "add" | "toggle";

/** the box dragged from a to b (any corner first) */
export function boxFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** Does `layer`'s box touch the marquee (share at least a point), or lie completely inside it? */
export function reaches(layerBox: Box, marquee: Box, mode: MarqueeMode): boolean {
  if (mode === "contain") return layerBox.x >= marquee.x && layerBox.y >= marquee.y && layerBox.x + layerBox.width <= marquee.x + marquee.width && layerBox.y + layerBox.height <= marquee.y + marquee.height;
  return layerBox.x <= marquee.x + marquee.width && layerBox.x + layerBox.width >= marquee.x && layerBox.y <= marquee.y + marquee.height && layerBox.y + layerBox.height >= marquee.y;
}

/** The layers a marquee selects. Hidden layers never; locked layers yes (selecting is not editing; they still do not move or get deleted).
 *  A layer in a group brings its whole group, unless `wholeGroups` is false (Ctrl+drag: only the layers the box reaches). */
export function marqueeHits(layers: readonly BitmapLayer[], boxOf: (l: BitmapLayer) => Box | null, marquee: Box, mode: MarqueeMode, wholeGroups = true): string[] {
  const hit = layers.filter((l) => l.visible).filter((l) => {
    const b = boxOf(l);
    return !!b && reaches(b, marquee, mode);
  });
  const ids = hit.map((l) => l.id);
  return wholeGroups ? expandToGroups(layers, ids) : ids;
}

/** The selection after the drag: plain = the hits; Shift = the current selection plus the hits; Ctrl = the hits toggled in the current selection */
export function combineSelection(current: readonly string[], hits: readonly string[], how: MarqueeCombine): string[] {
  if (how === "replace") return [...hits];
  if (how === "add") return [...current, ...hits.filter((id) => !current.includes(id))];
  return [...current.filter((id) => !hits.includes(id)), ...hits.filter((id) => !current.includes(id))];
}

/** a drag shorter than this many SCREEN pixels is a click, not a box */
export const MARQUEE_MIN_SCREEN_DRAG = 4;
