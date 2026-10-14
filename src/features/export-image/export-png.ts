import { ImageCodec } from "@/lib/image/codec";
import { RawImage } from "@/lib/image/raw-image";
import { adjustedPicture } from "@/lib/image/adjust";
import { RenderLayer, renderComposite } from "@/lib/image/render-export";
import { MemoOverlay, overlayMemos } from "@/lib/image/memo-raster";
import { Rasterize, rasterizeVectorLayer } from "@/lib/image/vector-raster";
import { Project } from "@/lib/project/schema";
import { ImageCache } from "@/store/images";

/** One layer as the renderer takes it: a vector layer drawn to a picture (hidden: null), a bitmap with its transform and warp. The PNG export and
 *  the on-screen effect picture both start from this, so they cannot differ. */
export function renderLayerOf(layer: Project["screens"][number]["layers"][number], images: ImageCache, frame: { width: number; height: number }, rasterize: Rasterize = rasterizeVectorLayer): RenderLayer | null {
  if (layer.content) {
    if (!layer.visible) return null;
    const r = rasterize(layer.content, layer.transform, frame);
    return r ? { image: r.image, x: r.x, y: r.y, zIndex: layer.zIndex, opacity: layer.opacity, blend: layer.blend, effects: layer.effects, visible: true } : null;
  }
  const original = layer.imageId ? images.get(layer.imageId)?.raw : undefined;
  if (!original) throw new Error(`레이어 "${layer.name}"의 이미지가 로드되어 있지 않습니다`);
  const image = adjustedPicture(original, layer.adjust); // the layer's adjustments are applied to its pixels here, the same way on screen
  const { x, y, scaleX, scaleY, rotation } = layer.transform;
  return { image, x, y, scaleX, scaleY, rotation, warp: layer.warp, zIndex: layer.zIndex, opacity: layer.opacity, blend: layer.blend, effects: layer.effects, visible: layer.visible };
}

/** The finished screen as pixels: source, patches, then every visible layer. The size is the screen's, nothing else. Vector layers
 *  are rasterised here and only here, so a project never stores their pixels. Used by the PNG export and by the colour picker. */
export function renderProjectRaw(project: Project, images: ImageCache, rasterize: Rasterize = rasterizeVectorLayer): RawImage {
  const screen = project.screens[0];
  const source = images.get(screen.source.imageId)?.raw;
  if (!source) throw new Error("원본 이미지가 로드되어 있지 않습니다");

  const layers = screen.layers.flatMap((layer) => {
    const r = renderLayerOf(layer, images, { width: screen.width, height: screen.height }, rasterize);
    return r ? [r] : [];
  });

  return renderComposite({ width: screen.width, height: screen.height, source, patches: screen.backgroundPatches, layers });
}

/** Renders the screen at its original pixel size and encodes it as PNG. Independent of zoom, pan and devicePixelRatio:
 *  it composites the source image, patches and layers directly, never the on-screen canvas. */
export type ExportOptions = {
  /** also draw the memos (numbered pins and balloons) onto the picture; off by default, since memos are notes to the editor */
  memos?: boolean;
  overlayMemos?: MemoOverlay;
};

export async function renderProjectPng(project: Project, images: ImageCache, codec: ImageCodec, rasterize?: Rasterize, options: ExportOptions = {}): Promise<{ blob: Blob; width: number; height: number }> {
  const raw = renderProjectRaw(project, images, rasterize);
  const memos = options.memos ? project.screens[0].memos ?? [] : [];
  const out = memos.length ? (options.overlayMemos ?? overlayMemos)(raw, memos) : raw;
  return { blob: await codec.encode(out), width: out.width, height: out.height };
}

/** width × height from a PNG's IHDR chunk, or null when the bytes are not a PNG. Lets the export check its own output. */
export async function readPngSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  const b = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (b.length < 24 || signature.some((v, i) => b[i] !== v)) return null;
  const view = new DataView(b.buffer);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
