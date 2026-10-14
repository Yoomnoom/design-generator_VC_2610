import { layerBox } from "@/features/snap/layer-box";
import { sortByZ } from "@/features/layer-transform/order";
import { BitmapLayer } from "@/lib/project/schema";
import { ImageCache } from "@/store/images";
import { AssetBundle, AssetLayer } from "./types";

/** Turns layers of the screen into a source: positions become relative to the top-left of the group, vector layers keep their description,
 *  bitmap layers keep their picture (shared when several layers use one). Null when there is nothing usable. */
export function captureBundle(name: string, layers: readonly BitmapLayer[], images: ImageCache): AssetBundle | null {
  const ordered = sortByZ(layers); // back to front, so inserting them in this order keeps the stacking
  const boxes = ordered.map((l) => layerBox(l, l.imageId ? images.get(l.imageId)?.raw : undefined));
  if (ordered.length === 0 || boxes.some((b) => !b)) return null;
  const x0 = Math.min(...boxes.map((b) => b!.x)), y0 = Math.min(...boxes.map((b) => b!.y));
  const out: AssetLayer[] = [];
  const pictures: AssetBundle["images"] = {};
  for (const l of ordered) {
    if (!l.content) {
      const raw = l.imageId ? images.get(l.imageId)?.raw : undefined;
      if (!l.imageId || !raw) return null;
      pictures[l.imageId] = raw;
    }
    out.push({
      name: l.name,
      crop: { ...l.crop },
      ...(l.content ? { content: JSON.parse(JSON.stringify(l.content)) } : { imageKey: l.imageId }),
      ...(l.drawn ? { drawn: true } : {}),
      ...(l.warp ? { warp: JSON.parse(JSON.stringify(l.warp)) } : {}),
      transform: { ...l.transform, x: Math.round((l.transform.x - x0) * 100) / 100, y: Math.round((l.transform.y - y0) * 100) / 100 },
      opacity: l.opacity,
    });
  }
  return { name: name.trim().slice(0, 60) || "내 소스", layers: out, images: pictures };
}