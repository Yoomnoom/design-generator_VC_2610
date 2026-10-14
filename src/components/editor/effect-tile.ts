import { layerEffectTile } from "@/lib/image/render-export";
import { renderLayerOf } from "@/features/export-image/export-png";
import { BitmapLayer } from "@/lib/project/schema";
import { ImageCache } from "@/store/images";
import { rawToCanvas } from "./raw-canvas";

/** the on-screen picture of a layer with effects: the same tile the PNG export makes, cached while nothing about the layer changes */
export type EffectTile = { canvas: HTMLCanvasElement; x: number; y: number; width: number; height: number };
const cache = new Map<string, EffectTile | null>();
const LIMIT = 6; // a tile of a big layer is large: only the few in use are kept

export function effectTileFor(layer: BitmapLayer, images: ImageCache, frame: { width: number; height: number }): EffectTile | null {
  const key = JSON.stringify([layer.id, layer.imageId, layer.transform, layer.content, layer.warp, layer.effects, frame.width, frame.height, layer.imageId ? images.get(layer.imageId)?.raw.width : 0]);
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