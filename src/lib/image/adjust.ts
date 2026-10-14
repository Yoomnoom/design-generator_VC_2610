import { RawImage, createRawImage } from "./raw-image";
import { LayerAdjust } from "../project/schema";

/* Image adjustments of a bitmap layer, as values: brightness, contrast, saturation, hue, blur and sharpen. The layer's bitmap is never
 * changed; the picture that is drawn (on screen and into the PNG) is this function's result for the layer's own pixels, so both come from
 * the same code. Colour is adjusted per pixel in the order brightness, contrast, saturation, hue; then blur; then sharpen (an unsharp
 * mask on the blurred copy). Alpha is kept (except where blur softens an edge), and blur works on premultiplied colour so a transparent
 * edge does not turn dark. */

export const ADJUST_LIMITS = { brightness: [-100, 100], contrast: [-100, 100], saturation: [-100, 100], hue: [-180, 180], blur: [0, 50], sharpen: [0, 100] } as const;
export const NO_ADJUST: LayerAdjust = { brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0, sharpen: 0 };

export const hasAdjust = (a: LayerAdjust | undefined): a is LayerAdjust => !!a && (a.brightness !== 0 || a.contrast !== 0 || a.saturation !== 0 || a.hue !== 0 || a.blur > 0 || a.sharpen > 0);

function blurPlanes(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  // four interleaved planes (premultiplied r, g, b and alpha), a separable box blur applied three times (close to a Gaussian)
  const rad = Math.max(1, Math.round(radius / 1.7));
  let a: Float32Array = new Float32Array(src); // a copy: the two buffers are reused as scratch, src must stay as it is
  let b: Float32Array = new Float32Array(src.length);
  const pass = (inp: Float32Array, out: Float32Array, len: number, stride: number, start: number, k: number) => {
    const size = 2 * rad + 1;
    let sum = 0;
    for (let i = -rad; i <= rad; i++) sum += inp[start + Math.min(Math.max(i, 0), len - 1) * stride + k];
    for (let i = 0; i < len; i++) {
      out[start + i * stride + k] = sum / size;
      sum += inp[start + Math.min(i + rad + 1, len - 1) * stride + k] - inp[start + Math.max(i - rad, 0) * stride + k];
    }
  };
  for (let n = 0; n < 3; n++) {
    for (let k = 0; k < 4; k++) for (let y = 0; y < h; y++) pass(a, b, w, 4, y * w * 4, k);
    [a, b] = [b, a];
    for (let k = 0; k < 4; k++) for (let x = 0; x < w; x++) pass(a, b, h, w * 4, x * 4, k);
    [a, b] = [b, a];
  }
  return a;
}

/** the adjusted picture (a new image; `raw` is not changed). With nothing to do the same object comes back. */
export function applyAdjustments(raw: RawImage, adj: LayerAdjust | undefined): RawImage {
  if (!hasAdjust(adj)) return raw;
  const { width: w, height: h } = raw;
  const out = createRawImage(w, h);
  const bright = adj.brightness * 2.55; // -255..255 added to each channel
  const cf = (259 * (adj.contrast * 2.55 + 255)) / (255 * (259 - adj.contrast * 2.55)); // the usual contrast factor
  const sat = 1 + adj.saturation / 100;
  const hueRad = (adj.hue * Math.PI) / 180;
  const cosH = Math.cos(hueRad), sinH = Math.sin(hueRad);
  // the hue turn as a matrix on RGB (rotation about the grey axis)
  const m = [
    0.213 + cosH * 0.787 - sinH * 0.213, 0.715 - cosH * 0.715 - sinH * 0.715, 0.072 - cosH * 0.072 + sinH * 0.928,
    0.213 - cosH * 0.213 + sinH * 0.143, 0.715 + cosH * 0.285 + sinH * 0.14, 0.072 - cosH * 0.072 - sinH * 0.283,
    0.213 - cosH * 0.213 - sinH * 0.787, 0.715 - cosH * 0.715 + sinH * 0.715, 0.072 + cosH * 0.928 + sinH * 0.072,
  ];
  const colour = adj.brightness !== 0 || adj.contrast !== 0 || adj.saturation !== 0 || adj.hue !== 0;
  const d = raw.data, o = out.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    if (colour) {
      r += bright; g += bright; b += bright;
      if (adj.contrast !== 0) { r = cf * (r - 128) + 128; g = cf * (g - 128) + 128; b = cf * (b - 128) + 128; }
      if (adj.saturation !== 0) {
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
      }
      if (adj.hue !== 0) {
        const nr = m[0] * r + m[1] * g + m[2] * b, ng = m[3] * r + m[4] * g + m[5] * b, nb = m[6] * r + m[7] * g + m[8] * b;
        r = nr; g = ng; b = nb;
      }
    }
    o[i] = r; o[i + 1] = g; o[i + 2] = b; o[i + 3] = d[i + 3];
  }
  if (adj.blur <= 0 && adj.sharpen <= 0) return out;
  // premultiplied planes for blur and sharpen
  const pm = new Float32Array(w * h * 4);
  for (let i = 0; i < o.length; i += 4) {
    const a = o[i + 3] / 255;
    pm[i] = Math.min(Math.max(o[i], 0), 255) * a; pm[i + 1] = Math.min(Math.max(o[i + 1], 0), 255) * a; pm[i + 2] = Math.min(Math.max(o[i + 2], 0), 255) * a; pm[i + 3] = a;
  }
  let result: Float32Array = pm;
  if (adj.blur > 0) result = blurPlanes(pm, w, h, adj.blur);
  if (adj.sharpen > 0) {
    const soft = blurPlanes(result, w, h, 1.7);
    const amount = adj.sharpen / 50; // 0..2
    const sh = new Float32Array(result.length);
    for (let i = 0; i < sh.length; i += 4) {
      for (let k = 0; k < 3; k++) sh[i + k] = result[i + k] + amount * (result[i + k] - soft[i + k]);
      sh[i + 3] = result[i + 3]; // edges are sharpened in colour, the shape (alpha) stays
    }
    result = sh;
  }
  for (let i = 0; i < result.length; i += 4) {
    const a = Math.min(Math.max(result[i + 3], 0), 1);
    if (a <= 0) { o[i] = o[i + 1] = o[i + 2] = o[i + 3] = 0; continue; }
    o[i] = result[i] / a; o[i + 1] = result[i + 1] / a; o[i + 2] = result[i + 2] / a; o[i + 3] = a * 255;
  }
  return out;
}

/** the adjusted picture, remembered per bitmap and per set of values (the screen draws it every frame; it is made once) */
const memo = new WeakMap<RawImage, Map<string, RawImage>>();
export function adjustedPicture(raw: RawImage, adj: LayerAdjust | undefined): RawImage {
  if (!hasAdjust(adj)) return raw;
  let per = memo.get(raw);
  if (!per) memo.set(raw, (per = new Map()));
  const key = JSON.stringify(adj);
  let hit = per.get(key);
  if (!hit) {
    hit = applyAdjustments(raw, adj);
    if (per.size >= 3) per.delete(per.keys().next().value as string); // a few sets per bitmap: a big bitmap's results are large
    per.set(key, hit);
  }
  return hit;
}