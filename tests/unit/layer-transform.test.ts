import { describe, expect, test } from "vitest";
import { LayerTransform, MAX_SCALE, MIN_SCALE, cosSin, frameToLayerPoint, isOnlyMoved, layerBounds, layerCorners, layerPointToFrame, normalizeRotation, sanitizeTransform, scaledSize } from "@/lib/geometry/layer-transform";

const t = (over: Partial<LayerTransform> = {}): LayerTransform => ({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, ...over });
const near = (a: { x: number; y: number }, b: { x: number; y: number }, digits = 9) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};

describe("layerPointToFrame", () => {
  test("a layer that is only moved: just the offset", () => {
    expect(layerPointToFrame(t({ x: 10, y: 20 }), { x: 5, y: 7 })).toEqual({ x: 15, y: 27 });
  });
  test("scale grows distances from the top-left corner, which stays where it is", () => {
    const m = t({ x: 10, y: 20, scaleX: 2, scaleY: 3 });
    expect(layerPointToFrame(m, { x: 0, y: 0 })).toEqual({ x: 10, y: 20 });
    expect(layerPointToFrame(m, { x: 5, y: 7 })).toEqual({ x: 20, y: 41 });
  });
  test("a quarter turn clockwise about the top-left: right becomes down, down becomes left", () => {
    const m = t({ x: 100, y: 50, rotation: 90 });
    expect(layerPointToFrame(m, { x: 10, y: 0 })).toEqual({ x: 100, y: 60 });
    expect(layerPointToFrame(m, { x: 0, y: 10 })).toEqual({ x: 90, y: 50 });
  });
  test("a half turn", () => {
    expect(layerPointToFrame(t({ x: 100, y: 50, rotation: 180 }), { x: 10, y: 4 })).toEqual({ x: 90, y: 46 });
  });
  test("45° moves a point along the diagonal", () => {
    near(layerPointToFrame(t({ rotation: 45 }), { x: 10, y: 0 }), { x: 10 * Math.SQRT1_2, y: 10 * Math.SQRT1_2 });
  });
  test("scale is applied before rotation", () => {
    // 2x wide, then a quarter turn: a point 5 right of the origin ends up 10 below it
    expect(layerPointToFrame(t({ scaleX: 2, rotation: 90 }), { x: 5, y: 0 })).toEqual({ x: 0, y: 10 });
  });
});

describe("frameToLayerPoint is the inverse", () => {
  test.each([
    [t()],
    [t({ x: 12.5, y: -3 })],
    [t({ scaleX: 2, scaleY: 0.5 })],
    [t({ x: 40, y: 30, rotation: 90 })],
    [t({ x: 40, y: 30, rotation: 37, scaleX: 1.7, scaleY: 0.6 })],
    [t({ x: -5, y: 8, rotation: -122.5, scaleX: 3, scaleY: 3 })],
    [t({ rotation: 180, scaleX: -1 })],
  ])("round trip for %j", (m) => {
    for (const p of [{ x: 0, y: 0 }, { x: 17, y: 3 }, { x: 240, y: 120 }, { x: -4, y: 9.5 }]) near(frameToLayerPoint(m, layerPointToFrame(m, p)), p, 7);
  });
});

describe("corners and bounds", () => {
  test("an unrotated layer: the corners are the scaled rectangle", () => {
    expect(layerCorners(t({ x: 10, y: 20, scaleX: 2, scaleY: 2 }), 30, 10)).toEqual([{ x: 10, y: 20 }, { x: 70, y: 20 }, { x: 70, y: 40 }, { x: 10, y: 40 }]);
  });
  test("a quarter turn swaps width and height and swings the body to the left of its origin", () => {
    expect(layerBounds(t({ x: 100, y: 50, rotation: 90 }), 30, 10)).toEqual({ x: 90, y: 50, width: 10, height: 30 });
  });
  test("45° makes the bounding box wider than the layer", () => {
    const b = layerBounds(t({ rotation: 45 }), 100, 100);
    expect(b.width).toBeCloseTo(100 * Math.SQRT2, 9);
    expect(b.height).toBeCloseTo(100 * Math.SQRT2, 9);
  });
  test("scaledSize ignores rotation and the sign of the scale", () => {
    expect(scaledSize(t({ scaleX: -2, scaleY: 0.5, rotation: 33 }), 40, 20)).toEqual({ width: 80, height: 10 });
  });
});

describe("cosSin, normalizeRotation", () => {
  test("multiples of 90° are exact, not 6e-17 off", () => {
    expect(cosSin(90)).toEqual({ cos: 0, sin: 1 });
    expect(cosSin(-90)).toEqual({ cos: 0, sin: -1 });
    expect(cosSin(180)).toEqual({ cos: -1, sin: 0 });
    expect(cosSin(270)).toEqual({ cos: 0, sin: -1 });
    expect(cosSin(720)).toEqual({ cos: 1, sin: 0 });
    expect(cosSin(0)).toEqual({ cos: 1, sin: 0 });
  });
  test.each([[0, 0], [180, 180], [-180, 180], [190, -170], [-190, 170], [540, 180], [360, 0], [-720.5, -0.5], [45, 45]])("%f° → %f°", (input, expected) => {
    expect(normalizeRotation(input)).toBeCloseTo(expected, 9);
  });
});

describe("sanitizeTransform", () => {
  test("rounds to a precision nobody sees", () => {
    expect(sanitizeTransform(t({ x: 10.123456, y: 20.987654, scaleX: 1.234567, scaleY: 0.987654, rotation: 33.33333 }))).toEqual({ x: 10.12, y: 20.99, scaleX: 1.2346, scaleY: 0.9877, rotation: 33.33 });
  });
  test("keeps scale within limits and never lets it reach 0", () => {
    const s = sanitizeTransform(t({ scaleX: 0, scaleY: 9999 }))!;
    expect(s.scaleX).toBe(MIN_SCALE);
    expect(s.scaleY).toBe(MAX_SCALE);
    expect(sanitizeTransform(t({ scaleX: 0.0001 }))!.scaleX).toBe(MIN_SCALE);
  });
  test("a mirrored scale keeps its sign", () => {
    expect(sanitizeTransform(t({ scaleX: -2 }))!.scaleX).toBe(-2);
  });
  test("rotation comes back into (-180, 180]", () => {
    expect(sanitizeTransform(t({ rotation: 450 }))!.rotation).toBe(90);
  });
  test("NaN and Infinity are refused", () => {
    expect(sanitizeTransform(t({ x: NaN }))).toBeNull();
    expect(sanitizeTransform(t({ rotation: Infinity }))).toBeNull();
  });
  test("no negative zero", () => {
    expect(Object.is(sanitizeTransform(t({ x: -0.001, y: 0 }))!.x, 0)).toBe(true);
  });
});

test("isOnlyMoved", () => {
  expect(isOnlyMoved(t({ x: 5 }))).toBe(true);
  expect(isOnlyMoved(t({ scaleX: 1.0001 }))).toBe(false);
  expect(isOnlyMoved(t({ rotation: 0.01 }))).toBe(false);
});
