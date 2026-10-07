import { describe, expect, test } from "vitest";
import { RenderLayer, renderComposite } from "@/lib/image/render-export";
import { RawImage, createRawImage } from "@/lib/image/raw-image";
import { getPixel, setPixel, solid } from "./helpers";

const A: [number, number, number, number] = [255, 0, 0, 255];
const B: [number, number, number, number] = [0, 0, 255, 255];

const layer = (image: RawImage, over: Partial<RenderLayer>): RenderLayer => ({ image, x: 0, y: 0, zIndex: 0, opacity: 1, visible: true, ...over });
const render = (layers: RenderLayer[], w = 20, h = 20) => renderComposite({ width: w, height: h, source: createRawImage(w, h), patches: [], layers });

/** the area a layer covers: each pixel counts by its alpha */
const coveredArea = (out: RawImage) => {
  let sum = 0;
  for (let i = 3; i < out.data.length; i += 4) sum += out.data[i] / 255;
  return sum;
};
const alphaOf = (out: RawImage, x: number, y: number) => getPixel(out, x, y)[3];

describe("edges of resized and rotated layers are anti-aliased", () => {
  test("an edge halfway through a pixel gives half-covered pixels at both ends", () => {
    const out = render([layer(solid(4, 1, A), { x: 2.5, y: 0, scaleX: 1.0001 })]);
    expect(alphaOf(out, 2, 0)).toBeGreaterThanOrEqual(126);
    expect(alphaOf(out, 2, 0)).toBeLessThanOrEqual(130);
    for (const x of [3, 4, 5]) expect(alphaOf(out, x, 0)).toBe(255);
    expect(alphaOf(out, 6, 0)).toBeGreaterThanOrEqual(126);
    expect(alphaOf(out, 6, 0)).toBeLessThanOrEqual(130);
  });

  test("a scale that is not a whole number gives a soft edge in the pixel it ends in", () => {
    const out = render([layer(solid(3, 1, A), { x: 0, y: 0, scaleX: 1.5 })], 8, 2); // 4.5 px wide: columns 0-3 whole, column 4 half
    expect(alphaOf(out, 3, 0)).toBe(255);
    expect(alphaOf(out, 4, 0)).toBeGreaterThanOrEqual(126);
    expect(alphaOf(out, 4, 0)).toBeLessThanOrEqual(130);
    expect(alphaOf(out, 5, 0)).toBe(0);
  });

  test("a whole-number scale-up keeps hard edges: they fall exactly on the pixel grid, so no pixel is in between", () => {
    const out = render([layer(solid(3, 2, A), { x: 5, y: 4, scaleX: 2, scaleY: 3 })]);
    let painted = 0;
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) if (alphaOf(out, x, y) > 0) { painted++; expect(alphaOf(out, x, y)).toBe(255); }
    expect(painted).toBe(36);
  });

  test("a rotated layer has partly covered pixels all along its outline, in the layer's own colour (not darker, not blended)", () => {
    const out = render([layer(solid(30, 20, A), { x: 20, y: 10, rotation: 25 })], 80, 60);
    let partial = 0;
    for (let y = 0; y < 60; y++)
      for (let x = 0; x < 80; x++) {
        const [r, g, b, a] = getPixel(out, x, y);
        if (a > 0 && a < 255) {
          partial++;
          expect([r, g, b]).toEqual([255, 0, 0]);
        }
      }
    expect(partial).toBeGreaterThan(60); // about the length of the outline
  });

  test("the edge is smooth: crossing it, the alpha steps through intermediate values instead of jumping from 0 to 255", () => {
    const out = render([layer(solid(40, 40, A), { x: 10, y: 10, rotation: 20 })], 80, 80);
    const steps = new Set<number>();
    for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) { const a = alphaOf(out, x, y); if (a > 0 && a < 255) steps.add(a); }
    expect(steps.size).toBeGreaterThan(8); // many different coverages, not one or two
  });

  test("the area covered stays the layer's area at awkward angles and scales (nothing lost, nothing added at the edges)", () => {
    for (const [rotation, sx, sy] of [[10, 1, 1], [33, 1.7, 0.6], [-77, 0.8, 1.3], [145, 2.2, 2.2], [89.5, 1, 1], [0, 1.37, 1.37]] as const) {
      const out = render([layer(solid(30, 20, A), { x: 110, y: 90, rotation, scaleX: sx, scaleY: sy })], 200, 200); // roomy, so nothing is cut by the frame
      const area = 30 * 20 * sx * sy;
      expect(coveredArea(out)).toBeGreaterThan(area * 0.985);
      expect(coveredArea(out)).toBeLessThan(area * 1.015);
    }
  });

  test("edge alpha is multiplied by the layer's opacity", () => {
    const out = render([layer(solid(4, 1, A), { x: 2.5, y: 0, scaleX: 1.0001, opacity: 0.5 })]);
    expect(alphaOf(out, 2, 0)).toBeGreaterThanOrEqual(62);
    expect(alphaOf(out, 2, 0)).toBeLessThanOrEqual(66);
    expect(alphaOf(out, 4, 0)).toBe(128);
  });

  test("a soft edge over another layer blends with it instead of cutting a hole", () => {
    const out = render([layer(solid(20, 20, B), { zIndex: 0 }), layer(solid(10, 10, A), { x: 5.5, y: 5, scaleX: 1.0001, zIndex: 1 })], 30, 30);
    const [r, , b, a] = getPixel(out, 5, 8); // half red over blue
    expect(a).toBe(255);
    expect(r).toBeGreaterThan(100);
    expect(b).toBeGreaterThan(100);
  });

  test("a transparent pixel next to the edge does not leak its colour into it", () => {
    const img = createRawImage(2, 1);
    setPixel(img, 0, 0, [255, 0, 0, 255]);
    setPixel(img, 1, 0, [0, 255, 0, 0]);
    const out = render([layer(img, { x: 0.5, y: 0, scaleX: 3.3 })], 12, 2);
    for (let x = 0; x < 12; x++) { const [, g, , a] = getPixel(out, x, 0); if (a > 0) expect(g).toBe(0); }
  });

  test("no pixel outside the frame is touched, and the size is the frame's", () => {
    const out = renderComposite({ width: 13, height: 9, source: createRawImage(13, 9), patches: [], layers: [layer(solid(40, 40, A), { x: -5.5, y: -3.3, rotation: 31, scaleX: 3.3 })] });
    expect([out.width, out.height, out.data.length]).toEqual([13, 9, 13 * 9 * 4]);
  });
});

/* ---- the same bytes as before wherever the edges were already on the pixel grid ---- */

/** The exporter as it was before anti-aliasing: a pixel is in the layer if its centre is (hard edge), same sampling and blending. */
function legacyDraw(out: RawImage, layer: RenderLayer) {
  const t = { x: layer.x, y: layer.y, scaleX: layer.scaleX ?? 1, scaleY: layer.scaleY ?? 1, rotation: layer.rotation ?? 0 };
  const { image, opacity } = layer;
  const quarter = Number.isInteger(t.rotation / 90);
  const q = (((t.rotation / 90) % 4) + 4) % 4;
  const cos = quarter ? [1, 0, -1, 0][q] : Math.cos((t.rotation * Math.PI) / 180);
  const sin = quarter ? [0, 1, 0, -1][q] : Math.sin((t.rotation * Math.PI) / 180);
  const { data, width: iw, height: ih } = image;
  const px = new Uint8ClampedArray(4);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const dx = x + 0.5 - t.x, dy = y + 0.5 - t.y;
      const lx = (cos * dx + sin * dy) / t.scaleX, ly = (-sin * dx + cos * dy) / t.scaleY;
      if (lx < 0 || ly < 0 || lx >= iw || ly >= ih) continue;
      const fx = lx - 0.5, fy = ly - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), wx = fx - ix, wy = fy - iy;
      const xa = Math.min(Math.max(ix, 0), iw - 1), xb = Math.min(Math.max(ix + 1, 0), iw - 1);
      const ya = Math.min(Math.max(iy, 0), ih - 1), yb = Math.min(Math.max(iy + 1, 0), ih - 1);
      const taps = [[(ya * iw + xa) * 4, (1 - wx) * (1 - wy)], [(ya * iw + xb) * 4, wx * (1 - wy)], [(yb * iw + xa) * 4, (1 - wx) * wy], [(yb * iw + xb) * 4, wx * wy]];
      let a = 0, r = 0, g = 0, bl = 0;
      for (const [i, w] of taps) { const wa = (data[i + 3] / 255) * w; a += wa; r += data[i] * wa; g += data[i + 1] * wa; bl += data[i + 2] * wa; }
      if (a <= 0) continue;
      px[0] = r / a; px[1] = g / a; px[2] = bl / a; px[3] = a * 255;
      const d = (y * out.width + x) * 4, sa = (px[3] / 255) * opacity;
      if (sa === 0) continue;
      if (sa >= 1) { out.data.set(px, d); continue; }
      const da = out.data[d + 3] / 255, oa = sa + da * (1 - sa);
      for (let k = 0; k < 3; k++) out.data[d + k] = (px[k] * sa + out.data[d + k] * da * (1 - sa)) / oa;
      out.data[d + 3] = oa * 255;
    }
  }
}

/** content that varies in every channel, alpha included, so a wrong pixel cannot hide */
const busy = (w: number, h: number): RawImage => {
  const img = createRawImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPixel(img, x, y, [(x * 37 + y * 11) % 256, (x * 5 + y * 71) % 256, (x * y * 13) % 256, 90 + ((x * 3 + y * 7) % 166)]);
  return img;
};

describe("where the edges were already on the pixel grid, the output is byte for byte what it was before", () => {
  const frame = 64;
  const backdrop = createRawImage(frame, frame);
  for (let y = 0; y < frame; y++) for (let x = 0; x < frame; x++) setPixel(backdrop, x, y, [(x * 3) % 256, (y * 5) % 256, (x + y) % 256, 255]);

  const cases: [string, Partial<RenderLayer>][] = [
    ["rotation 0, scale 2", { x: 7, y: 9, scaleX: 2, scaleY: 2 }],
    ["rotation 0, scale 3 × 2", { x: 4, y: 5, scaleX: 3, scaleY: 2 }],
    ["rotation 0, scale 0.5 on an even-sized layer", { x: 10, y: 12, scaleX: 0.5, scaleY: 0.5 }],
    ["rotation 360", { x: 12, y: 14, rotation: 360 }],
    ["rotation 90", { x: 30, y: 8, rotation: 90 }],
    ["rotation 180", { x: 35, y: 33, rotation: 180 }],
    ["rotation -90", { x: 9, y: 40, rotation: -90 }],
    ["rotation 270", { x: 9, y: 40, rotation: 270 }],
    ["rotation 90, scale 2", { x: 50, y: 6, rotation: 90, scaleX: 2, scaleY: 2 }],
    ["rotation 180, scale 2 × 3", { x: 50, y: 50, rotation: 180, scaleX: 2, scaleY: 3 }],
    ["mirrored (scale -1)", { x: 30, y: 5, scaleX: -1 }],
    ["rotation 90, hanging off the frame", { x: 6, y: -4, rotation: 90, scaleX: 2, scaleY: 2 }],
    ["rotation 180, partly outside the frame", { x: 10, y: 10, rotation: 180 }],
    ["rotation 90 with opacity 0.6", { x: 30, y: 8, rotation: 90, opacity: 0.6 }],
    ["rotation 0, scale 2 with opacity 0.4", { x: 7, y: 9, scaleX: 2, scaleY: 2, opacity: 0.4 }],
  ];

  test.each(cases)("%s", (_name, over) => {
    const l = layer(busy(10, 6), over);
    const now = renderComposite({ width: frame, height: frame, source: backdrop, patches: [], layers: [l] });
    const before: RawImage = { width: frame, height: frame, data: new Uint8ClampedArray(backdrop.data) };
    legacyDraw(before, l);
    expect(Buffer.from(now.data).equals(Buffer.from(before.data))).toBe(true);
  });

  test("a layer that is only moved is still drawn by the exact copy, as before", () => {
    const l = layer(busy(11, 7), { x: 12, y: 20 });
    const now = renderComposite({ width: frame, height: frame, source: backdrop, patches: [], layers: [l] });
    const before: RawImage = { width: frame, height: frame, data: new Uint8ClampedArray(backdrop.data) };
    legacyDraw(before, l);
    expect(Buffer.from(now.data).equals(Buffer.from(before.data))).toBe(true);
  });

  test("the comparison is not vacuous: where an edge cuts through a pixel, the output does differ from the hard-edged one", () => {
    const l = layer(busy(11, 7), { x: 7.4, y: 9.3, scaleX: 2.3, scaleY: 1.7, rotation: 20 });
    const now = renderComposite({ width: frame, height: frame, source: backdrop, patches: [], layers: [l] });
    const before: RawImage = { width: frame, height: frame, data: new Uint8ClampedArray(backdrop.data) };
    legacyDraw(before, l);
    expect(Buffer.from(now.data).equals(Buffer.from(before.data))).toBe(false);
  });
});
