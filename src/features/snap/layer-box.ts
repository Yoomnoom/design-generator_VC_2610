import { layerPointToFrame } from "@/lib/geometry/layer-transform";
import { vectorFrameBounds } from "@/lib/image/vector";
import { BitmapLayer } from "@/lib/project/schema";
import { Box } from "./snap";

/** The upright box a placed layer covers in the frame, after any resizing and turning (a turned layer's box is the one around it).
 *  `image` is the layer's bitmap size; a vector layer needs none. Null when the layer has nothing to measure. */
export function layerBox(layer: BitmapLayer, image: { width: number; height: number } | undefined): Box | null {
  if (layer.content) return vectorFrameBounds(layer.content, layer.transform);
  if (!image) return null;
  const corners = [
    { x: 0, y: 0 },
    { x: image.width, y: 0 },
    { x: image.width, y: image.height },
    { x: 0, y: image.height },
  ].map((p) => layerPointToFrame(layer.transform, p));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
