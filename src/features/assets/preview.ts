import { renderProjectRaw } from "@/features/export-image/export-png";
import { layerBox } from "@/features/snap/layer-box";
import { RawImage, createRawImage } from "@/lib/image/raw-image";
import { MeasureFor, estimateMeasure, fitHeight } from "@/lib/image/text-measure";
import { Rasterize, rasterizeVectorLayer, rasterizeVectorLayerAt } from "@/lib/image/vector-raster";
import { BitmapLayer, CURRENT_VERSION, LayerContent, Project } from "@/lib/project/schema";
import { AssetBundle } from "./types";

/* Previews of sources and templates. A preview is the bundle's layers put on a transparent page and drawn by renderProjectRaw, the
 * function the PNG export uses, so it shows what inserting the source gives (no picture files of its own). The checkerboard behind a
 * transparent preview is added by the component; nothing here ever adds it to pixels. */

export type PreviewOptions = {
  /** a whole screen (a template): the frame size and the page colour. Without it the frame is the bundle's own box plus a margin. */
  frame?: { width: number; height: number; background?: [number, number, number] };
  measure?: MeasureFor;
  rasterize?: Rasterize;
  /** margin around the bundle's box, in pixels (not used with `frame`) */
  margin?: number;
  /** draw at this many times the size (> 1), for a sharp large preview: the frame, positions and bitmap sizes are multiplied, and shapes
   *  are drawn by the same drawContent under a scale (`scaledRasterize`). 1 or none: the size the layers have when inserted. */
  scale?: number;
  /** the rasteriser for `scale` > 1 (tests); the default draws on an OffscreenCanvas */
  scaledRasterize?: (k: number) => Rasterize;
};

const MAX_SIDE = 4096;

function toLayers(bundle: AssetBundle, measure: MeasureFor): { layers: BitmapLayer[]; images: Map<string, { raw: RawImage }> } | null {
  const images = new Map<string, { raw: RawImage }>();
  const layers: BitmapLayer[] = [];
  const idOfKey = new Map<string, string>();
  let n = 0;
  for (const a of bundle.layers) {
    let imageId: string | undefined;
    let content: LayerContent | undefined;
    if (a.content) {
      content = { ...a.content };
      if (content.kind === "text") content.height = fitHeight(content, measure);
    } else {
      const raw = a.imageKey ? bundle.images[a.imageKey] : undefined;
      if (!a.imageKey || !raw || raw.width < 1 || raw.height < 1 || raw.data.length !== raw.width * raw.height * 4) return null;
      imageId = idOfKey.get(a.imageKey);
      if (!imageId) {
        imageId = `img-${idOfKey.size}`;
        idOfKey.set(a.imageKey, imageId);
        images.set(imageId, { raw });
      }
    }
    layers.push({
      id: `l${n}`,
      name: a.name,
      crop: { ...a.crop },
      ...(imageId ? { imageId } : {}),
      ...(content ? { content } : {}),
      ...(a.drawn ? { drawn: true } : {}),
      ...(a.warp ? { warp: JSON.parse(JSON.stringify(a.warp)) } : {}),
      transform: { ...a.transform },
      zIndex: ++n,
      opacity: a.opacity,
      visible: true,
      locked: false,
    });
  }
  return layers.length === 0 ? null : { layers, images };
}

/** Where a bundle sits when it is previewed alone: the frame is its box plus a margin, and the layers move by whole pixels (dx, dy). */
export function previewFrame(bundle: AssetBundle, margin = 4, measure: MeasureFor = estimateMeasure): { width: number; height: number; dx: number; dy: number } | null {
  const made = toLayers(bundle, measure);
  if (!made) return null;
  const boxes = made.layers.map((l) => layerBox(l, l.imageId ? made.images.get(l.imageId)?.raw : undefined));
  if (boxes.some((b) => !b)) return null;
  const x0 = Math.min(...boxes.map((b) => b!.x)), y0 = Math.min(...boxes.map((b) => b!.y));
  const x1 = Math.max(...boxes.map((b) => b!.x + b!.width)), y1 = Math.max(...boxes.map((b) => b!.y + b!.height));
  return { width: Math.ceil(x1 - x0) + 2 * margin, height: Math.ceil(y1 - y0) + 2 * margin, dx: Math.round(margin - x0), dy: Math.round(margin - y0) };
}

/** The bundle drawn at its own size. Null when it cannot be drawn (no layers, a bitmap layer without its picture, a bad shape). */
export function renderBundle(bundle: AssetBundle, options: PreviewOptions = {}): RawImage | null {
  const measure = options.measure ?? estimateMeasure;
  const made = toLayers(bundle, measure);
  if (!made) return null;
  const { layers, images } = made;
  let width: number, height: number;
  let background: [number, number, number, number] = [0, 0, 0, 0];
  if (options.frame) {
    ({ width, height } = options.frame);
    if (options.frame.background) background = [...options.frame.background, 255];
  } else {
    const f = previewFrame(bundle, options.margin ?? 4, measure);
    if (!f) return null;
    ({ width, height } = f);
    const { dx, dy } = f;
    for (const l of layers) l.transform = { ...l.transform, x: Math.round((l.transform.x + dx) * 100) / 100, y: Math.round((l.transform.y + dy) * 100) / 100 };
  }
  const k = options.scale && options.scale > 1 ? options.scale : 1;
  if (k > 1) {
    width = Math.ceil(width * k);
    height = Math.ceil(height * k);
    for (const l of layers) {
      const bitmap = !!l.imageId;
      l.transform = { ...l.transform, x: l.transform.x * k, y: l.transform.y * k, ...(bitmap ? { scaleX: l.transform.scaleX * k, scaleY: l.transform.scaleY * k } : {}) };
    }
  }
  if (!(width >= 1 && height >= 1 && width <= MAX_SIDE && height <= MAX_SIDE)) return null;

  const sourceId = "page";
  images.set(sourceId, { raw: createRawImage(width, height, background) });
  const project: Project = {
    id: "preview",
    name: bundle.name,
    version: CURRENT_VERSION,
    canvas: { zoom: 1, panX: 0, panY: 0 },
    screens: [{ id: "s", name: "s", x: 0, y: 0, width, height, source: { imageId: sourceId, fileName: "preview.png" }, backgroundPatches: [], layers }],
  };
  try {
    return renderProjectRaw(project, images, k > 1 ? (options.scaledRasterize ?? rasterizeVectorLayerAt)(k) : (options.rasterize ?? rasterizeVectorLayer));
  } catch {
    return null;
  }
}

/** `raw` shrunk to fit inside maxW × maxH, keeping its proportions (never enlarged). Averages whole source areas with premultiplied
 *  alpha, so a thin line stays visible and transparent edges do not turn dark. */
export function shrinkToFit(raw: RawImage, maxW: number, maxH: number): RawImage {
  const k = Math.min(1, maxW / raw.width, maxH / raw.height);
  if (k >= 1) return raw;
  const w = Math.max(1, Math.round(raw.width * k)), h = Math.max(1, Math.round(raw.height * k));
  const out = createRawImage(w, h);
  for (let y = 0; y < h; y++) {
    const sy0 = (y * raw.height) / h, sy1 = ((y + 1) * raw.height) / h;
    for (let x = 0; x < w; x++) {
      const sx0 = (x * raw.width) / w, sx1 = ((x + 1) * raw.width) / w;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let sy = Math.floor(sy0); sy < Math.min(raw.height, Math.ceil(sy1)); sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        for (let sx = Math.floor(sx0); sx < Math.min(raw.width, Math.ceil(sx1)); sx++) {
          const wt = wy * (Math.min(sx + 1, sx1) - Math.max(sx, sx0));
          const i = (sy * raw.width + sx) * 4;
          const al = raw.data[i + 3] / 255;
          r += raw.data[i] * al * wt; g += raw.data[i + 1] * al * wt; b += raw.data[i + 2] * al * wt; a += al * wt; wsum += wt;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) out.data.set([Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round((a / wsum) * 255)], o);
    }
  }
  return out;
}

/** The ground a preview is shown on (on screen only: it is a CSS colour behind the canvas, never in the picture, the inserted layers or the PNG).
 *  The picture's brightness is the mean Rec. 709 luma of its drawn pixels weighted by alpha; a bright picture (a white line, a light card)
 *  gets a dark grey ground, anything else the light grey, so a thin light mark is never lost on a light ground. */
export const GROUND_LIGHT = "#eceef1";
export const GROUND_DARK = "#59616f";
export const BRIGHT_LUMA = 190;
export function pictureLuma(raw: RawImage): number | null {
  let sum = 0, weight = 0;
  for (let i = 0; i < raw.data.length; i += 4) {
    const a = raw.data[i + 3];
    if (a === 0) continue;
    sum += (0.2126 * raw.data[i] + 0.7152 * raw.data[i + 1] + 0.0722 * raw.data[i + 2]) * a;
    weight += a;
  }
  return weight === 0 ? null : sum / weight;
}
export const groundFor = (raw: RawImage | null): string => {
  const l = raw ? pictureLuma(raw) : null;
  return l !== null && l >= BRIGHT_LUMA ? GROUND_DARK : GROUND_LIGHT;
};

/** Remembers drawn previews by key; a key changes when its item changes, and `drop` forgets items. Holds at most `limit` pictures. */
export class PreviewCache {
  private map = new Map<string, RawImage | null>();
  constructor(private limit = 200) {}
  get(key: string) {
    return this.map.has(key) ? { value: this.map.get(key)! } : undefined;
  }
  set(key: string, value: RawImage | null) {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.limit) this.map.delete(this.map.keys().next().value as string);
  }
  drop(prefix: string) {
    for (const k of [...this.map.keys()]) if (k.startsWith(prefix)) this.map.delete(k);
  }
  get size() {
    return this.map.size;
  }
}
export const previewCache = new PreviewCache();
