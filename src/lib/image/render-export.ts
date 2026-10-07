import { LayerTransform, cosSin, isOnlyMoved, layerBounds } from "../geometry/layer-transform";
import { BackgroundPatch } from "../project/schema";
import { hexToRgb } from "./color";
import { RawImage, createRawImage } from "./raw-image";

export type RenderLayer = {
  image: RawImage;
  x: number;
  y: number;
  /** scale and rotation as in BitmapLayer.transform; a layer that is only moved leaves them out */
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  zIndex: number;
  opacity: number;
  visible: boolean;
};

export type RenderInput = {
  width: number; // frame size = original image size; the output is exactly this
  height: number;
  source: RawImage;
  patches: BackgroundPatch[];
  layers: RenderLayer[];
};

/** Composites source → patches → layers (by zIndex) into a width × height buffer, at the original pixel size.
 *  Pure pixel math: no zoom, no devicePixelRatio, and no editor checkerboard. Transparent stays alpha 0.
 *  Hidden layers are skipped. */
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
    const t: LayerTransform = { x: layer.x, y: layer.y, scaleX: layer.scaleX ?? 1, scaleY: layer.scaleY ?? 1, rotation: layer.rotation ?? 0 };
    if (isOnlyMoved(t)) drawMoved(out, layer);
    else drawTransformed(out, layer, t);
  }
  return out;
}

/** A layer that is only moved: each of its pixels is copied to one pixel, so nothing is blurred. */
function drawMoved(out: RawImage, layer: RenderLayer) {
  const ox = Math.round(layer.x), oy = Math.round(layer.y);
  const { image, opacity } = layer;
  for (let ly = 0; ly < image.height; ly++) {
    const y = oy + ly;
    if (y < 0 || y >= out.height) continue;
    for (let lx = 0; lx < image.width; lx++) {
      const x = ox + lx;
      if (x < 0 || x >= out.width) continue;
      blend(out.data, (y * out.width + x) * 4, image.data, (ly * image.width + lx) * 4, opacity);
    }
  }
}

/** A scaled and/or rotated layer. Every output pixel whose centre lies inside the placed layer is traced back to the
 *  bitmap and filled by bilinear sampling (premultiplied, so a transparent edge does not bleed colour into its neighbours).
 *  A quarter turn or a whole-number scale-down of an exact grid lands on pixel centres, so it stays sharp. */
function drawTransformed(out: RawImage, layer: RenderLayer, t: LayerTransform) {
  const { image, opacity } = layer;
  const b = layerBounds(t, image.width, image.height);
  const x0 = Math.max(Math.floor(b.x), 0), x1 = Math.min(Math.ceil(b.x + b.width), out.width);
  const y0 = Math.max(Math.floor(b.y), 0), y1 = Math.min(Math.ceil(b.y + b.height), out.height);
  const { cos, sin } = cosSin(t.rotation);
  const px = new Uint8ClampedArray(4);
  const { data, width: iw, height: ih } = image;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      // the output pixel's centre, traced back into the bitmap's own pixels (inverse of T · R · S)
      const dx = x + 0.5 - t.x;
      const dy = y + 0.5 - t.y;
      const lx = (cos * dx + sin * dy) / t.scaleX;
      const ly = (-sin * dx + cos * dy) / t.scaleY;
      if (lx < 0 || ly < 0 || lx >= iw || ly >= ih) continue; // centre outside the layer: not part of it

      // bilinear between the four nearest pixel centres; at the edge the nearest edge pixel is used
      const fx = lx - 0.5, fy = ly - 0.5;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const wx = fx - ix, wy = fy - iy;
      const xa = Math.min(Math.max(ix, 0), iw - 1), xb = Math.min(Math.max(ix + 1, 0), iw - 1);
      const ya = Math.min(Math.max(iy, 0), ih - 1), yb = Math.min(Math.max(iy + 1, 0), ih - 1);
      const taps = [
        [(ya * iw + xa) * 4, (1 - wx) * (1 - wy)],
        [(ya * iw + xb) * 4, wx * (1 - wy)],
        [(yb * iw + xa) * 4, (1 - wx) * wy],
        [(yb * iw + xb) * 4, wx * wy],
      ];
      let a = 0, r = 0, g = 0, bl = 0;
      for (const [i, w] of taps) {
        const wa = (data[i + 3] / 255) * w;
        a += wa;
        r += data[i] * wa;
        g += data[i + 1] * wa;
        bl += data[i + 2] * wa;
      }
      if (a <= 0) continue;
      px[0] = r / a;
      px[1] = g / a;
      px[2] = bl / a;
      px[3] = a * 255;
      blend(out.data, (y * out.width + x) * 4, px, 0, opacity);
    }
  }
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
