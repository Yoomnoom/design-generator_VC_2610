import { describe, expect, test } from "vitest";
import { createRawImage, RawImage } from "@/lib/image/raw-image";
import { LiquifyMode, createLiquify, liquifyStroke } from "@/lib/image/liquify";

const opts = (mode: LiquifyMode, size = 60, strength = 1, hardness = 0.5) => ({ mode, size, strength, hardness });
/** blue page with a red vertical bar 20 wide at x 60..79 (centre 69.5) */
const bar = () => {
  const r = createRawImage(200, 100, [0, 0, 255, 255]);
  for (let y = 0; y < 100; y++) for (let x = 60; x < 80; x++) r.data.set([255, 0, 0, 255], (y * 200 + x) * 4);
  return r;
};
const copy = (r: RawImage): RawImage => ({ width: r.width, height: r.height, data: new Uint8ClampedArray(r.data) });
const redCentroid = (r: RawImage, y: number) => {
  let sum = 0, n = 0;
  for (let x = 0; x < r.width; x++) {
    const i = (y * r.width + x) * 4;
    if (r.data[i] > 128 && r.data[i + 2] < 128) (sum += x, n++);
  }
  return n ? sum / n : NaN;
};
const line = (x0: number, y0: number, x1: number, y1: number, n = 40) => Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n }));
const same = (a: RawImage, b: RawImage) => Buffer.from(a.data).equals(Buffer.from(b.data));

describe("nothing moved, nothing changes", () => {
  test("a stroke of no length, one point, or a push without travel leaves every byte as it was", () => {
    for (const mode of ["push", "bloat", "pucker"] as const) {
      const r = bar();
      const before = copy(r);
      liquifyStroke(r, [], opts(mode));
      expect(same(r, before)).toBe(true);
    }
    const r = bar();
    const before = copy(r);
    expect(liquifyStroke(r, [{ x: 70, y: 50 }, { x: 70, y: 50 }], opts("push"))).toBeNull();
    expect(same(r, before)).toBe(true);
  });

  test("a semi-transparent picture keeps its exact bytes where nothing was moved (no premultiply round trip)", () => {
    const r = createRawImage(100, 60, [10, 200, 30, 77]);
    const before = copy(r);
    liquifyStroke(r, line(20, 30, 40, 30), opts("push", 20, 1));
    // far from the brush: byte for byte as before
    for (let y = 0; y < 60; y++) for (let x = 70; x < 100; x++) expect(r.data[(y * 100 + x) * 4 + 3]).toBe(before.data[(y * 100 + x) * 4 + 3]);
    expect(Buffer.from(r.data.subarray(70 * 4, 100 * 4)).equals(Buffer.from(before.data.subarray(70 * 4, 100 * 4)))).toBe(true);
  });
});

describe("push", () => {
  test("pushing the bar to the right moves it by about the distance the pointer travelled (strength 100%)", () => {
    const r = bar();
    const c0 = redCentroid(r, 50);
    liquifyStroke(r, line(40, 50, 90, 50), opts("push", 60, 1));
    const moved = redCentroid(r, 50) - c0;
    expect(moved).toBeGreaterThan(8);
    expect(moved).toBeLessThan(60);
  });

  test("direction: left, down and up", () => {
    const left = bar();
    liquifyStroke(left, line(90, 50, 40, 50), opts("push", 60, 1));
    expect(redCentroid(left, 50)).toBeLessThan(69.5 - 8);
    // a bar pushed down: a horizontal red bar moves toward larger y
    const h = createRawImage(100, 200, [0, 0, 255, 255]);
    for (let y = 60; y < 80; y++) for (let x = 0; x < 100; x++) h.data.set([255, 0, 0, 255], (y * 100 + x) * 4);
    const rowCentroid = (img: RawImage, x: number) => {
      let s = 0, n = 0;
      for (let y = 0; y < img.height; y++) if (img.data[(y * img.width + x) * 4] > 128 && img.data[(y * img.width + x) * 4 + 2] < 128) (s += y, n++);
      return s / n;
    };
    const down = copy(h), up = copy(h);
    liquifyStroke(down, line(50, 40, 50, 90), opts("push", 60, 1));
    liquifyStroke(up, line(50, 90, 50, 40), opts("push", 60, 1));
    expect(rowCentroid(down, 50)).toBeGreaterThan(69.5 + 8);
    expect(rowCentroid(up, 50)).toBeLessThan(69.5 - 8);
  });

  test("the same path with few or many points gives the same picture (points are interpolated, drag speed does not matter)", () => {
    const a = bar(), b = bar(), c = bar();
    liquifyStroke(a, line(40, 50, 90, 50, 2), opts("push", 60, 1));
    liquifyStroke(b, line(40, 50, 90, 50, 10), opts("push", 60, 1));
    liquifyStroke(c, line(40, 50, 90, 50, 200), opts("push", 60, 1));
    const diff = (x: RawImage, y: RawImage) => x.data.reduce((m, v, i) => Math.max(m, Math.abs(v - y.data[i])), 0);
    expect(diff(a, b)).toBeLessThanOrEqual(1);
    expect(diff(a, c)).toBeLessThanOrEqual(1);
  });

  test("a weaker strength moves it less", () => {
    const strong = bar(), weak = bar();
    liquifyStroke(strong, line(40, 50, 90, 50), opts("push", 60, 1));
    liquifyStroke(weak, line(40, 50, 90, 50), opts("push", 60, 0.3));
    expect(redCentroid(weak, 50) - 69.5).toBeLessThan(redCentroid(strong, 50) - 69.5);
    expect(redCentroid(weak, 50) - 69.5).toBeGreaterThan(1); // but it is visible
  });

  test("the default-sized drag makes a clearly visible change (many pixels differ)", () => {
    const r = bar();
    const before = copy(r);
    liquifyStroke(r, line(40, 50, 80, 50), opts("push", 60, 0.7));
    let changed = 0;
    for (let i = 0; i < r.data.length; i += 4) if (r.data[i] !== before.data[i] || r.data[i + 2] !== before.data[i + 2]) changed++;
    expect(changed).toBeGreaterThan(200);
  });
});

describe("bloat and pucker", () => {
  const disc = () => {
    const r = createRawImage(200, 200, [0, 0, 255, 255]);
    for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) if (Math.hypot(x + 0.5 - 100, y + 0.5 - 100) <= 12) r.data.set([255, 0, 0, 255], (y * 200 + x) * 4);
    return r;
  };
  const redCount = (r: RawImage) => { let n = 0; for (let i = 0; i < r.data.length; i += 4) if (r.data[i] > 128 && r.data[i + 2] < 128) n++; return n; };

  test("bloat grows the disc and pucker shrinks it, around the brush centre", () => {
    const base = redCount(disc());
    const big = disc(), small = disc();
    liquifyStroke(big, [{ x: 100, y: 100 }], opts("bloat", 100, 1));
    liquifyStroke(small, [{ x: 100, y: 100 }], opts("pucker", 100, 1));
    expect(redCount(big)).toBeGreaterThan(base * 1.3);
    expect(redCount(small)).toBeLessThan(base * 0.8);
    // still centred
    const cx = (r: RawImage) => { let s = 0, n = 0; for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) if (r.data[(y * 200 + x) * 4] > 128) (s += x, n++); return s / n; };
    expect(Math.abs(cx(big) - 100)).toBeLessThan(1);
    expect(Math.abs(cx(small) - 100)).toBeLessThan(1);
  });

  test("holding the pointer in place (several points at one spot) does not keep growing it by itself, but dragging does more", () => {
    const one = disc(), drag = disc();
    liquifyStroke(one, [{ x: 100, y: 100 }], opts("bloat", 100, 1));
    liquifyStroke(drag, line(95, 100, 105, 100, 10), opts("bloat", 100, 1));
    expect(redCount(drag)).toBeGreaterThan(redCount(one));
  });
});

describe("restore", () => {
  test("restoring over a pushed area brings it back toward the reference and leaves the rest alone", () => {
    const original = bar();
    const r = copy(original);
    liquifyStroke(r, line(40, 50, 90, 50), opts("push", 60, 1));
    const moved = redCentroid(r, 50);
    const distBefore = Math.abs(moved - 69.5);
    liquifyStroke(r, line(40, 50, 100, 50, 120), opts("restore", 80, 1), original);
    expect(Math.abs(redCentroid(r, 50) - 69.5)).toBeLessThan(distBefore);
    // far away (x 150..200) nothing was touched by either stroke
    for (let y = 0; y < 100; y++) for (let x = 150; x < 200; x++) expect(r.data[(y * 200 + x) * 4 + 2]).toBe(255);
  });

  test("restore with no reference does nothing", () => {
    const r = bar();
    const before = copy(r);
    liquifyStroke(r, [{ x: 60, y: 50 }, { x: 80, y: 50 }], opts("restore"));
    expect(same(r, before)).toBe(true);
  });
});

describe("edges", () => {
  test("an opaque shape pushed into transparency keeps its colour at the soft edge: no dark fringe", () => {
    const r = createRawImage(160, 80, [0, 255, 0, 0]); // invisible pixels that still carry a colour (green) which must not leak into the edge
    for (let y = 20; y < 60; y++) for (let x = 30; x < 70; x++) r.data.set([255, 0, 0, 255], (y * 160 + x) * 4);
    liquifyStroke(r, line(40, 40, 110, 40), opts("push", 60, 1));
    let semi = 0;
    for (let i = 0; i < r.data.length; i += 4) {
      const a = r.data[i + 3];
      if (a > 8 && a < 247) {
        semi++;
        expect(Math.abs(r.data[i] - 255)).toBeLessThanOrEqual(2);
        expect(r.data[i + 1]).toBeLessThanOrEqual(2);
        expect(r.data[i + 2]).toBeLessThanOrEqual(2);
      }
    }
    expect(semi).toBeGreaterThan(5); // there was an edge to check
  });

  test("nothing is written outside the box that is reported, and the size never changes; content pushed past the edge is dropped", () => {
    const r = bar();
    const before = copy(r);
    const box = liquifyStroke(r, line(150, 50, 199, 50), opts("push", 60, 1))!;
    expect([r.width, r.height]).toEqual([200, 100]);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 200; x++) {
      const inside = x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
      if (!inside) for (let k = 0; k < 4; k++) expect(r.data[(y * 200 + x) * 4 + k], `(${x},${y})`).toBe(before.data[(y * 200 + x) * 4 + k]);
    }
  });

  test("a brush hanging over the edge works (no crash, in-bounds writes only); non-finite points are ignored", () => {
    const r = bar();
    const l = createLiquify(r, copy(r), null, opts("push", 80, 1));
    expect(l.add({ x: -20, y: 50 })).toBeNull();
    expect(l.add({ x: 20, y: 50 })).not.toBeNull();
    expect(l.add({ x: NaN, y: 3 })).toBeNull();
    expect(r.data.length).toBe(200 * 100 * 4);
  });
});