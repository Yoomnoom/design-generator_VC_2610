import { IRect, Pt } from "./brush-raster";
import { RawImage } from "./raw-image";

/* The finger tool: dragging smears the colour under the start of the stroke along the stroke, as a finger drags wet paint.
 *
 * A brush-sized buffer carries the colour. At every dab (a point along the stroke) each pixel under the brush moves toward the carried
 * colour by `strength × falloff`, and the buffer then takes what the pixels became, so the paint thins out as it travels. All blending is
 * on premultiplied colour, so smearing opaque paint into a transparent area leaves no dark fringe, and smearing a transparent area into
 * opaque paint only thins it. Nothing outside the bitmap is written, and the buffer reads the bitmap's nearest edge pixel where the brush
 * hangs over it, so the edge does not drag transparency into the picture.
 *
 * The bitmap is changed in place: the caller hands in a working copy and keeps the original (images are immutable in the project). */

export type SmudgeOptions = {
  /** brush diameter in bitmap pixels */
  size: number;
  /** 0..1: how much of the carried colour lands under the brush at each dab */
  strength: number;
  /** 0..1: 1 = a hard disc, 0 = the pull fades out smoothly from the centre */
  hardness: number;
};

export const MIN_SMUDGE_SIZE = 2;
export const MAX_SMUDGE_SIZE = 300;

/** pull at a distance from the centre (0..1 of the radius): 1 inside the hard core, then a smooth fall to 0 at the rim */
export function falloff(t: number, hardness: number): number {
  if (t >= 1) return 0;
  if (t <= hardness) return 1;
  const u = (t - hardness) / (1 - hardness);
  return 1 - u * u * (3 - 2 * u); // smoothstep
}

export type Smudge = {
  /** the stroke moves on to this point (bitmap pixels); the dabs between the last point and this one are applied.
   *  The box of pixels these dabs wrote (null when there were none), so a preview can repaint just that. */
  add(p: Pt): IRect | null;
  /** the box of pixels that were written so far (null while nothing was) */
  dirty(): IRect | null;
};

/** an incremental stroke over `raw` (changed in place), so a live preview can follow the pointer */
export function createSmudge(raw: RawImage, opts: SmudgeOptions): Smudge {
  const size = Math.min(Math.max(opts.size, MIN_SMUDGE_SIZE), MAX_SMUDGE_SIZE);
  const strength = Math.min(Math.max(opts.strength, 0), 1);
  const hardness = Math.min(Math.max(opts.hardness, 0), 0.999);
  const R = size / 2;
  const side = Math.ceil(size) + 2;
  const spacing = Math.max(1, size * 0.15);
  const buf = new Float32Array(side * side * 4); // carried colour, premultiplied, 0..255, indexed from the brush box's corner
  const { width: W, height: H, data } = raw;
  let last: Pt | null = null;
  let carry = 0; // distance left over since the last dab
  let box: IRect | null = null;
  let step: IRect | null = null; // what the dabs of the present add() wrote
  const grow = (b: IRect | null, x: number, y: number): IRect => (b ? { x: Math.min(b.x, x), y: Math.min(b.y, y), width: Math.max(b.x + b.width, x + 1) - Math.min(b.x, x), height: Math.max(b.y + b.height, y + 1) - Math.min(b.y, y) } : { x, y, width: 1, height: 1 });

  const originOf = (c: Pt) => ({ x: Math.floor(c.x - R) - 1, y: Math.floor(c.y - R) - 1 });
  const clampX = (x: number) => Math.min(Math.max(x, 0), W - 1);
  const clampY = (y: number) => Math.min(Math.max(y, 0), H - 1);

  /** the first dab only picks up colour */
  const pickUp = (c: Pt) => {
    const o = originOf(c);
    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++) {
        const s = (clampY(o.y + j) * W + clampX(o.x + i)) * 4;
        const a = data[s + 3] / 255;
        const d = (j * side + i) * 4;
        buf[d] = data[s] * a;
        buf[d + 1] = data[s + 1] * a;
        buf[d + 2] = data[s + 2] * a;
        buf[d + 3] = data[s + 3];
      }
    }
  };

  const dab = (c: Pt) => {
    const o = originOf(c);
    for (let j = 0; j < side; j++) {
      const y = o.y + j;
      if (y < 0 || y >= H) continue;
      for (let i = 0; i < side; i++) {
        const x = o.x + i;
        if (x < 0 || x >= W) continue;
        const w = strength * falloff(Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) / R, hardness);
        if (w <= 0) continue;
        const s = (y * W + x) * 4;
        const d = (j * side + i) * 4;
        const a = data[s + 3] / 255;
        // premultiplied: what is there, moved toward what the finger carries
        const pr = data[s] * a * (1 - w) + buf[d] * w;
        const pg = data[s + 1] * a * (1 - w) + buf[d + 1] * w;
        const pb = data[s + 2] * a * (1 - w) + buf[d + 2] * w;
        const pa = data[s + 3] * (1 - w) + buf[d + 3] * w;
        // the finger now carries what the pixel became (so the paint thins out along the way)
        buf[d] = pr;
        buf[d + 1] = pg;
        buf[d + 2] = pb;
        buf[d + 3] = pa;
        if (pa <= 0) {
          data[s] = data[s + 1] = data[s + 2] = data[s + 3] = 0;
        } else {
          const k = 255 / pa;
          data[s] = pr * k;
          data[s + 1] = pg * k;
          data[s + 2] = pb * k;
          data[s + 3] = pa;
        }
        box = grow(box, x, y);
        step = grow(step, x, y);
      }
    }
  };

  return {
    add(p) {
      step = null;
      if (![p.x, p.y].every(Number.isFinite)) return null;
      if (!last) {
        last = { x: p.x, y: p.y };
        pickUp(last);
        return null;
      }
      const dx = p.x - last.x, dy = p.y - last.y;
      const dist = Math.hypot(dx, dy);
      if (dist === 0) return null;
      let at = spacing - carry; // distance along this segment to the next dab
      while (at <= dist) {
        const c = { x: last.x + (dx * at) / dist, y: last.y + (dy * at) / dist };
        dab(c);
        at += spacing;
      }
      carry = dist - (at - spacing);
      last = { x: p.x, y: p.y };
      return step;
    },
    dirty: () => box,
  };
}

/** the whole stroke at once: changes `raw` in place and returns the box that was written (null: the stroke changed nothing) */
export function smudgeStroke(raw: RawImage, points: readonly Pt[], opts: SmudgeOptions): IRect | null {
  const s = createSmudge(raw, opts);
  for (const p of points) s.add(p);
  return s.dirty();
}
