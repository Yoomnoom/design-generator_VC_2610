import { LayerTransform, cosSin, isOnlyMoved, layerBounds } from "../geometry/layer-transform";
import { BackgroundPatch, BlendMode, LayerWarp } from "../project/schema";
import { hexToRgb } from "./color";
import { RawImage, createRawImage } from "./raw-image";
import { isIdentityWarp } from "./warp";
import { rasterizeWarped } from "./warp-raster";

export type RenderLayer = {
  image: RawImage;
  x: number;
  y: number;
  /** scale and rotation as in BitmapLayer.transform; a layer that is only moved leaves them out */
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  /** the layer's warp (skew, perspective, distortion, mesh): applied before scale and rotation. A warp that changes nothing is the same as none. */
  warp?: LayerWarp;
  zIndex: number;
  opacity: number;
  /** how it mixes with what is below; absent = normal */
  blend?: BlendMode;
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
    if (layer.warp && !isIdentityWarp(layer.warp, layer.image.width, layer.image.height)) drawWarped(out, layer, t, layer.warp);
    else if (isOnlyMoved(t)) drawMoved(out, layer);
    else drawTransformed(out, layer, t);
  }
  return out;
}

/** A warped layer: its pixels come from rasterizeWarped (the same function the screen uses), laid on whole pixels like a moved layer.
 *  Warp, then scale, then rotation, then position: the position is rounded to a whole pixel, as for a layer that is only moved. */
function drawWarped(out: RawImage, layer: RenderLayer, t: LayerTransform, warp: LayerWarp) {
  const ox = Math.round(layer.x), oy = Math.round(layer.y);
  const r = rasterizeWarped(layer.image, t, warp, { clip: { x: -ox, y: -oy, width: out.width, height: out.height } }); // only what shows in the frame
  if (r) drawMoved(out, { ...layer, image: r.image, x: ox + r.x, y: oy + r.y });
}

/** A layer that is only moved: each of its pixels is copied to one pixel, so nothing is blurred. */
function drawMoved(out: RawImage, layer: RenderLayer) {
  const ox = Math.round(layer.x), oy = Math.round(layer.y);
  const { image, opacity, blend: mode } = layer;
  for (let ly = 0; ly < image.height; ly++) {
    const y = oy + ly;
    if (y < 0 || y >= out.height) continue;
    for (let lx = 0; lx < image.width; lx++) {
      const x = ox + lx;
      if (x < 0 || x >= out.width) continue;
      blend(out.data, (y * out.width + x) * 4, image.data, (ly * image.width + lx) * 4, opacity, mode);
    }
  }
}

/** Samples per side for the coverage of an edge pixel (4 × 4 = 16 samples, 17 distinct coverages). */
const EDGE_SAMPLES = 4;

/** A scaled and/or rotated layer, with anti-aliased edges.
 *  Each output pixel is traced back into the bitmap (inverse of T · R · S). Its colour is a bilinear sample (premultiplied, so a
 *  transparent edge does not bleed colour into its neighbours) at the pixel's centre, held inside the bitmap. Its alpha is
 *  multiplied by the share of the pixel the layer covers, so an edge that cuts through a pixel gives a partly transparent pixel
 *  of the layer's own colour instead of a stair step.
 *  A pixel the layer covers completely, or not at all, is decided from its four corners with no sampling; an edge that falls
 *  exactly on the pixel grid (quarter turns, whole-number scales, whole-number positions) has no pixel in between, so such a
 *  layer comes out exactly as a hard-edged copy would. */
function drawTransformed(out: RawImage, layer: RenderLayer, t: LayerTransform) {
  const { image, opacity, blend: mode } = layer;
  const b = layerBounds(t, image.width, image.height);
  const x0 = Math.max(Math.floor(b.x), 0), x1 = Math.min(Math.ceil(b.x + b.width), out.width);
  const y0 = Math.max(Math.floor(b.y), 0), y1 = Math.min(Math.ceil(b.y + b.height), out.height);
  const { cos, sin } = cosSin(t.rotation);
  const px = new Uint8ClampedArray(4);
  const { data, width: iw, height: ih } = image;

  // a point of the output, in the bitmap's own pixels
  const lx = (u: number, v: number) => (cos * (u - t.x) + sin * (v - t.y)) / t.scaleX;
  const ly = (u: number, v: number) => (-sin * (u - t.x) + cos * (v - t.y)) / t.scaleY;
  const step = 1 / EDGE_SAMPLES;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const a0 = lx(x, y), a1 = lx(x + 1, y), a2 = lx(x, y + 1), a3 = lx(x + 1, y + 1);
      const b0 = ly(x, y), b1 = ly(x + 1, y), b2 = ly(x, y + 1), b3 = ly(x + 1, y + 1);
      // all four corners beyond the same side of the bitmap: the pixel is outside it
      if ((a0 <= 0 && a1 <= 0 && a2 <= 0 && a3 <= 0) || (a0 >= iw && a1 >= iw && a2 >= iw && a3 >= iw)) continue;
      if ((b0 <= 0 && b1 <= 0 && b2 <= 0 && b3 <= 0) || (b0 >= ih && b1 >= ih && b2 >= ih && b3 >= ih)) continue;

      let coverage = 1;
      const wholly = a0 >= 0 && a1 >= 0 && a2 >= 0 && a3 >= 0 && a0 <= iw && a1 <= iw && a2 <= iw && a3 <= iw && b0 >= 0 && b1 >= 0 && b2 >= 0 && b3 >= 0 && b0 <= ih && b1 <= ih && b2 <= ih && b3 <= ih;
      if (!wholly) {
        // an edge cuts through this pixel: count how many of its sample points fall inside the bitmap
        let inside = 0;
        for (let j = 0; j < EDGE_SAMPLES; j++) {
          for (let i = 0; i < EDGE_SAMPLES; i++) {
            const u = x + (i + 0.5) * step, v = y + (j + 0.5) * step;
            const sx = lx(u, v), sy = ly(u, v);
            if (sx >= 0 && sx < iw && sy >= 0 && sy < ih) inside++;
          }
        }
        if (inside === 0) continue;
        coverage = inside / (EDGE_SAMPLES * EDGE_SAMPLES);
      }

      // colour at the pixel's centre, held inside the bitmap so a pixel that only touches the edge takes the edge's colour
      const cx = Math.min(Math.max(lx(x + 0.5, y + 0.5), 0), iw);
      const cy = Math.min(Math.max(ly(x + 0.5, y + 0.5), 0), ih);
      // bilinear between the four nearest pixel centres; at the edge the nearest edge pixel is used
      const fx = cx - 0.5, fy = cy - 0.5;
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
      px[3] = a * 255 * coverage;
      blend(out.data, (y * out.width + x) * 4, px, 0, opacity, mode);
    }
  }
}

/** the separable blend functions of the canvas specification, on 0..1 channels (cb = what is below, cs = the layer) */
const BLEND_FN: Record<BlendMode, (cb: number, cs: number) => number> = {
  multiply: (cb, cs) => cb * cs,
  screen: (cb, cs) => cb + cs - cb * cs,
  overlay: (cb, cs) => (cb <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs)), // hard light with the layers swapped
  darken: (cb, cs) => Math.min(cb, cs),
  lighten: (cb, cs) => Math.max(cb, cs),
};

/** source-over on non-premultiplied RGBA, or a blend mode on top of it (W3C compositing: the part of the layer over opaque backdrop is
 *  mixed by the blend function, the part over transparent backdrop is the layer's own colour) */
function blend(dst: Uint8ClampedArray, d: number, src: Uint8ClampedArray, s: number, opacity: number, mode?: BlendMode) {
  const sa = (src[s + 3] / 255) * opacity;
  if (sa === 0) return;
  if (mode) {
    const ab = dst[d + 3] / 255;
    const ao = sa + ab * (1 - sa);
    const f = BLEND_FN[mode];
    for (let k = 0; k < 3; k++) {
      const cs = src[s + k] / 255, cb = dst[d + k] / 255;
      const co = (sa * (1 - ab) * cs + sa * ab * f(cb, cs) + (1 - sa) * ab * cb) / ao;
      dst[d + k] = co * 255;
    }
    dst[d + 3] = ao * 255;
    return;
  }
  if (sa >= 1) {
    dst.set(src.subarray(s, s + 4), d);
    return;
  }
  const da = dst[d + 3] / 255;
  const oa = sa + da * (1 - sa);
  for (let k = 0; k < 3; k++) dst[d + k] = (src[s + k] * sa + dst[d + k] * da * (1 - sa)) / oa;
  dst[d + 3] = oa * 255;
}
