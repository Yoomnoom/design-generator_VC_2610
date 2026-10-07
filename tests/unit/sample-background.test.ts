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

describe("near ring versus far ring (synthetic)", () => {
  const BG: [number, number, number, number] = [200, 200, 200, 255];
  const rect = { x: 40, y: 40, width: 20, height: 20 };
  const frame = (img: ReturnType<typeof solid>, from: number, to: number, c: [number, number, number, number]) => {
    // paint everything between `from` and `to` pixels outside the rect
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const d = Math.max(rect.x - x, x - (rect.x + rect.width - 1), rect.y - y, y - (rect.y + rect.height - 1));
        if (d > from && d <= to) setPixel(img, x, y, c);
      }
  };

  test("a shadow-like frame hugging the selection: the near ring looks fine alone, but disagrees with the far ring, so the user is asked", () => {
    const img = solid(100, 100, BG);
    frame(img, 0, 6, [170, 170, 170, 255]);
    const r = sampleBackground(img, rect);
    expect(r).toMatchObject({ status: "needs-user-color", reason: "near-far-mismatch", hex: "#aaaaaa", farHex: "#c8c8c8", nearFarDistance: 30 });
  });

  test("the picker then starts from the plain background outside it, not from the shadow", () => {
    const img = solid(100, 100, BG);
    frame(img, 0, 6, [170, 170, 170, 255]);
    expect(sampleBackground(img, rect).suggestedHex).toBe("#c8c8c8");
  });

  test("a small difference between the rings is not a shadow: it still fills automatically", () => {
    const img = solid(100, 100, BG);
    frame(img, 0, 6, [194, 194, 194, 255]); // 6 levels, under the 8-level tolerance
    expect(sampleBackground(img, rect)).toMatchObject({ status: "ok", nearFarDistance: 6 });
  });

  test("a far ring that is itself a mix (it crosses another element) is ignored, not used to reject the fill", () => {
    const img = solid(100, 100, BG);
    frame(img, 0, 6, [255, 255, 255, 255]); // a white card around the selection...
    frame(img, 14, 20, [0, 0, 0, 255]); // ...and its far ring is half black, half the page
    for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) if (x < 50 && Math.max(rect.x - x, x - (rect.x + rect.width - 1), rect.y - y, y - (rect.y + rect.height - 1)) > 12 && Math.max(rect.x - x, x - (rect.x + rect.width - 1), rect.y - y, y - (rect.y + rect.height - 1)) <= 24) setPixel(img, x, y, [0, 0, 0, 255]);
    const r = sampleBackground(img, rect);
    expect(r.status).toBe("ok");
    expect(r.farHex).toBeNull();
  });

  test("with no room for a far ring (a selection against the image edge) only the near ring decides", () => {
    const img = solid(40, 40, BG);
    const r = sampleBackground(img, { x: 10, y: 10, width: 20, height: 20 });
    expect(r).toMatchObject({ status: "ok", farHex: null, nearFarDistance: null });
  });

  test("the suggestion falls back to the near ring's colour when the image is too small for anything further out", () => {
    expect(sampleBackground(solid(40, 40, BG), { x: 10, y: 10, width: 20, height: 20 }).suggestedHex).toBe("#c8c8c8");
  });

  test("the suggestion skips an outer band that is a mix and takes the nearest one-colour band", () => {
    const img = solid(160, 160, BG);
    const r2 = { x: 60, y: 60, width: 20, height: 20 };
    for (let y = 0; y < 160; y++)
      for (let x = 0; x < 160; x++) {
        const d = Math.max(r2.x - x, x - (r2.x + r2.width - 1), r2.y - y, y - (r2.y + r2.height - 1));
        if (d > 32 && d <= 48 && (x + y) % 2 === 0) setPixel(img, x, y, [30, 30, 30, 255]); // the outer band is a checker of two colours
      }
    expect(sampleBackground(img, r2).suggestedHex).toBe("#c8c8c8"); // taken from the far ring instead
  });
});
