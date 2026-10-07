import { BitmapLayer } from "@/lib/project/schema";

/** back-to-front draw order; layers sharing a zIndex keep their array order */
export const sortByZ = (layers: readonly BitmapLayer[]): BitmapLayer[] =>
  layers
    .map((layer, i) => ({ layer, i }))
    .sort((a, b) => a.layer.zIndex - b.layer.zIndex || a.i - b.i)
    .map(({ layer }) => layer);

/** renumbers zIndex to 0…n-1 in the current draw order */
export const normalizeZ = (layers: readonly BitmapLayer[]): BitmapLayer[] => sortByZ(layers).map((layer, z) => ({ ...layer, zIndex: z }));

/** new layers go on top */
export const addOnTop = (layers: readonly BitmapLayer[], layer: BitmapLayer): BitmapLayer[] =>
  normalizeZ([...layers, { ...layer, zIndex: layers.reduce((m, l) => Math.max(m, l.zIndex), -1) + 1 }]);

export const removeLayer = (layers: readonly BitmapLayer[], id: string): BitmapLayer[] => normalizeZ(layers.filter((l) => l.id !== id));

/** one step toward the front (+1) or back (-1); no change at either end */
export function moveLayer(layers: readonly BitmapLayer[], id: string, direction: 1 | -1): BitmapLayer[] {
  const sorted = normalizeZ(layers);
  const from = sorted.findIndex((l) => l.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= sorted.length) return sorted;
  [sorted[from], sorted[to]] = [sorted[to], sorted[from]];
  return sorted.map((layer, z) => ({ ...layer, zIndex: z })); // array order is now the draw order
}
