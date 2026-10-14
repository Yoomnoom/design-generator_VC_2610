import { IRect, Pt } from "./brush-raster";
import { RawImage } from "./raw-image";
import { falloff } from "./smudge";

/* Liquify: pushing, bloating and puckering the shape of a bitmap, and restoring it.
 *
 * The result is never painted over itself. A displacement field D (one vector per pixel, "where does this output pixel take its colour
 * from, relative to itself") is accumulated over the stroke, and every output pixel is a premultiplied bilinear sample of the picture as it
 * was at the start of the stroke, at p + D(p). Each dab adds a small backward step δ to the field and carries the old field along
 * (D'(p) = δ(p) + D(p + δ(p))), so many small dabs compose exactly like one smooth warp and the picture is resampled once from the
 * original, not smeared by repeated resampling. Colour is premultiplied while it is mixed, so an opaque edge pushed into transparency
 * leaves no dark fringe. Pixels pulled from beyond the bitmap take the nearest edge pixel; what is pushed past the edge is dropped.
 * A pixel whose displacement is zero keeps its bytes exactly (nothing at all changes when nothing moved).
 *
 * Restore is a different kind of stroke: it blends the picture back toward a reference picture (the layer as it was when the tool began)
 * under the brush, without a field. */

export type LiquifyMode = "push" | "bloat" | "pucker" | "restore";
export const LIQUIFY_MODES: LiquifyMode[] = ["push", "bloat", "pucker", "restore"];

export type LiquifyOptions = {
  mode: LiquifyMode;
  /** brush diameter in bitmap pixels */
  size: number;
  /** 0..1 */
  strength: number;
  /** 0..1: 1 = a hard disc, 0 = the effect fades out smoothly from the centre */
  hardness: number;
};
export const MIN_LIQUIFY_SIZE = 4;
export const MAX_LIQUIFY_SIZE = 600;

/** how much of the pointer's travel the picture follows at full strength (1 = it sticks to the pointer) */
const PUSH_GAIN = 1;
/** share of the distance to the brush centre that one dab at full strength moves a pixel, for bloat and pucker */
const SWELL_GAIN = 0.22;

export type Liquify = {
  /** the stroke moves on to this point (bitmap pixels): the dabs between the last point and this one are applied.
   *  The box of pixels these dabs changed (null: none), so a preview can repaint just that. */
  add(p: Pt): IRect | null;
  dirty(): IRect | null;
};

/** `raw` is changed in place (the caller's working copy). `source` is the picture as it is now (a copy that is never written), `reference`
 *  is what restore blends toward. */
export function createLiquify(raw: RawImage, source: RawImage, reference: RawImage | null, opts: LiquifyOptions): Liquify {
  const size = Math.min(Math.max(opts.size, MIN_LIQUIFY_SIZE), MAX_LIQUIFY_SIZE);
  const strength = Math.min(Math.max(opts.strength, 0), 1);
  const hardness = Math.min(Math.max(opts.hardness, 0), 0.999);
  const R = size / 2;
  const spacing = Math.max(1, size * 0.06);
  const { width: W, height: H } = raw;
  const side = Math.ceil(size) + 4;
  const scratch = { next: new Float32Array(side * side * 2), used: new Uint8Array(side * side) };
  let field: Float32Array | null = null; // 2 floats per pixel, allocated at the first dab that needs it
  let last: Pt | null = null;
  let carry = 0;
  let box: IRect | null = null;
  let step: IRect | null = null;
  const grow = (b: IRect | null, x: number, y: number): IRect => (b ? { x: Math.min(b.x, x), y: Math.min(b.y, y), width: Math.max(b.x + b.width, x + 1) - Math.min(b.x, x), height: Math.max(b.y + b.height, y + 1) - Math.min(b.y, y) } : { x, y, width: 1, height: 1 });

  const src = source.data;
  /** premultiplied bilinear sample of `source` at a point (pixel centres at +0.5), edge pixels repeated; writes into out[0..3] (r,g,b premultiplied, a) */
  const sample = (x: number, y: number, out: Float32Array) => {
    const fx = x - 0.5, fy = y - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const wx = fx - ix, wy = fy - iy;
    const xa = Math.min(Math.max(ix, 0), W - 1), xb = Math.min(Math.max(ix + 1, 0), W - 1);
    const ya = Math.min(Math.max(iy, 0), H - 1), yb = Math.min(Math.max(iy + 1, 0), H - 1);
    let r = 0, g = 0, b = 0, a = 0;
    const tap = (xx: number, yy: number, w: number) => {
      if (w === 0) return;
      const i = (yy * W + xx) * 4;
      const al = src[i + 3] / 255;
      r += src[i] * al * w;
      g += src[i + 1] * al * w;
      b += src[i + 2] * al * w;
      a += al * w;
    };
    tap(xa, ya, (1 - wx) * (1 - wy));
    tap(xb, ya, wx * (1 - wy));
    tap(xa, yb, (1 - wx) * wy);
    tap(xb, yb, wx * wy);
    out[0] = r; out[1] = g; out[2] = b; out[3] = a; // r,g,b premultiplied by alpha in 0..1 (scaled 0..255), a in 0..1
  };

  const tmp = new Float32Array(4);
  const writeSampled = (x: number, y: number, dx: number, dy: number) => {
    const o = (y * W + x) * 4;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
      raw.data[o] = src[o]; raw.data[o + 1] = src[o + 1]; raw.data[o + 2] = src[o + 2]; raw.data[o + 3] = src[o + 3]; // untouched: the same bytes
      return;
    }
    sample(x + 0.5 + dx, y + 0.5 + dy, tmp);
    const a = tmp[3];
    if (a <= 0) {
      raw.data[o] = raw.data[o + 1] = raw.data[o + 2] = raw.data[o + 3] = 0;
    } else {
      raw.data[o] = tmp[0] / a;
      raw.data[o + 1] = tmp[1] / a;
      raw.data[o + 2] = tmp[2] / a;
      raw.data[o + 3] = a * 255;
    }
  };

  const bounds = (c: Pt) => ({ x0: Math.max(Math.floor(c.x - R) - 1, 0), y0: Math.max(Math.floor(c.y - R) - 1, 0), x1: Math.min(Math.ceil(c.x + R) + 1, W), y1: Math.min(Math.ceil(c.y + R) + 1, H) });

  /** one dab of a field mode: `m` is the pointer's step for push */
  const fieldDab = (c: Pt, m: Pt) => {
    if (!field) field = new Float32Array(W * H * 2);
    const f = field;
    const { x0, y0, x1, y1 } = bounds(c);
    const bw = x1 - x0, bh = y1 - y0;
    if (bw <= 0 || bh <= 0) return;
    const next = scratch.next; // the new field over the brush box, from the old one (buffers are reused: no allocation per dab)
    const used = scratch.used;
    used.fill(0, 0, bw * bh);
    const readField = (x: number, y: number, out: number[]) => {
      // bilinear read of the OLD field at a pixel position (pixel centre = integer + 0.5 maps to index x)
      const fx = x - 0.5, fy = y - 0.5;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const wx = fx - ix, wy = fy - iy;
      const at = (xx: number, yy: number) => {
        const cx = Math.min(Math.max(xx, 0), W - 1), cy = Math.min(Math.max(yy, 0), H - 1);
        return (cy * W + cx) * 2;
      };
      const a = at(ix, iy), b = at(ix + 1, iy), d = at(ix, iy + 1), e = at(ix + 1, iy + 1);
      out[0] = f[a] * (1 - wx) * (1 - wy) + f[b] * wx * (1 - wy) + f[d] * (1 - wx) * wy + f[e] * wx * wy;
      out[1] = f[a + 1] * (1 - wx) * (1 - wy) + f[b + 1] * wx * (1 - wy) + f[d + 1] * (1 - wx) * wy + f[e + 1] * wx * wy;
    };
    const old = [0, 0];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const dist = Math.hypot(px - c.x, py - c.y);
        const w = strength * falloff(dist / R, hardness);
        if (w <= 0) continue;
        let dx = 0, dy = 0; // where this pixel takes its colour from, relative to itself, for this dab
        if (opts.mode === "push") {
          dx = -m.x * w * PUSH_GAIN;
          dy = -m.y * w * PUSH_GAIN;
        } else {
          const k = (opts.mode === "bloat" ? -1 : 1) * w * SWELL_GAIN; // bloat: take colour from nearer the centre; pucker: from farther out
          dx = (px - c.x) * k;
          dy = (py - c.y) * k;
        }
        if (dx === 0 && dy === 0) continue;
        readField(px + dx, py + dy, old);
        const i = ((y - y0) * bw + (x - x0)) * 2;
        next[i] = dx + old[0];
        next[i + 1] = dy + old[1];
        used[(y - y0) * bw + (x - x0)] = 1;
      }
    }
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!used[(y - y0) * bw + (x - x0)]) continue;
        const i = ((y - y0) * bw + (x - x0)) * 2;
        const o = (y * W + x) * 2;
        f[o] = next[i];
        f[o + 1] = next[i + 1];
        writeSampled(x, y, f[o], f[o + 1]);
        box = grow(box, x, y);
        step = grow(step, x, y);
      }
    }
  };

  /** one dab of restore: the picture under the brush moves back toward the reference */
  const restoreDab = (c: Pt) => {
    if (!reference || reference.width !== W || reference.height !== H) return;
    const { x0, y0, x1, y1 } = bounds(c);
    const ref = reference.data;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const w = Math.min(strength * 0.5, 1) * falloff(Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) / R, hardness);
        if (w <= 0) continue;
        const o = (y * W + x) * 4;
        const a1 = raw.data[o + 3] / 255, a2 = ref[o + 3] / 255;
        const pa = a1 * (1 - w) + a2 * w;
        if (pa <= 0) {
          raw.data[o] = raw.data[o + 1] = raw.data[o + 2] = raw.data[o + 3] = 0;
        } else {
          for (let k = 0; k < 3; k++) raw.data[o + k] = (raw.data[o + k] * a1 * (1 - w) + ref[o + k] * a2 * w) / pa;
          raw.data[o + 3] = pa * 255;
        }
        box = grow(box, x, y);
        step = grow(step, x, y);
      }
    }
  };

  const dabAt = (c: Pt, m: Pt) => (opts.mode === "restore" ? restoreDab(c) : fieldDab(c, m));

  return {
    add(p) {
      step = null;
      if (![p.x, p.y].every(Number.isFinite)) return null;
      if (!last) {
        last = { x: p.x, y: p.y };
        if (opts.mode !== "push") dabAt(last, { x: 0, y: 0 }); // a press already bloats, puckers or restores
        return step;
      }
      const dx = p.x - last.x, dy = p.y - last.y;
      const dist = Math.hypot(dx, dy);
      if (dist === 0) return null;
      const ux = dx / dist, uy = dy / dist;
      let at = spacing - carry;
      while (at <= dist) {
        const c = { x: last.x + ux * at, y: last.y + uy * at };
        dabAt(c, { x: ux * spacing, y: uy * spacing }); // every dab moves the picture by the pointer's travel since the previous dab
        at += spacing;
      }
      carry = dist - (at - spacing);
      last = { x: p.x, y: p.y };
      return step;
    },
    dirty: () => box,
  };
}

/** the whole stroke at once (tests, and anything without a live preview): changes `raw` in place, returns the box written (null: nothing) */
export function liquifyStroke(raw: RawImage, points: readonly Pt[], opts: LiquifyOptions, reference: RawImage | null = null): IRect | null {
  const source: RawImage = { width: raw.width, height: raw.height, data: new Uint8ClampedArray(raw.data) };
  const s = createLiquify(raw, source, reference, opts);
  for (const p of points) s.add(p);
  return s.dirty();
}
