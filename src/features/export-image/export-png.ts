import { ImageCodec } from "@/lib/image/codec";
import { RawImage } from "@/lib/image/raw-image";
import { renderComposite } from "@/lib/image/render-export";
import { Rasterize, rasterizeVectorLayer } from "@/lib/image/vector-raster";
import { Project } from "@/lib/project/schema";
import { ImageCache } from "@/store/images";

/** The finished screen as pixels: source, patches, then every visible layer. The size is the screen's, nothing else. Vector layers
 *  are rasterised here and only here, so a project never stores their pixels. Used by the PNG export and by the colour picker. */
export function renderProjectRaw(project: Project, images: ImageCache, rasterize: Rasterize = rasterizeVectorLayer): RawImage {
  const screen = project.screens[0];
  const source = images.get(screen.source.imageId)?.raw;
  if (!source) throw new Error("원본 이미지가 로드되어 있지 않습니다");

  const layers = screen.layers.flatMap((layer) => {
    if (layer.content) {
      if (!layer.visible) return [];
      const r = rasterize(layer.content, layer.transform, { width: screen.width, height: screen.height });
      return r ? [{ image: r.image, x: r.x, y: r.y, zIndex: layer.zIndex, opacity: layer.opacity, visible: true }] : [];
    }
    const image = layer.imageId ? images.get(layer.imageId)?.raw : undefined;
    if (!image) throw new Error(`레이어 "${layer.name}"의 이미지가 로드되어 있지 않습니다`);
    const { x, y, scaleX, scaleY, rotation } = layer.transform;
    return [{ image, x, y, scaleX, scaleY, rotation, zIndex: layer.zIndex, opacity: layer.opacity, visible: layer.visible }];
  });

  return renderComposite({ width: screen.width, height: screen.height, source, patches: screen.backgroundPatches, layers });
}

/** Renders the screen at its original pixel size and encodes it as PNG. Independent of zoom, pan and devicePixelRatio:
 *  it composites the source image, patches and layers directly, never the on-screen canvas. */
export async function renderProjectPng(project: Project, images: ImageCache, codec: ImageCodec, rasterize?: Rasterize): Promise<{ blob: Blob; width: number; height: number }> {
  const out = renderProjectRaw(project, images, rasterize);
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
