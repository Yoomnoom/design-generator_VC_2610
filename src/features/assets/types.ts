import { RawImage } from "@/lib/image/raw-image";
import { BitmapLayer, LayerContent, LayerWarp, Rect } from "@/lib/project/schema";

/** One layer of a source (asset). Positions are in the bundle's own space: for a source taken from layers the top-left of the whole
 *  group is (0, 0), for a template they are frame pixels. The layer's picture, if it is a bitmap, is named by `imageKey`. */
export type AssetLayer = {
  name: string;
  crop: Rect;
  content?: LayerContent;
  imageKey?: string;
  drawn?: boolean;
  warp?: LayerWarp;
  transform: BitmapLayer["transform"];
  opacity: number;
};

/** A group of layers that goes into a screen together, as one undo step. */
export type AssetBundle = { name: string; layers: AssetLayer[]; images: Record<string, RawImage> };