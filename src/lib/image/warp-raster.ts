import { cosSin } from "../geometry/layer-transform";
import { LayerWarp, Rect } from "../project/schema";
import { RawImage, createRawImage } from "./raw-image";
import { WarpInverse, warpInverse } from "./warp";

/* Drawing a warped bitmap. The screen and the PNG export both call rasterizeWarped, so what you see is what you export.
 *
 * Each output pixel is traced back into the bitmap (the inverse of  position · rotation · scale · warp ; the position is applied by the
 * caller, which places the result at a whole pixel). Colour is a bilinear sample (premultiplied, so a transparent edge does not bleed
 * colour into its neighbours). A pixel that the warped shape only partly covers gets its alpha multiplied by the covered share (4 × 4
 * samples), so the edges are anti-aliased exactly as in the plain scale/rotate path. */

export type WarpRaster = {
  image: RawImage;
  /** where the raster's top-left pixel is, relative to the layer's own origin (a whole number, and a multiple of `step`) */
  x: number;
  y: number;
  /** frame pixels per raster pixel: 1 for the real thing, more for a quick low-resolution preview */
  step: number;
};

export type WarpPlacement = { scaleX: number; scaleY: number; rotation: number };

/** a raster beyond this many pixels is refused (the caller clips it to the frame first) */
export const MAX_RASTER_PIXELS = 64_000_000;

const EDGE_SAMPLES = 4;

/** the corners of the warped outline after scale and rotation: relative to the layer's origin, in frame pixels */
export function warpedOutlineLocal(inv: Pick<WarpInverse, "outline">, t: WarpPlacement) {
  const { cos, sin } = cosSin(t.rotation);
  return inv.outline.map((p) => {
    const sx = p.x * t.scaleX, sy = p.y * t.scaleY;
    return { x: cos * sx - sin * sy + 0, y: sin * sx + cos * sy + 0 };
  });
}

/** The warped bitmap as pixels. `clip` (relative to the layer's origin, frame pixels) limits how much is drawn, so that a layer scaled far
 *  beyond the frame costs only what shows. Null when nothing is left to draw or the result would be absurdly large. */
export function rasterizeWarped(image: RawImage, t: WarpPlacement, warp: LayerWarp, opts: { step?: number; clip?: Rect } = {}): WarpRaster | null {
  const step = Math.max(1, Math.round(opts.step ?? 1));
  const inv = warpInverse(warp, image.width, image.height);
  const { cos, sin } = cosSin(t.rotation);
  const outline = warpedOutlineLocal(inv, t);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of outline) (minX = Math.min(minX, p.x)), (maxX = Math.max(maxX, p.x)), (minY = Math.min(minY, p.y)), (maxY = Math.max(maxY, p.y));
  if (opts.clip) {
    minX = Math.max(minX, opts.clip.x);
    minY = Math.max(minY, opts.clip.y);
    maxX = Math.min(maxX, opts.clip.x + opts.clip.width);
    maxY = Math.min(maxY, opts.clip.y + opts.clip.height);
  }
  if (!(maxX > minX) || !(maxY > minY)) return null;
  const x0 = Math.floor(minX / step) * step, y0 = Math.floor(minY / step) * step;
  const W = Math.ceil((maxX - x0) / step), H = Math.ceil((maxY - y0) / step);
  if (W < 1 || H < 1 || W * H > MAX_RASTER_PIXELS) return null;

  const out = createRawImage(W, H);
  const { data, width: iw, height: ih } = image;
  const uv = { u: 0, v: 0 };
  // lattice rows: the bitmap point under each pixel corner (u, v) and whether the corner is under the shape
  let rowA = { u: new Float32Array(W + 1), v: new Float32Array(W + 1), ok: new Uint8Array(W + 1) };
  let rowB = { u: new Float32Array(W + 1), v: new Float32Array(W + 1), ok: new Uint8Array(W + 1) };
  const qx = (X: number, Y: number) => (cos * X + sin * Y) / t.scaleX;
  const qy = (X: number, Y: number) => (-sin * X + cos * Y) / t.scaleY;
  const fillRow = (row: typeof rowA, j: number) => {
    const Y = y0 + j * step;
    for (let i = 0; i <= W; i++) {
      const X = x0 + i * step;
      const x = qx(X, Y), y = qy(X, Y);
      if (inv.contains(x, y) && inv.solve(x, y, uv)) {
        row.u[i] = uv.u;
        row.v[i] = uv.v;
        row.ok[i] = 1;
      } else row.ok[i] = 0;
    }
  };
  const sub = 1 / EDGE_SAMPLES;
  fillRow(rowA, 0);
  for (let j = 0; j < H; j++) {
    fillRow(rowB, j + 1);
    for (let i = 0; i < W; i++) {
      const n = rowA.ok[i] + rowA.ok[i + 1] + rowB.ok[i] + rowB.ok[i + 1];
      if (n === 0) continue;
      let su = 0, sv = 0;
      if (rowA.ok[i]) (su += rowA.u[i]), (sv += rowA.v[i]);
      if (rowA.ok[i + 1]) (su += rowA.u[i + 1]), (sv += rowA.v[i + 1]);
      if (rowB.ok[i]) (su += rowB.u[i]), (sv += rowB.v[i]);
      if (rowB.ok[i + 1]) (su += rowB.u[i + 1]), (sv += rowB.v[i + 1]);
      let coverage = 1;
      if (n < 4) {
        // the edge of the shape cuts through this pixel: the share of its sample points under the shape
        let inside = 0;
        for (let b = 0; b < EDGE_SAMPLES; b++) {
          for (let a = 0; a < EDGE_SAMPLES; a++) {
            const X = x0 + (i + (a + 0.5) * sub) * step, Y = y0 + (j + (b + 0.5) * sub) * step;
            if (inv.contains(qx(X, Y), qy(X, Y))) inside++;
          }
        }
        if (inside === 0) continue;
        coverage = inside / (EDGE_SAMPLES * EDGE_SAMPLES);
      }
      // colour at the middle of the pixel, held inside the bitmap so a pixel that only touches the edge takes the edge's colour.
      // A quad is solved exactly at the middle (perspective is not linear); a mesh uses the average of its corners, or of the ones under it.
      let mu = su / n, mv = sv / n;
      if (inv.exactEverywhere) {
        const X = x0 + (i + 0.5) * step, Y = y0 + (j + 0.5) * step;
        if (inv.solve(qx(X, Y), qy(X, Y), uv)) (mu = uv.u), (mv = uv.v);
      } else if (n < 4) {
        const X = x0 + (i + 0.5) * step, Y = y0 + (j + 0.5) * step;
        if (inv.contains(qx(X, Y), qy(X, Y)) && inv.solve(qx(X, Y), qy(X, Y), uv)) (mu = uv.u), (mv = uv.v);
      }
      const cx = Math.min(Math.max(mu, 0), iw), cy = Math.min(Math.max(mv, 0), ih);
      const fx = cx - 0.5, fy = cy - 0.5;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const wx = fx - ix, wy = fy - iy;
      const xa = Math.min(Math.max(ix, 0), iw - 1), xb = Math.min(Math.max(ix + 1, 0), iw - 1);
      const ya = Math.min(Math.max(iy, 0), ih - 1), yb = Math.min(Math.max(iy + 1, 0), ih - 1);
      let a = 0, r = 0, g = 0, bl = 0;
      for (let k = 0; k < 4; k++) {
        const o = ((k < 2 ? ya : yb) * iw + (k % 2 === 0 ? xa : xb)) * 4;
        const w = (k % 2 === 0 ? 1 - wx : wx) * (k < 2 ? 1 - wy : wy);
        const wa = (data[o + 3] / 255) * w;
        a += wa;
        r += data[o] * wa;
        g += data[o + 1] * wa;
        bl += data[o + 2] * wa;
      }
      if (a <= 0) continue;
      const o = (j * W + i) * 4;
      out.data[o] = r / a;
      out.data[o + 1] = g / a;
      out.data[o + 2] = bl / a;
      out.data[o + 3] = a * 255 * coverage;
    }
    [rowA, rowB] = [rowB, rowA];
  }
  return { image: out, x: x0, y: y0, step };
}
