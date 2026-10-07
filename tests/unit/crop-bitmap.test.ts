import { describe, expect, test } from "vitest";
import { cropRaw } from "@/lib/image/crop-bitmap";
import { createRawImage } from "@/lib/image/raw-image";
import { getPixel, setPixel } from "./helpers";

// 4×3 image where each pixel's red channel encodes its position
const source = () => {
  const img = createRawImage(4, 3);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) setPixel(img, x, y, [y * 4 + x, 0, 0, 255]);
  return img;
};

describe("cropRaw", () => {
  test("result is exactly the selection size", () => {
    const c = cropRaw(source(), { x: 1, y: 1, width: 2, height: 2 });
    expect([c.width, c.height, c.data.length]).toEqual([2, 2, 16]);
  });
  test("copies the right pixels", () => {
    const c = cropRaw(source(), { x: 1, y: 1, width: 2, height: 2 });
    expect([getPixel(c, 0, 0)[0], getPixel(c, 1, 0)[0], getPixel(c, 0, 1)[0], getPixel(c, 1, 1)[0]]).toEqual([5, 6, 9, 10]);
  });
  test("keeps the alpha channel as it is", () => {
    const img = source();
    setPixel(img, 2, 1, [10, 20, 30, 0]);
    setPixel(img, 3, 1, [10, 20, 30, 77]);
    const c = cropRaw(img, { x: 2, y: 1, width: 2, height: 1 });
    expect(getPixel(c, 0, 0)).toEqual([10, 20, 30, 0]);
    expect(getPixel(c, 1, 0)).toEqual([10, 20, 30, 77]);
  });
  test("does not modify the source", () => {
    const img = source();
    const before = Array.from(img.data);
    cropRaw(img, { x: 0, y: 0, width: 4, height: 3 });
    expect(Array.from(img.data)).toEqual(before);
  });
  test("the whole image is a valid crop", () => {
    expect(cropRaw(source(), { x: 0, y: 0, width: 4, height: 3 }).data).toEqual(source().data);
  });
  test.each([
    [{ x: 3, y: 0, width: 2, height: 1 }],
    [{ x: -1, y: 0, width: 2, height: 1 }],
    [{ x: 0, y: 0, width: 0, height: 1 }],
    [{ x: 0.5, y: 0, width: 1, height: 1 }],
  ])("rejects %j", (rect) => {
    expect(() => cropRaw(source(), rect)).toThrow(RangeError);
  });
});
