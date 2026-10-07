import { Point } from "@/lib/geometry/coords";
import { BackgroundPatch } from "@/lib/project/schema";

/** The patch painted over an image-space point. Patches draw in array order, so the last one covering the point is the one on top. */
export function patchAt(patches: readonly BackgroundPatch[], point: Point): BackgroundPatch | null {
  for (let i = patches.length - 1; i >= 0; i--) {
    const { x, y, width, height } = patches[i].rect;
    if (point.x >= x && point.x < x + width && point.y >= y && point.y < y + height) return patches[i];
  }
  return null;
}
