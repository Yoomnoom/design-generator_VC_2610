import { Rect } from "../project/schema";
import { Point, clampToImage, roundToPixel } from "./coords";

type Size = { width: number; height: number };

/** The pixel rectangle between two image-space drag corners, or null if it has no area.
 *  Corners are rounded to whole pixels and held inside the image, so the order they were dragged in is irrelevant. */
export function selectionFromImagePoints(a: Point, b: Point, image: Size): Rect | null {
  const p = clampToImage(roundToPixel(a), image);
  const q = clampToImage(roundToPixel(b), image);
  const rect = { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(p.x - q.x), height: Math.abs(p.y - q.y) };
  return rect.width < 1 || rect.height < 1 ? null : rect;
}

export const isInside = (rect: Rect, image: Size) =>
  Number.isInteger(rect.x) && Number.isInteger(rect.y) && Number.isInteger(rect.width) && Number.isInteger(rect.height) &&
  rect.width >= 1 && rect.height >= 1 && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= image.width && rect.y + rect.height <= image.height;
