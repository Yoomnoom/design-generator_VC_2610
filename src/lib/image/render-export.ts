import { BackgroundPatch } from "../project/schema";
import { hexToRgb } from "./color";
import { RawImage, createRawImage } from "./raw-image";

export type RenderLayer = { image: RawImage; x: number; y: number; zIndex: number; opacity: number; visible: boolean };

export type RenderInput = {
  width: number; // frame size = original image size; the output is exactly this
  height: number;
  source: RawImage;
  patches: BackgroundPatch[];
  layers: RenderLayer[];
};

/** Composites source → patches → layers (by zIndex) at 1:1 into a width × height buffer.
 *  Pure pixel math: no zoom, no devicePixelRatio, and no editor checkerboard. Transparent stays alpha 0. */
export function renderComposite({ width, height, source, patches, layers }: RenderInput): RawImage {
  const out = createRawImage(width, height);
  const cw = Math.min(width, source.width), ch = Math.min(height, source.height);
  for (let y = 0; y < ch; y++) out.data.set(source.data.subarray(y * source.width * 4, (y * source.width + cw) * 4), y * width * 4);

  for (const patch of patches) {
    const c = hexToRgb(patch.fill);
    if (!c) continue;
    const x0 = Math.max(patch.rect.x, 0), x1 = Math.min(patch.rect.x + patch.rect.width, width);
    const y0 = Math.max(patch.rect.y, 0), y1 = Math.min(patch.rect.y + patch.rect.height, height);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.data.set([c.r, c.g, c.b, 255], (y * width + x) * 4);
  }

  // stable sort: layers sharing a zIndex keep their array order
  const ordered = layers
    .map((layer, i) => ({ layer, i }))
    .filter(({ layer }) => layer.visible)
    .sort((a, b) => a.layer.zIndex - b.layer.zIndex || a.i - b.i);
  for (const { layer } of ordered) {
    const ox = Math.round(layer.x), oy = Math.round(layer.y);
    const { image, opacity } = layer;
    for (let ly = 0; ly < image.height; ly++) {
      const y = oy + ly;
      if (y < 0 || y >= height) continue;
      for (let lx = 0; lx < image.width; lx++) {
        const x = ox + lx;
        if (x < 0 || x >= width) continue;
        blend(out.data, (y * width + x) * 4, image.data, (ly * image.width + lx) * 4, opacity);
      }
    }
  }
  return out;
}

/** source-over on non-premultiplied RGBA */
function blend(dst: Uint8ClampedArray, d: number, src: Uint8ClampedArray, s: number, opacity: number) {
  const sa = (src[s + 3] / 255) * opacity;
  if (sa === 0) return;
  if (sa >= 1) {
    dst.set(src.subarray(s, s + 4), d);
    return;
  }
  const da = dst[d + 3] / 255;
  const oa = sa + da * (1 - sa);
  for (let k = 0; k < 3; k++) dst[d + k] = (src[s + k] * sa + dst[d + k] * da * (1 - sa)) / oa;
  dst[d + 3] = oa * 255;
}
