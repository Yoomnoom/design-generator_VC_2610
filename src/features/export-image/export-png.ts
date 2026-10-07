import { ImageCodec } from "@/lib/image/codec";
import { renderComposite } from "@/lib/image/render-export";
import { Project } from "@/lib/project/schema";
import { ImageCache } from "@/store/images";

/** Renders the screen at its original pixel size and encodes it as PNG. Independent of zoom, pan and devicePixelRatio:
 *  it composites the source image, patches and layers directly, never the on-screen canvas. */
export async function renderProjectPng(project: Project, images: ImageCache, codec: ImageCodec): Promise<{ blob: Blob; width: number; height: number }> {
  const screen = project.screens[0];
  const source = images.get(screen.source.imageId)?.raw;
  if (!source) throw new Error("원본 이미지가 로드되어 있지 않습니다");

  const layers = screen.layers.map((layer) => {
    const image = layer.imageId ? images.get(layer.imageId)?.raw : undefined;
    if (!image) throw new Error(`레이어 "${layer.name}"의 이미지가 로드되어 있지 않습니다`);
    const { x, y, scaleX, scaleY, rotation } = layer.transform;
    return { image, x, y, scaleX, scaleY, rotation, zIndex: layer.zIndex, opacity: layer.opacity, visible: layer.visible };
  });

  const out = renderComposite({ width: screen.width, height: screen.height, source, patches: screen.backgroundPatches, layers });
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
