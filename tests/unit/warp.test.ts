import { describe, expect, test } from "vitest";
import { cosSin } from "@/lib/geometry/layer-transform";
import { MESH_REACH, dragMeshPoint, dragQuadCorner, dragQuadEdge, identityMesh, identityQuad, isIdentityWarp, resizeMesh, warpError, warpForward, warpInverse, warpOutline } from "@/lib/image/warp";
import { rasterizeWarped } from "@/lib/image/warp-raster";
import { renderComposite } from "@/lib/image/render-export";
import { RawImage, createRawImage } from "@/lib/image/raw-image";
import { WarpMesh, WarpQuad } from "@/lib/project/schema";
import { setPixel, solid } from "./helpers";

const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);
const alphaAt = (img: RawImage, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3];
const px = (img: RawImage, x: number, y: number) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
const upright = { scaleX: 1, scaleY: 1, rotation: 0 };

/** a 40×30 picture whose colour depends on position, so a wrong sample is visible */
const gradient = (w = 40, h = 30): RawImage => {
  const img = createRawImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPixel(img, x, y, [Math.round((x / w) * 255), Math.round((y / h) * 255), 100, 255]);
  return img;
};

describe("quad warp maths", () => {
  const quad: WarpQuad = { kind: "quad", points: [{ x: 10, y: 5 }, { x: 95, y: 0 }, { x: 80, y: 70 }, { x: 0, y: 60 }] };

  test("each corner of the bitmap lands exactly on its point", () => {
    const f = warpForward(quad, 100, 60);
    const corners = [[0, 0], [100, 0], [100, 60], [0, 60]];
    corners.forEach(([u, v], i) => {
      const p = f(u, v);
      near(p.x, quad.points[i].x);
      near(p.y, quad.points[i].y);
    });
  });

  test("the inverse undoes the forward map, also for a perspective quad", () => {
    const f = warpForward(quad, 100, 60);
    const inv = warpInverse(quad, 100, 60);
    const out = { u: 0, v: 0 };
    for (const [u, v] of [[5, 5], [50, 30], [99, 1], [20, 55], [100, 60]]) {
      const p = f(u, v);
      expect(inv.contains(p.x, p.y) || (u === 100 && v === 60)).toBe(true);
      expect(inv.solve(p.x, p.y, out)).toBe(true);
      near(out.u, u, 1e-6);
      near(out.v, v, 1e-6);
    }
  });

  test("an unwarped quad is the identity", () => {
    expect(isIdentityWarp(identityQuad(100, 60), 100, 60)).toBe(true);
    expect(isIdentityWarp(quad, 100, 60)).toBe(false);
  });

  test("a point outside the shape is not contained", () => {
    const inv = warpInverse(quad, 100, 60);
    expect(inv.contains(-5, -5)).toBe(false);
    expect(inv.contains(50, 30)).toBe(true);
  });
});

describe("how a drag changes a quad", () => {
  const start = identityQuad(100, 60);
  test("a free corner follows the pointer and the others stay (distortion)", () => {
    const q = dragQuadCorner(start, 2, { x: 7, y: -4 }, "none");
    expect(q.points[2]).toEqual({ x: 107, y: 56 });
    expect([q.points[0], q.points[1], q.points[3]]).toEqual([start.points[0], start.points[1], start.points[3]]);
  });
  test("with a mirror the neighbour moves the opposite way across: a symmetric trapezoid (perspective)", () => {
    const q = dragQuadCorner(start, 0, { x: 10, y: 6 }, "x");
    expect(q.points[0]).toEqual({ x: 10, y: 6 });
    expect(q.points[1]).toEqual({ x: 90, y: 6 }); // x mirrored, y shared
    expect(q.points[2]).toEqual(start.points[2]);
    const v = dragQuadCorner(start, 0, { x: 10, y: 6 }, "y");
    expect(v.points[3]).toEqual({ x: 10, y: 54 });
  });
  test("pushing an edge slides its two corners along the edge only (skew)", () => {
    const q = dragQuadEdge(start, 0, { x: 12, y: 9 }); // top edge runs along x: only the x part counts
    expect(q.points[0]).toEqual({ x: 12, y: 0 });
    expect(q.points[1]).toEqual({ x: 112, y: 0 });
    expect(q.points[2]).toEqual(start.points[2]);
    expect(q.points[3]).toEqual(start.points[3]);
  });
});

describe("mesh warp maths", () => {
  const mesh = (): WarpMesh => {
    const m = identityMesh(3, 3, 90, 60);
    // push the inner points about
    m.points[5] = { x: 35, y: 24 };
    m.points[6] = { x: 52, y: 20 };
    m.points[9] = { x: 28, y: 36 };
    return m;
  };

  test("the control points are exactly where the forward map puts the grid corners", () => {
    const m = mesh();
    const f = warpForward(m, 90, 60);
    m.points.forEach((p, n) => {
      const p2 = f(((n % 4) * 90) / 3, (Math.floor(n / 4) * 60) / 3);
      near(p2.x, p.x);
      near(p2.y, p.y);
    });
  });

  test("the inverse finds the bitmap point under a warped point", () => {
    const m = mesh();
    const f = warpForward(m, 90, 60);
    const inv = warpInverse(m, 90, 60);
    const out = { u: 0, v: 0 };
    for (const [u, v] of [[10, 10], [45, 30], [80, 50], [31, 12], [60, 40], [2, 58]]) {
      const p = f(u, v);
      expect(inv.contains(p.x, p.y)).toBe(true);
      expect(inv.solve(p.x, p.y, out)).toBe(true);
      near(out.u, u, 1e-3);
      near(out.v, v, 1e-3);
    }
  });

  test("dragging a point pulls its neighbours smoothly: full at the point, less further out, nothing beyond the reach", () => {
    const start = identityMesh(5, 5, 100, 100);
    const centre = 2 * 6 + 2;
    const m = dragMeshPoint(start, centre, { x: 10, y: 0 });
    const moved = (n: number) => m.points[n].x - start.points[n].x;
    near(moved(centre), 10);
    const one = moved(centre + 1), two = moved(centre + 2);
    expect(one).toBeGreaterThan(two);
    expect(two).toBeGreaterThan(0);
    expect(one).toBeLessThan(10);
    near(moved(0), 0); // 2.8 cells away: beyond MESH_REACH
    expect(MESH_REACH).toBeLessThan(2.83);
    // the same pull in the opposite direction is symmetric
    const left = moved(centre - 1);
    near(left, one);
  });

  test("changing the grid size keeps the present shape", () => {
    const m = mesh();
    const finer = resizeMesh(m, 6, 6, 90, 60);
    const f1 = warpForward(m, 90, 60), f2 = warpForward(finer, 90, 60);
    for (const [u, v] of [[15, 10], [45, 30], [75, 50]]) {
      const a = f1(u, v), b = f2(u, v);
      near(a.x, b.x, 1e-6);
      near(a.y, b.y, 1e-6);
    }
    expect(finer.points).toHaveLength(49);
  });

  test("the outline goes round the edge once", () => {
    expect(warpOutline(identityMesh(3, 2, 90, 60))).toHaveLength(10);
    expect(warpOutline(identityQuad(9, 9))).toHaveLength(4);
  });
});

describe("what a warp may be", () => {
  test("accepts a gentle quad and mesh; refuses a crossed quad, a flat one, bad counts and junk", () => {
    expect(warpError(identityQuad(100, 60), 100, 60)).toBeNull();
    expect(warpError(identityMesh(3, 3, 100, 60), 100, 60)).toBeNull();
    const crossed: WarpQuad = { kind: "quad", points: [{ x: 0, y: 0 }, { x: 100, y: 60 }, { x: 100, y: 0 }, { x: 0, y: 60 }] };
    expect(warpError(crossed, 100, 60)).not.toBeNull();
    const flat: WarpQuad = { kind: "quad", points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }] };
    expect(warpError(flat, 100, 60)).not.toBeNull();
    const arrow: WarpQuad = { kind: "quad", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 60 }] }; // a dent: not convex, and not flat
    expect(warpError(arrow, 100, 60)).not.toBeNull();
    expect(warpError({ kind: "mesh", cols: 3, rows: 3, points: [] }, 100, 60)).not.toBeNull();
    expect(warpError({ kind: "mesh", cols: 99, rows: 3, points: [] }, 100, 60)).not.toBeNull();
    expect(warpError({ kind: "quad", points: [{ x: NaN, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }, 100, 60)).not.toBeNull();
    expect(warpError(null, 100, 60)).not.toBeNull();
    expect(warpError({ kind: "spiral" }, 100, 60)).not.toBeNull();
  });
});

describe("drawing a warped bitmap", () => {
  test("a warp that only moves the picture a whole number of pixels gives the picture itself, byte for byte", () => {
    const img = gradient();
    const shifted: WarpQuad = { kind: "quad", points: [{ x: 5, y: 3 }, { x: 45, y: 3 }, { x: 45, y: 33 }, { x: 5, y: 33 }] };
    const r = rasterizeWarped(img, upright, shifted)!;
    expect([r.x, r.y, r.image.width, r.image.height]).toEqual([5, 3, 40, 30]);
    expect(Array.from(r.image.data)).toEqual(Array.from(img.data));
  });

  test("a warp that changes nothing leaves the composite byte-identical to no warp", () => {
    const img = gradient();
    const base = { width: 80, height: 60, source: solid(80, 60, [240, 240, 240, 255]), patches: [] };
    const plain = renderComposite({ ...base, layers: [{ image: img, x: 12, y: 9, zIndex: 1, opacity: 1, visible: true }] });
    const withIdentity = renderComposite({ ...base, layers: [{ image: img, x: 12, y: 9, warp: identityQuad(40, 30), zIndex: 1, opacity: 1, visible: true }] });
    expect(Array.from(withIdentity.data)).toEqual(Array.from(plain.data));
    const scaledPlain = renderComposite({ ...base, layers: [{ image: img, x: 12, y: 9, scaleX: 1.5, scaleY: 1.5, rotation: 30, zIndex: 1, opacity: 1, visible: true }] });
    const scaledIdentity = renderComposite({ ...base, layers: [{ image: img, x: 12, y: 9, scaleX: 1.5, scaleY: 1.5, rotation: 30, warp: identityMesh(3, 3, 40, 30), zIndex: 1, opacity: 1, visible: true }] });
    expect(Array.from(scaledIdentity.data)).toEqual(Array.from(scaledPlain.data));
  });

  test("the composite draws a warped layer exactly as rasterizeWarped does, laid on whole pixels, under opacity", () => {
    const img = gradient();
    const warp: WarpQuad = { kind: "quad", points: [{ x: 8, y: 2 }, { x: 44, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 28 }] };
    const base = { width: 90, height: 70, source: solid(90, 70, [240, 240, 240, 255]), patches: [] };
    const out = renderComposite({ ...base, layers: [{ image: img, x: 20.4, y: 15, warp, scaleX: 1.5, scaleY: 1.5, rotation: 25, zIndex: 1, opacity: 1, visible: true }] });
    const plain = renderComposite({ ...base, layers: [{ image: img, x: 20.4, y: 15, scaleX: 1.5, scaleY: 1.5, rotation: 25, zIndex: 1, opacity: 1, visible: true }] });
    expect(Array.from(out.data)).not.toEqual(Array.from(plain.data)); // the warp changed the picture
    const r = rasterizeWarped(img, { scaleX: 1.5, scaleY: 1.5, rotation: 25 }, warp, { clip: { x: -20, y: -15, width: 90, height: 70 } })!;
    // the layer sits at x = 20 (20.4 rounded), y = 15: a pixel of the raster lands at (20 + r.x + i, 15 + r.y + j)
    let checked = 0;
    for (let j = 0; j < r.image.height; j += 3) {
      for (let i = 0; i < r.image.width; i += 3) {
        if (r.image.data[(j * r.image.width + i) * 4 + 3] !== 255) continue;
        expect(px(out, 20 + r.x + i, 15 + r.y + j)).toEqual(px(r.image, i, j));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
    const half = renderComposite({ ...base, layers: [{ image: img, x: 20, y: 15, warp, zIndex: 1, opacity: 0.5, visible: true }] });
    expect(px(half, 20 + 20, 15 + 15)[0]).not.toBe(px(renderComposite({ ...base, layers: [{ image: img, x: 20, y: 15, warp, zIndex: 1, opacity: 1, visible: true }] }), 40, 30)[0]);
  });

  test("moving a corner moves the picture's corner there: the shape covers exactly the new quad", () => {
    const img = solid(40, 30, [200, 30, 30, 255]);
    const quad: WarpQuad = { kind: "quad", points: [{ x: 10, y: 4 }, { x: 60, y: 0 }, { x: 52, y: 40 }, { x: 0, y: 34 }] };
    const r = rasterizeWarped(img, upright, quad)!;
    // the raster spans the quad's bounding box
    expect([r.x, r.y, r.image.width, r.image.height]).toEqual([0, 0, 60, 40]);
    const inv = warpInverse(quad, 40, 30);
    let wrong = 0;
    for (let y = 0; y < r.image.height; y++) {
      for (let x = 0; x < r.image.width; x++) {
        const centreIn = inv.contains(r.x + x + 0.5, r.y + y + 0.5);
        const a = alphaAt(r.image, x, y);
        if (centreIn && a < 128) wrong++; // a pixel whose middle is inside must be mostly covered
        if (!centreIn && a > 128) wrong++; // one whose middle is outside must be mostly empty
      }
    }
    expect(wrong).toBeLessThanOrEqual(2); // only a pixel at a sharp corner can disagree: its middle is in, but less than half of it is
    // a point well inside is solid, one outside the quad is empty
    expect(alphaAt(r.image, 30, 20)).toBe(255);
    expect(alphaAt(r.image, 2, 2)).toBe(0);
  });

  test("alpha is kept: a transparent part stays transparent and its hidden colour does not leak into the edge", () => {
    const img = createRawImage(20, 20);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) setPixel(img, x, y, x < 10 ? [255, 0, 0, 0] : [0, 0, 255, 255]); // left half transparent red, right half opaque blue
    const quad: WarpQuad = { kind: "quad", points: [{ x: 3, y: 2 }, { x: 28, y: 0 }, { x: 26, y: 24 }, { x: 0, y: 22 }] };
    const r = rasterizeWarped(img, upright, quad)!;
    let leak = 0, transparentSeen = 0, solidSeen = 0;
    for (let i = 0; i < r.image.data.length; i += 4) {
      const a = r.image.data[i + 3];
      if (a === 0) continue;
      if (a < 255) transparentSeen++;
      else solidSeen++;
      if (r.image.data[i] > 10) leak++; // any red in a visible pixel means the transparent half bled in
    }
    expect(leak).toBe(0);
    expect(solidSeen).toBeGreaterThan(50);
    expect(transparentSeen).toBeGreaterThan(0); // soft edges exist
    expect(alphaAt(r.image, 4, 12)).toBe(0); // inside the shape, over the transparent half
  });

  test("scale and rotation come after the warp: the whole bent shape is scaled, then turned", () => {
    const img = solid(40, 30, [10, 200, 10, 255]);
    const quad: WarpQuad = { kind: "quad", points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }] };
    const bent: WarpQuad = { kind: "quad", points: [{ x: 6, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }] };
    const a = rasterizeWarped(img, { scaleX: 2, scaleY: 2, rotation: 0 }, bent)!;
    expect([a.image.width, a.image.height]).toEqual([80, 60]);
    // the cut corner (6, 0) scaled by 2 is (12, 0): the top-left pixels up to x = 12 are empty, the top edge is covered after it
    expect(alphaAt(a.image, 3, 0)).toBe(0);
    expect(alphaAt(a.image, 40, 1)).toBe(255);
    // 90 degrees clockwise: the outline's corners go (x, y) -> (-y, x)
    const b = rasterizeWarped(img, { scaleX: 1, scaleY: 1, rotation: 90 }, bent)!;
    expect([b.x, b.y, b.image.width, b.image.height]).toEqual([-30, 0, 30, 40]);
    const { cos, sin } = cosSin(90);
    expect([cos, sin]).toEqual([0, 1]);
    // the picture's top-left corner (6, 0) lands on (0, 6) in the rotated raster's own coordinates: (-30 + 30 = 0 → x index 30)
    expect(alphaAt(b.image, 29, 1)).toBe(0);
    expect(quad.points).toHaveLength(4);
  });

  test("a large scale is cut to the clip, so only what shows is drawn", () => {
    const img = solid(40, 30, [10, 10, 10, 255]);
    const big = { scaleX: 50, scaleY: 50, rotation: 0 };
    const q: WarpQuad = { kind: "quad", points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 38, y: 30 }, { x: 2, y: 30 }] };
    const clipped = rasterizeWarped(img, big, q, { clip: { x: 500, y: 400, width: 100, height: 80 } })!;
    expect([clipped.x, clipped.y, clipped.image.width, clipped.image.height]).toEqual([500, 400, 100, 80]);
    expect(alphaAt(clipped.image, 50, 40)).toBe(255);
  });
});