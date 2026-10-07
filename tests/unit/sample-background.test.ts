import { describe, expect, test } from "vitest";
import { sampleBackground } from "@/lib/image/sample-background";
import { setPixel, solid } from "./helpers";

const center = { x: 5, y: 5, width: 10, height: 10 };

describe("sampleBackground", () => {
  test("a flat background gives that colour", () => {
    const r = sampleBackground(solid(20, 20, [200, 100, 50, 255]), center);
    expect(r).toMatchObject({ status: "ok", hex: "#c86432", method: "mode", outlierRatio: 0 });
  });

  test("samples outside the selection, never inside it", () => {
    const img = solid(20, 20, [200, 100, 50, 255]);
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) setPixel(img, x, y, [0, 255, 0, 255]);
    expect(sampleBackground(img, center).hex).toBe("#c86432");
  });

  test("slight noise within tolerance is still ok", () => {
    const img = solid(20, 20, [200, 100, 50, 255]);
    for (let x = 2; x < 18; x += 2) setPixel(img, x, 3, [205, 104, 47, 255]);
    expect(sampleBackground(img, center).status).toBe("ok");
  });

  test("ring width is 3px by default and clamped to 1–5", () => {
    const img = solid(20, 20, [1, 2, 3, 255]);
    expect(sampleBackground(img, center).sampleCount).toBe(156);
    expect(sampleBackground(img, center, 99).sampleCount).toBe(300);
    expect(sampleBackground(img, center, 0).sampleCount).toBe(10 * 2 + 12 * 2); // ring of 1px
  });

  test("a selection on the image edge samples only the sides that exist", () => {
    const r = sampleBackground(solid(20, 20, [9, 9, 9, 255]), { x: 0, y: 0, width: 10, height: 10 });
    expect(r).toMatchObject({ status: "ok", sampleCount: 69 });
  });

  test("two very different colours around the selection → ask the user, with a best guess", () => {
    const img = solid(20, 20, [255, 0, 0, 255]);
    for (let y = 0; y < 20; y++) for (let x = 10; x < 20; x++) setPixel(img, x, y, [0, 0, 255, 255]);
    const r = sampleBackground(img, center);
    expect(r.status).toBe("needs-user-color");
    expect(r.outlierRatio).toBeCloseTo(0.5, 9);
    expect(r.color).not.toBeNull();
  });

  test("when no colour dominates the median is used, and a gradient needs the user", () => {
    const img = solid(20, 20, [0, 0, 0, 255]);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) setPixel(img, x, y, [y * 10, y * 10, y * 10, 255]);
    const r = sampleBackground(img, center);
    expect(r.method).toBe("median");
    expect(r.status).toBe("needs-user-color");
  });

  test("a selection covering the whole image leaves nothing to sample", () => {
    const r = sampleBackground(solid(20, 20, [1, 1, 1, 255]), { x: 0, y: 0, width: 20, height: 20 });
    expect(r).toMatchObject({ status: "needs-user-color", color: null, hex: null, sampleCount: 0 });
  });
});
