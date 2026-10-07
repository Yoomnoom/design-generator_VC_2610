import { describe, expect, test } from "vitest";
import { RenderLayer, renderComposite } from "@/lib/image/render-export";
import { RawImage, createRawImage } from "@/lib/image/raw-image";
import { getPixel, setPixel, solid } from "./helpers";

const CLEAR = [0, 0, 0, 0];
const A: [number, number, number, number] = [255, 0, 0, 255];
const B: [number, number, number, number] = [0, 0, 255, 255];

/** a row of pixels */
const strip = (...colors: [number, number, number, number][]): RawImage => {
  const img = createRawImage(colors.length, 1);
  colors.forEach((c, i) => setPixel(img, i, 0, c));
  return img;
};
const layer = (image: RawImage, over: Partial<RenderLayer>): RenderLayer => ({ image, x: 0, y: 0, zIndex: 0, opacity: 1, visible: true, ...over });
const render = (layers: RenderLayer[], w = 20, h = 20) => renderComposite({ width: w, height: h, source: createRawImage(w, h), patches: [], layers });

/** every pixel of `out` that is not fully transparent, as "x,y" */
const painted = (out: RawImage) => {
  const at: string[] = [];
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) if (getPixel(out, x, y)[3] > 0) at.push(`${x},${y}`);
  return at;
};

describe("quarter turns land every pixel exactly", () => {
  test("90° clockwise about the top-left: a row of two becomes a column of two to the left of the origin", () => {
    const out = render([layer(strip(A, B), { x: 10, y: 10, rotation: 90 })]);
    expect(getPixel(out, 9, 10)).toEqual(A);
    expect(getPixel(out, 9, 11)).toEqual(B);
    expect(painted(out)).toEqual(["9,10", "9,11"]); // nothing else, nothing smeared
  });

  test("180°", () => {
    const out = render([layer(strip(A, B), { x: 10, y: 10, rotation: 180 })]);
    expect(getPixel(out, 9, 9)).toEqual(A);
    expect(getPixel(out, 8, 9)).toEqual(B);
    expect(painted(out)).toEqual(["8,9", "9,9"]);
  });

  test("-90° (270°)", () => {
    const out = render([layer(strip(A, B), { x: 10, y: 10, rotation: -90 })]);
    expect(getPixel(out, 10, 9)).toEqual(A);
    expect(getPixel(out, 10, 8)).toEqual(B);
    expect(painted(out)).toEqual(["10,8", "10,9"]);
  });

  test("a bigger picture turned 90° keeps its rows and columns intact", () => {
    const img = createRawImage(3, 2);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) setPixel(img, x, y, [x * 10, y * 100, 7, 255]);
    const out = render([layer(img, { x: 10, y: 5, rotation: 90 })]);
    // bitmap pixel (lx, ly) lands at (10 - 1 - ly, 5 + lx)
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) expect(getPixel(out, 9 - y, 5 + x)).toEqual([x * 10, y * 100, 7, 255]);
    expect(painted(out)).toHaveLength(6);
  });
});

describe("scale", () => {
  test("a whole-number scale-up of a flat colour fills exactly the scaled rectangle", () => {
    const out = render([layer(solid(3, 2, A), { x: 5, y: 4, scaleX: 2, scaleY: 3 })]);
    expect(painted(out)).toHaveLength(6 * 6);
    expect(getPixel(out, 5, 4)).toEqual(A);
    expect(getPixel(out, 10, 9)).toEqual(A);
    expect(getPixel(out, 11, 9)).toEqual(CLEAR);
    expect(getPixel(out, 10, 10)).toEqual(CLEAR);
    expect(getPixel(out, 4, 4)).toEqual(CLEAR);
  });

  test("scaling down by half gives exactly the half-size rectangle", () => {
    const out = render([layer(solid(8, 4, B), { x: 2, y: 2, scaleX: 0.5, scaleY: 0.5 })]);
    expect(painted(out)).toHaveLength(4 * 2);
  });

  test("scaling up blends between neighbouring pixels (bilinear), edges keep the end colours", () => {
    const out = render([layer(strip(A, B), { x: 0, y: 0, scaleX: 2 })], 6, 3);
    expect(getPixel(out, 0, 0)).toEqual(A);
    expect(getPixel(out, 3, 0)).toEqual(B);
    // columns 1 and 2 sit a quarter and three quarters of the way from red to blue
    expect(getPixel(out, 1, 0).slice(0, 3)).toEqual([191, 0, 64]);
    expect(getPixel(out, 2, 0).slice(0, 3)).toEqual([64, 0, 191]);
    expect(getPixel(out, 4, 0)).toEqual(CLEAR);
  });

  test("a negative scale mirrors", () => {
    const out = render([layer(strip(A, B), { x: 10, y: 3, scaleX: -1 })]);
    expect(getPixel(out, 9, 3)).toEqual(A);
    expect(getPixel(out, 8, 3)).toEqual(B);
    expect(painted(out)).toEqual(["8,3", "9,3"]);
  });

  test("a fractional position with scale is honoured, not rounded to a whole pixel", () => {
    // 4 wide at x = 2.5 covers 2.5 … 6.5004: pixel centres 2.5, 3.5, 4.5, 5.5 and 6.5 are inside. Rounding x to 3 would give four columns.
    const out = render([layer(solid(4, 1, A), { x: 2.5, y: 0, scaleX: 1.0001 })]);
    expect(painted(out)).toEqual(["2,0", "3,0", "4,0", "5,0", "6,0"]);
  });
});

describe("rotation by other angles", () => {
  test("45°: the covered area (alpha-weighted, so an edge pixel counts by how much of it is covered) is the area of the bitmap", () => {
    const out = render([layer(solid(20, 20, A), { x: 30, y: 5, rotation: 45 })], 60, 40);
    let area = 0;
    for (let i = 3; i < out.data.length; i += 4) area += out.data[i] / 255;
    expect(area).toBeGreaterThan(400 * 0.99);
    expect(area).toBeLessThan(400 * 1.01);
    expect(getPixel(out, 30, 5 + 14)).toEqual(A); // the middle of the diamond
    expect(getPixel(out, 30, 3)).toEqual(CLEAR); // above its top corner
  });

  test("the result is the same wherever in the frame a rotated layer sits (translation does not change its shape)", () => {
    const shape = (ox: number, oy: number) => {
      const out = render([layer(solid(7, 5, A), { x: ox, y: oy, rotation: 30, scaleX: 1.5 })], 60, 60);
      return painted(out).map((s) => s.split(",").map(Number)).map(([x, y]) => `${x - ox},${y - oy}`);
    };
    expect(shape(10, 10)).toEqual(shape(30, 20));
  });

  test("a rotated layer that hangs off the frame is cut at the edge without trouble", () => {
    const out = render([layer(solid(30, 30, A), { x: 5, y: 5, rotation: 33 })], 20, 20);
    expect(painted(out).length).toBeGreaterThan(0);
    expect(out.width).toBe(20);
  });

  test("a layer entirely outside the frame draws nothing", () => {
    expect(painted(render([layer(solid(5, 5, A), { x: 100, y: 100, rotation: 20 })]))).toEqual([]);
  });
});

describe("cross-checks", () => {
  test("turning a layer by 360° gives exactly what leaving it alone gives (the sampler is exact on pixel centres)", () => {
    const img = createRawImage(9, 7);
    for (let y = 0; y < 7; y++) for (let x = 0; x < 9; x++) setPixel(img, x, y, [x * 25, y * 35, (x * y) % 256, 200 + ((x + y) % 55)]);
    const still = render([layer(img, { x: 4, y: 6 })]);
    const turned = render([layer(img, { x: 4, y: 6, rotation: 360 })]);
    expect(Array.from(turned.data)).toEqual(Array.from(still.data));
  });

  test("scale 1 with a hair of rotation still covers the same area (nothing lost or invented at the edges)", () => {
    const out = render([layer(solid(10, 10, A), { x: 5, y: 5, rotation: 0.001 })]);
    let area = 0;
    for (let i = 3; i < out.data.length; i += 4) area += out.data[i] / 255;
    expect(area).toBeGreaterThan(99.5);
    expect(area).toBeLessThan(100.5);
  });

  test("opacity applies to a transformed layer too", () => {
    const out = render([layer(solid(4, 4, A), { x: 2, y: 2, scaleX: 2, opacity: 0.5 })]);
    expect(getPixel(out, 3, 3)[3]).toBe(128);
  });

  test("a hidden transformed layer is skipped", () => {
    expect(painted(render([layer(solid(4, 4, A), { x: 2, y: 2, rotation: 45, visible: false })]))).toEqual([]);
  });

  test("a transformed layer is drawn above the one under it and below the one above, by zIndex", () => {
    const out = render([layer(solid(6, 6, B), { x: 5, y: 5, rotation: 90, zIndex: 2 }), layer(solid(10, 10, A), { x: 0, y: 0, zIndex: 1 })]);
    expect(getPixel(out, 2, 6)).toEqual(B); // the rotated blue layer covers part of the red one
    expect(getPixel(out, 8, 8)).toEqual(A);
  });

  test("transparent pixels of a transformed layer stay transparent (no colour bleeds out of them)", () => {
    const img = createRawImage(2, 1);
    setPixel(img, 0, 0, [255, 0, 0, 255]);
    setPixel(img, 1, 0, [0, 255, 0, 0]); // fully transparent green
    const out = render([layer(img, { x: 0, y: 0, scaleX: 4 })], 10, 2);
    for (let x = 0; x < 8; x++) {
      const [r, g, , a] = getPixel(out, x, 0);
      if (a > 0) expect(g).toBe(0); // whatever alpha there is carries red only, never the green of the transparent pixel
      expect(r === 255 || a === 0).toBe(true);
    }
  });

  test("the output is always exactly the frame size", () => {
    const out = renderComposite({ width: 13, height: 9, source: createRawImage(13, 9), patches: [], layers: [layer(solid(40, 40, A), { x: -5, y: -5, rotation: 77, scaleX: 3 })] });
    expect([out.width, out.height, out.data.length]).toEqual([13, 9, 13 * 9 * 4]);
  });
});
