import { layerEffectTile } from "@/lib/image/render-export";
import { renderLayerOf } from "@/features/export-image/export-png";
import { BitmapLayer } from "@/lib/project/schema";
import { ImageCache } from "@/store/images";
import { shrinkToFit } from "@/features/assets/preview";
import { adjustedPicture, applyAdjustments, hasAdjust } from "@/lib/image/adjust";
import { RawImage } from "@/lib/image/raw-image";
import { LayerAdjust } from "@/lib/project/schema";
import { rawToCanvas } from "./raw-canvas";

/** the on-screen picture of a layer with effects: the same tile the PNG export makes, cached while nothing about the layer changes */
export type EffectTile = { canvas: HTMLCanvasElement; x: number; y: number; width: number; height: number };
const cache = new Map<string, EffectTile | null>();
const LIMIT = 6; // a tile of a big layer is large: only the few in use are kept

export function effectTileFor(layer: BitmapLayer, images: ImageCache, frame: { width: number; height: number }): EffectTile | null {
  const key = JSON.stringify([layer.id, layer.imageId, layer.transform, layer.content, layer.warp, layer.effects, layer.adjust, frame.width, frame.height, layer.imageId ? images.get(layer.imageId)?.raw.width : 0]);
  if (cache.has(key)) return cache.get(key)!;
  let tile: EffectTile | null = null;
  try {
    const rl = renderLayerOf(layer, images, frame);
    const t = rl && layerEffectTile({ ...rl, visible: true }, frame);
    if (t) tile = { canvas: rawToCanvas(t.image), x: t.x, y: t.y, width: t.image.width, height: t.image.height };
  } catch {
    tile = null;
  }
  cache.set(key, tile);
  if (cache.size > LIMIT) cache.delete(cache.keys().next().value as string);
  return tile;
}
/** The picture to draw for a bitmap layer with adjustments. While a slider is being dragged (`quick`) the adjustment is made on a reduced copy
 *  (at most 480 pixels a side) and drawn scaled up, so the drag stays smooth; the finished picture is the full-size one. */
const quickCache = new Map<string, RawImage>();
export function adjustedForScreen(image: RawImage, adjust: LayerAdjust | undefined, quick: boolean): RawImage {
  if (!hasAdjust(adjust)) return image;
  if (!quick || Math.max(image.width, image.height) <= 480) return adjustedPicture(image, adjust);
  const key = `${image.width}x${image.height}|${image.data.byteLength}|${JSON.stringify(adjust)}|${quickKey(image)}`;
  let hit = quickCache.get(key);
  if (!hit) {
    hit = applyAdjustments(shrinkToFit(image, 480, 480), adjust);
    quickCache.set(key, hit);
    if (quickCache.size > 6) quickCache.delete(quickCache.keys().next().value as string);
  }
  return hit;
}
let ids = 0;
const idOf = new WeakMap<RawImage, number>();
const quickKey = (image: RawImage) => idOf.get(image) ?? (idOf.set(image, ++ids), ids);