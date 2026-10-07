import { Rect } from "../project/schema";
import { isInside } from "../geometry/rect";
import { RawImage } from "./raw-image";

/** Copies `rect` out of the original image. The result is exactly rect.width × rect.height and keeps alpha untouched. */
export function cropRaw(source: RawImage, rect: Rect): RawImage {
  if (!isInside(rect, source)) throw new RangeError(`crop ${JSON.stringify(rect)} is not a whole-pixel rectangle inside ${source.width}×${source.height}`);
  const data = new Uint8ClampedArray(rect.width * rect.height * 4);
  const rowBytes = rect.width * 4;
  for (let row = 0; row < rect.height; row++) {
    const from = ((rect.y + row) * source.width + rect.x) * 4;
    data.set(source.data.subarray(from, from + rowBytes), row * rowBytes);
  }
  return { width: rect.width, height: rect.height, data };
}
