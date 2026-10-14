import { hexToRgb } from "./color";
import { RawImage, createRawImage } from "./raw-image";
import { LayerEffects } from "../project/schema";

/* Layer effects: a drop shadow, an outline and a colour overlay, stored as values on the layer and computed from the layer's own pixels.
 * The same function draws them on screen and into the PNG. `applyEffects` takes the layer drawn alone on a transparent tile that already
 * has room around it (`effectMargin`), and gives the tile back with the effects in place, so an effect that reaches beyond the layer is
 * never cut off. Order, back to front: shadow, outside outline, the layer (with its colour overlay), inside outline. */

export const MAX_SHADOW_OFFSET = 500;
export const MAX_SHADOW_BLUR = 100;
export const MAX_OUTLINE = 60;

const on = <T extends { on: boolean }>(e: T | undefined): e is T => !!e && e.on;
/** true when at least one effect is switched on (an effect that is off, or all off, is the same as none) */
export const hasEffects = (e: LayerEffects | undefined): e is LayerEffects => !!e && (on(e.shadow) || (on(e.stroke) && e.stroke.width > 0) || (on(e.overlay) && e.overlay.opacity > 0));

/** how many pixels the effects can reach beyond the layer's own pixels, so the tile can be made big enough */
export function effectMargin(e: LayerEffects | undefined): number {
  if (!hasEffects(e)) return 0;
  let m = 0;
  if (on(e.shadow)) m = Math.max(m, Math.ceil(Math.max(Math.abs(e.shadow.dx), Math.abs(e.shadow.dy)) + e.shadow.blur * 1.5 + 2));
  if (on(e.stroke) && e.stroke.width > 0 && e.stroke.position !== "inside") m = Math.max(m, Math.ceil(e.stroke.position === "center" ? e.stroke.width / 2 : e.stroke.width) + 2);
  return m;
}

/** squared Euclidean distance transform (Felzenszwalb & Huttenlocher): for every pixel the squared distance to the nearest pixel with seed[i] = 1 */
function distanceSquared(seed: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e12;
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = seed[i] ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const pass = (len: number, get: (i: number) => number, set: (i: number, val: number) => void) => {
    for (let i = 0; i < len; i++) f[i] = get(i);
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
    for (let i = 0; i < len; i++) set(i, d[i]);
  };
  for (let x = 0; x < w; x++) pass(h, (y) => out[y * w + x], (y, val) => (out[y * w + x] = val));
  for (let y = 0; y < h; y++) pass(w, (x) => out[y * w + x], (x, val) => (out[y * w + x] = val));
  return out;
}

/** a separable box blur of a float plane, three passes (close to a Gaussian), radius r pixels */
function blurPlane(a: Float32Array, w: number, h: number, r: number): Float32Array {
  const rad = Math.max(0, Math.round(r / 1.7));
  if (rad === 0) return a;
  let src: Float32Array = a;
  let dst: Float32Array = new Float32Array(a.length);
  const boxRow = (inp: Float32Array, out: Float32Array, len: number, stride: number, offset: number) => {
    const size = 2 * rad + 1;
    let sum = 0;
    for (let i = -rad; i <= rad; i++) sum += inp[offset + Math.min(Math.max(i, 0), len - 1) * stride];
    for (let i = 0; i < len; i++) {
      out[offset + i * stride] = sum / size;
      sum += inp[offset + Math.min(i + rad + 1, len - 1) * stride] - inp[offset + Math.max(i - rad, 0) * stride];
    }
  };
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) boxRow(src, dst, w, 1, y * w);
    [src, dst] = [dst, src];
    for (let x = 0; x < w; x++) boxRow(src, dst, h, w, x);
    [src, dst] = [dst, src];
  }
  return src;
}

/** the tile, with its effects. `tile` is not changed. Its size is kept. */
export function applyEffects(tile: RawImage, effects: LayerEffects | undefined): RawImage {
  if (!hasEffects(effects)) return tile;
  const { width: w, height: h } = tile;
  const n = w * h;
  const A = new Float32Array(n);
  for (let i = 0; i < n; i++) A[i] = tile.data[i * 4 + 3] / 255;
  // the working picture: colour (straight) and alpha as floats, composited in layers from the back
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), Al = new Float32Array(n);
  const over = (rgb: [number, number, number], alpha: (i: number) => number) => {
    for (let i = 0; i < n; i++) {
      const sa = alpha(i);
      if (sa <= 0) continue;
      const oa = sa + Al[i] * (1 - sa);
      R[i] = (rgb[0] * sa + R[i] * Al[i] * (1 - sa)) / oa;
      G[i] = (rgb[1] * sa + G[i] * Al[i] * (1 - sa)) / oa;
      B[i] = (rgb[2] * sa + B[i] * Al[i] * (1 - sa)) / oa;
      Al[i] = oa;
    }
  };
  const colour = (hex: string): [number, number, number] => {
    const c = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
    return [c.r, c.g, c.b];
  };

  // 1. the shadow: the layer's alpha moved, blurred, tinted
  if (on(effects.shadow)) {
    const s = effects.shadow;
    const shifted = new Float32Array(n);
    const dx = Math.round(s.dx), dy = Math.round(s.dy);
    for (let y = 0; y < h; y++) {
      const sy = y - dy;
      if (sy < 0 || sy >= h) continue;
      for (let x = 0; x < w; x++) {
        const sx = x - dx;
        if (sx >= 0 && sx < w) shifted[y * w + x] = A[sy * w + sx];
      }
    }
    const blurred = blurPlane(shifted, w, h, s.blur);
    over(colour(s.color), (i) => blurred[i] * s.opacity);
  }

  // distances to the shape (alpha >= 0.5) for the outline
  let inside: Uint8Array | null = null;
  let toShape: Float32Array | null = null, toOutside: Float32Array | null = null;
  const stroke = on(effects.stroke) && effects.stroke.width > 0 ? effects.stroke : null;
  if (stroke) {
    inside = new Uint8Array(n);
    const outside = new Uint8Array(n);
    for (let i = 0; i < n; i++) (A[i] >= 0.5 ? (inside[i] = 1) : (outside[i] = 1));
    if (stroke.position !== "inside") toShape = distanceSquared(inside, w, h);
    if (stroke.position !== "outside") toOutside = distanceSquared(outside, w, h);
  }
  const outerWidth = stroke ? (stroke.position === "outside" ? stroke.width : stroke.position === "center" ? stroke.width / 2 : 0) : 0;
  const innerWidth = stroke ? (stroke.position === "inside" ? stroke.width : stroke.position === "center" ? stroke.width / 2 : 0) : 0;
  // 2. the outline outside the shape (behind the layer)
  if (stroke && toShape && outerWidth > 0) {
    over(colour(stroke.color), (i) => (inside![i] ? 0 : Math.min(Math.max(outerWidth + 1 - Math.sqrt(toShape![i]), 0), 1) * (1 - A[i])));
  }
  // 3. the layer itself, with the colour overlay mixed into its colour (alpha untouched)
  const ov = on(effects.overlay) && effects.overlay.opacity > 0 ? effects.overlay : null;
  const oc = ov ? colour(ov.color) : [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const a = A[i];
    if (a <= 0) continue;
    let r = tile.data[i * 4], g = tile.data[i * 4 + 1], b = tile.data[i * 4 + 2];
    if (ov) {
      r = r * (1 - ov.opacity) + oc[0] * ov.opacity;
      g = g * (1 - ov.opacity) + oc[1] * ov.opacity;
      b = b * (1 - ov.opacity) + oc[2] * ov.opacity;
    }
    const oa = a + Al[i] * (1 - a);
    R[i] = (r * a + R[i] * Al[i] * (1 - a)) / oa;
    G[i] = (g * a + G[i] * Al[i] * (1 - a)) / oa;
    B[i] = (b * a + B[i] * Al[i] * (1 - a)) / oa;
    Al[i] = oa;
  }
  // 4. the outline inside the shape (over the layer, only where the layer is)
  if (stroke && toOutside && innerWidth > 0) {
    over(colour(stroke.color), (i) => (inside![i] ? Math.min(Math.max(innerWidth + 1 - Math.sqrt(toOutside![i]), 0), 1) * A[i] : 0));
  }

  const out = createRawImage(w, h);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (Al[i] <= 0) continue;
    out.data[o] = R[i];
    out.data[o + 1] = G[i];
    out.data[o + 2] = B[i];
    out.data[o + 3] = Al[i] * 255;
  }
  return out;
}
