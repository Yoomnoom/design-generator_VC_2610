import { LayerWarp, WarpMesh, WarpPoint, WarpQuad } from "../project/schema";

/* The maths of a layer warp (see LayerWarp in schema.ts). Pure functions: no canvas, no DOM, so the editor, the PNG export and the tests
 * all use the same numbers.
 *
 * Order of everything that happens to a layer:  warp  →  scale  →  rotation  →  position.
 * A bitmap pixel p goes to  T(x, y) · R(rotation) · S(scaleX, scaleY) · warp(p).  Here we only deal with warp(p), in the bitmap's own pixels. */

export const MESH_MIN = 1;
export const MESH_MAX = 16;
/** a default mesh is 3 × 3 cells (4 × 4 control points) */
export const MESH_DEFAULT = 3;

const EPS = 1e-9;

export const identityQuad = (w: number, h: number): WarpQuad => ({ kind: "quad", points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] });

export function identityMesh(cols: number, rows: number, w: number, h: number): WarpMesh {
  const points: WarpPoint[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) points.push({ x: (i * w) / cols, y: (j * h) / rows });
  return { kind: "mesh", cols, rows, points };
}

/** true when every point is where an unwarped bitmap would have it, so the warp changes nothing */
export function isIdentityWarp(warp: LayerWarp, w: number, h: number): boolean {
  const base = warp.kind === "quad" ? identityQuad(w, h) : identityMesh(warp.cols, warp.rows, w, h);
  return warp.points.every((p, i) => Math.abs(p.x - base.points[i].x) < 1e-6 && Math.abs(p.y - base.points[i].y) < 1e-6);
}

/** the warp that actually changes the picture: none for a missing warp and for one whose points are all where an unwarped bitmap has them */
export const effectiveWarp = (warp: LayerWarp | null | undefined, w: number, h: number): LayerWarp | undefined => (warp && !isIdentityWarp(warp, w, h) ? warp : undefined);

export const cloneWarp = (warp: LayerWarp): LayerWarp => (warp.kind === "quad" ? { kind: "quad", points: warp.points.map((p) => ({ ...p })) as WarpQuad["points"] } : { kind: "mesh", cols: warp.cols, rows: warp.rows, points: warp.points.map((p) => ({ ...p })) });

/** points rounded to 1/100 pixel, so files do not fill up with noise */
export function roundWarp(warp: LayerWarp): LayerWarp {
  const r = (v: number) => Math.round(v * 100) / 100 + 0;
  const pts = warp.points.map((p) => ({ x: r(p.x), y: r(p.y) }));
  return warp.kind === "quad" ? { kind: "quad", points: pts as WarpQuad["points"] } : { kind: "mesh", cols: warp.cols, rows: warp.rows, points: pts };
}

/** the outline of the warped bitmap, in warped bitmap pixels, going round the edge (a quad's four corners; a mesh's edge points) */
export function warpOutline(warp: LayerWarp): WarpPoint[] {
  if (warp.kind === "quad") return warp.points;
  const { cols, rows, points } = warp;
  const at = (i: number, j: number) => points[j * (cols + 1) + i];
  const out: WarpPoint[] = [];
  for (let i = 0; i < cols; i++) out.push(at(i, 0));
  for (let j = 0; j < rows; j++) out.push(at(cols, j));
  for (let i = cols; i > 0; i--) out.push(at(i, rows));
  for (let j = rows; j > 0; j--) out.push(at(0, j));
  return out;
}

/** even-odd point-in-polygon */
export function polygonContains(poly: readonly WarpPoint[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const polygonArea = (poly: readonly WarpPoint[]) => {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return s / 2;
};

/** why a warp is not acceptable (null when it is): the editor refuses it, and a file holding it is not opened */
export function warpError(warp: unknown, w: number, h: number): string | null {
  if (typeof warp !== "object" || warp === null) return "warp가 객체가 아닙니다";
  const k = warp as Record<string, unknown>;
  const limit = Math.max(w, h) * 20 + 1000;
  const pointsOk = (pts: unknown, n: number) =>
    Array.isArray(pts) && pts.length === n && pts.every((p) => typeof p === "object" && p !== null && Number.isFinite((p as WarpPoint).x) && Number.isFinite((p as WarpPoint).y) && Math.abs((p as WarpPoint).x) <= limit && Math.abs((p as WarpPoint).y) <= limit);
  if (k.kind === "quad") {
    if (!pointsOk(k.points, 4)) return "warp의 네 점이 올바르지 않습니다";
    const p = k.points as WarpPoint[];
    // convex and not flat: the four turns all go the same way
    const turns = p.map((a, i) => {
      const b = p[(i + 1) % 4], c = p[(i + 2) % 4];
      return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    });
    if (!(turns.every((t) => t > EPS) || turns.every((t) => t < -EPS))) return "모서리 네 점이 볼록한 사각형을 이루지 않습니다";
    if (Math.abs(polygonArea(p)) < 1) return "변형된 모양의 넓이가 너무 작습니다";
    return null;
  }
  if (k.kind === "mesh") {
    const { cols, rows } = k;
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || (cols as number) < MESH_MIN || (rows as number) < MESH_MIN || (cols as number) > MESH_MAX || (rows as number) > MESH_MAX) return "warp의 격자 크기가 올바르지 않습니다";
    if (!pointsOk(k.points, ((cols as number) + 1) * ((rows as number) + 1))) return "warp의 조절점이 올바르지 않습니다";
    if (Math.abs(polygonArea(warpOutline(k as unknown as WarpMesh))) < 1) return "변형된 모양의 넓이가 너무 작습니다";
    return null;
  }
  return "warp.kind가 올바르지 않습니다";
}

/** where a bitmap point (u, v) goes (warped bitmap pixels) */
export function warpForward(warp: LayerWarp, w: number, h: number): (u: number, v: number) => WarpPoint {
  if (warp.kind === "quad") {
    const m = homography(warp.points, w, h);
    return (u, v) => {
      const d = m[6] * u + m[7] * v + m[8];
      return { x: (m[0] * u + m[1] * v + m[2]) / d, y: (m[3] * u + m[4] * v + m[5]) / d };
    };
  }
  const { cols, rows, points } = warp;
  const cw = w / cols, ch = h / rows;
  return (u, v) => {
    const i = Math.min(Math.max(Math.floor(u / cw), 0), cols - 1), j = Math.min(Math.max(Math.floor(v / ch), 0), rows - 1);
    const s = u / cw - i, t = v / ch - j;
    const A = points[j * (cols + 1) + i], B = points[j * (cols + 1) + i + 1], C = points[(j + 1) * (cols + 1) + i + 1], D = points[(j + 1) * (cols + 1) + i];
    return {
      x: (1 - s) * (1 - t) * A.x + s * (1 - t) * B.x + s * t * C.x + (1 - s) * t * D.x,
      y: (1 - s) * (1 - t) * A.y + s * (1 - t) * B.y + s * t * C.y + (1 - s) * t * D.y,
    };
  };
}

/** 3×3 row-major matrix taking a bitmap point (u, v) of a w × h bitmap to the warped quad (homogeneous: divide by the last row) */
function homography(q: readonly WarpPoint[], w: number, h: number): number[] {
  const [p0, p1, p2, p3] = q;
  const sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y;
  let a: number, b: number, d: number, e: number, g = 0, hh = 0;
  if (Math.abs(sx) < EPS && Math.abs(sy) < EPS) {
    a = p1.x - p0.x; b = p3.x - p0.x; d = p1.y - p0.y; e = p3.y - p0.y;
  } else {
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
    const det = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / det;
    hh = (dx1 * sy - sx * dy1) / det;
    a = p1.x - p0.x + g * p1.x; b = p3.x - p0.x + hh * p3.x; d = p1.y - p0.y + g * p1.y; e = p3.y - p0.y + hh * p3.y;
  }
  // the matrix above takes the unit square; pre-scale so it takes bitmap pixels
  return [a / w, b / h, p0.x, d / w, e / h, p0.y, g / w, hh / h, 1];
}

function invert3(m: readonly number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

export type WarpInverse = {
  /** the warped outline, in warped bitmap pixels */
  outline: WarpPoint[];
  /** true when solve() is exact (and cheap) anywhere, also just outside the shape: a quad. A mesh can only be solved inside. */
  exactEverywhere: boolean;
  /** is the point (warped bitmap pixels) covered by the warped bitmap */
  contains(x: number, y: number): boolean;
  /** the bitmap point that lands on (x, y), written into `out`; false when there is none. Only meaningful for a covered point. */
  solve(x: number, y: number, out: { u: number; v: number }): boolean;
};

/** The inverse of a warp, for tracing output pixels back into the bitmap (and the pointer back onto it). */
export function warpInverse(warp: LayerWarp, w: number, h: number): WarpInverse {
  const outline = warpOutline(warp);
  const contains = (x: number, y: number) => polygonContains(outline, x, y);
  if (warp.kind === "quad") {
    const inv = invert3(homography(warp.points, w, h));
    return {
      outline,
      contains,
      exactEverywhere: true,
      solve(x, y, out) {
        const W = inv[6] * x + inv[7] * y + inv[8];
        if (!(Math.abs(W) > EPS)) return false;
        out.u = (inv[0] * x + inv[1] * y + inv[2]) / W;
        out.v = (inv[3] * x + inv[4] * y + inv[5]) / W;
        return true;
      },
    };
  }
  return { outline, contains, exactEverywhere: false, solve: meshSolver(warp, w, h) };
}

/** Newton's method on the cell-by-cell bilinear map. It starts from where the previous point ended (neighbouring pixels are close), and
 *  falls back to the cell whose centre is nearest when that does not converge. */
function meshSolver(m: WarpMesh, w: number, h: number) {
  const { cols, rows, points } = m;
  const cw = w / cols, ch = h / rows;
  const at = (i: number, j: number) => points[j * (cols + 1) + i];
  let hu = w / 2, hv = h / 2;
  const centres = Array.from({ length: cols * rows }, (_, n) => {
    const i = n % cols, j = Math.floor(n / cols);
    const A = at(i, j), B = at(i + 1, j), C = at(i + 1, j + 1), D = at(i, j + 1);
    return { x: (A.x + B.x + C.x + D.x) / 4, y: (A.y + B.y + C.y + D.y) / 4, u: (i + 0.5) * cw, v: (j + 0.5) * ch };
  });
  const clamp = (v: number, hi: number) => Math.min(Math.max(v, 0), hi);

  const newton = (qx: number, qy: number, u0: number, v0: number, out: { u: number; v: number }) => {
    let u = u0, v = v0;
    for (let it = 0; it < 30; it++) {
      const i = Math.min(Math.floor(u / cw), cols - 1), j = Math.min(Math.floor(v / ch), rows - 1);
      const s = u / cw - i, t = v / ch - j;
      const A = at(i, j), B = at(i + 1, j), C = at(i + 1, j + 1), D = at(i, j + 1);
      const fx = (1 - s) * (1 - t) * A.x + s * (1 - t) * B.x + s * t * C.x + (1 - s) * t * D.x;
      const fy = (1 - s) * (1 - t) * A.y + s * (1 - t) * B.y + s * t * C.y + (1 - s) * t * D.y;
      const rx = fx - qx, ry = fy - qy;
      if (Math.abs(rx) < 1e-4 && Math.abs(ry) < 1e-4) {
        out.u = u;
        out.v = v;
        hu = u;
        hv = v;
        return true;
      }
      const dxdu = ((1 - t) * (B.x - A.x) + t * (C.x - D.x)) / cw, dydu = ((1 - t) * (B.y - A.y) + t * (C.y - D.y)) / cw;
      const dxdv = ((1 - s) * (D.x - A.x) + s * (C.x - B.x)) / ch, dydv = ((1 - s) * (D.y - A.y) + s * (C.y - B.y)) / ch;
      const det = dxdu * dydv - dxdv * dydu;
      if (Math.abs(det) < 1e-12) return false;
      const du = (-rx * dydv + ry * dxdv) / det, dv = (-dxdu * ry + dydu * rx) / det;
      const lim = 2 * Math.max(cw, ch); // never leap more than two cells at once
      u = clamp(u + Math.max(-lim, Math.min(lim, du)), w);
      v = clamp(v + Math.max(-lim, Math.min(lim, dv)), h);
    }
    return false;
  };

  return (x: number, y: number, out: { u: number; v: number }) => {
    if (newton(x, y, hu, hv, out)) return true;
    let best = centres[0], bd = Infinity;
    for (const c of centres) {
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bd) (bd = d), (best = c);
    }
    return newton(x, y, best.u, best.v, out);
  };
}

/* ---- editing: how a drag turns into a new warp ---- */

/** the dragged corner follows the pointer; with a mirror, the corner next to it moves the opposite way across the shape's middle line,
 *  which makes a perspective (a trapezoid) instead of a free distortion. */
export function dragQuadCorner(start: WarpQuad, index: number, delta: WarpPoint, mirror: "none" | "x" | "y"): WarpQuad {
  const pts = start.points.map((p) => ({ ...p })) as WarpQuad["points"];
  pts[index] = { x: start.points[index].x + delta.x, y: start.points[index].y + delta.y };
  if (mirror !== "none") {
    // corners 0 1 / 3 2: the horizontal neighbour of 0 is 1, of 1 is 0, of 2 is 3, of 3 is 2; the vertical neighbour of 0 is 3, of 1 is 2, ...
    const other = mirror === "x" ? [1, 0, 3, 2][index] : [3, 2, 1, 0][index];
    pts[other] = mirror === "x" ? { x: start.points[other].x - delta.x, y: start.points[other].y + delta.y } : { x: start.points[other].x + delta.x, y: start.points[other].y - delta.y };
  }
  return { kind: "quad", points: pts };
}

/** pushing the middle of an edge moves that edge's two corners together, along the edge only: a skew */
export function dragQuadEdge(start: WarpQuad, edge: number, delta: WarpPoint): WarpQuad {
  const a = start.points[edge], b = start.points[(edge + 1) % 4];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  const along = delta.x * ux + delta.y * uy;
  const pts = start.points.map((p) => ({ ...p })) as WarpQuad["points"];
  for (const k of [edge, (edge + 1) % 4]) pts[k] = { x: start.points[k].x + ux * along, y: start.points[k].y + uy * along };
  return { kind: "quad", points: pts };
}

/** how far (in grid cells) a dragged control point's pull reaches */
export const MESH_REACH = 2.5;

/** The dragged control point follows the pointer fully; the points around it follow by a smooth fall-off (a cosine bell), so the bitmap
 *  bends around the pull instead of getting a spike. Positions are taken from the warp as it was when the drag began. */
export function dragMeshPoint(start: WarpMesh, index: number, delta: WarpPoint): WarpMesh {
  const { cols } = start;
  const ci = index % (cols + 1), cj = Math.floor(index / (cols + 1));
  const points = start.points.map((p, n) => {
    const r = Math.hypot((n % (cols + 1)) - ci, Math.floor(n / (cols + 1)) - cj);
    const wgt = n === index ? 1 : r >= MESH_REACH ? 0 : 0.5 * (1 + Math.cos((Math.PI * r) / MESH_REACH));
    return wgt === 0 ? { ...p } : { x: p.x + delta.x * wgt, y: p.y + delta.y * wgt };
  });
  return { kind: "mesh", cols, rows: start.rows, points };
}

/** A mesh with a new number of cells that keeps the present shape: the new grid's points are read off the old warp. */
export function resizeMesh(warp: LayerWarp, cols: number, rows: number, w: number, h: number): WarpMesh {
  const fwd = warpForward(warp, w, h);
  const points: WarpPoint[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) points.push(fwd((i * w) / cols, (j * h) / rows));
  return { kind: "mesh", cols, rows, points };
}

/** the four corners of a warp, as a quad (a mesh keeps only its corners) */
export function toQuad(warp: LayerWarp): WarpQuad {
  if (warp.kind === "quad") return warp;
  const { cols, rows, points } = warp;
  return { kind: "quad", points: [points[0], points[cols], points[rows * (cols + 1) + cols], points[rows * (cols + 1)]].map((p) => ({ ...p })) as WarpQuad["points"] };
}
