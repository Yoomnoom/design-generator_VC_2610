import { expect, test, Page } from "@playwright/test";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";

/* Runs src/lib/image/canvas-codec.ts as-is in a real Chromium. The unit tests cannot: it needs createImageBitmap/OffscreenCanvas. */

const source = fs.readFileSync("src/lib/image/canvas-codec.ts", "utf8");
// Node strips the types; the only import is type-only, and the one export becomes a global the page can call
const codecJs = stripTypeScriptTypes(source).replace(/^import .*$/gm, "").replace("export const canvasCodec", "window.codec");

async function loadCodec(page: Page) {
  await page.goto("about:blank");
  await page.addScriptTag({
    content: `
      ${codecJs}
      /* a w×h JPEG: blue, with a red top-left quadrant, tagged with an EXIF orientation */
      window.makeJpeg = async (w, h, orientation) => {
        const c = new OffscreenCanvas(w, h), g = c.getContext("2d");
        g.fillStyle = "#0000ff"; g.fillRect(0, 0, w, h);
        g.fillStyle = "#ff0000"; g.fillRect(0, 0, w / 2, h / 2);
        const jpeg = new Uint8Array(await (await c.convertToBlob({ type: "image/jpeg", quality: 1 })).arrayBuffer());
        const exif = [0x45,0x78,0x69,0x66,0,0, 0x4d,0x4d,0,0x2a,0,0,0,8, 0,1, 0x01,0x12,0,3,0,0,0,1,0,orientation,0,0, 0,0,0,0];
        const len = exif.length + 2;
        const segment = new Uint8Array([0xff, 0xe1, len >> 8, len & 255, ...exif]);
        return new Blob([jpeg.slice(0, 2), segment, jpeg.slice(2)], { type: "image/jpeg" });
      };
    `,
  });
}

test.describe("canvasCodec in Chromium", () => {
  test("encode produces a real PNG whose header size matches the pixels", async ({ page }) => {
    await loadCodec(page);
    const info = await page.evaluate(async () => {
      const out: Record<string, unknown> = {};
      for (const [w, h] of [[1, 1], [37, 23], [1920, 1080]]) {
        const data = new Uint8ClampedArray(w * h * 4).fill(255);
        const blob: Blob = await (window as any).codec.encode({ width: w, height: h, data });
        const b = new Uint8Array(await blob.arrayBuffer());
        const view = new DataView(b.buffer);
        out[`${w}x${h}`] = { type: blob.type, signature: Array.from(b.slice(0, 8)), ihdr: [view.getUint32(16), view.getUint32(20)] };
      }
      return out;
    });
    for (const [size, v] of Object.entries(info as Record<string, any>)) {
      const [w, h] = size.split("x").map(Number);
      expect(v.type).toBe("image/png");
      expect(v.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(v.ihdr).toEqual([w, h]);
    }
  });

  test("alpha survives encode → decode; sizes round-trip exactly", async ({ page }) => {
    await loadCodec(page);
    const r = await page.evaluate(async () => {
      const px = [10, 20, 30, 255, /**/ 200, 100, 50, 128, /**/ 0, 0, 0, 0, /**/ 255, 255, 255, 1];
      const raw = { width: 4, height: 1, data: new Uint8ClampedArray(px) };
      const back = await (window as any).codec.decode(await (window as any).codec.encode(raw));
      return { width: back.width, height: back.height, data: Array.from(back.data as Uint8ClampedArray), sent: px };
    });
    expect([r.width, r.height]).toEqual([4, 1]);
    const alphas = [3, 7, 11, 15].map((i) => r.data[i]);
    console.log("alpha sent", [255, 128, 0, 1], "alpha got", alphas, "semi-transparent rgb sent [200,100,50] got", r.data.slice(4, 7));
    expect(r.data.slice(0, 4)).toEqual([10, 20, 30, 255]); // opaque: exact
    expect(alphas[1]).toBe(128); // semi-transparent alpha: exact
    expect(alphas[2]).toBe(0); // fully transparent stays transparent
    for (let k = 0; k < 3; k++) expect(Math.abs(r.data[4 + k] - [200, 100, 50][k])).toBeLessThanOrEqual(2); // premultiplication rounding
  });

  test("a large image keeps its exact size through the codec", async ({ page }) => {
    await loadCodec(page);
    const size = await page.evaluate(async () => {
      const raw = { width: 1920, height: 1080, data: new Uint8ClampedArray(1920 * 1080 * 4).fill(200) };
      const back = await (window as any).codec.decode(await (window as any).codec.encode(raw));
      return [back.width, back.height, back.data.length];
    });
    expect(size).toEqual([1920, 1080, 1920 * 1080 * 4]);
  });

  for (const [orientation, expected] of [[1, [40, 20]], [3, [40, 20]], [6, [20, 40]], [8, [20, 40]]] as const) {
    test(`EXIF orientation ${orientation}: a 40×20 file decodes as ${expected.join("×")}`, async ({ page }) => {
      await loadCodec(page);
      const r = await page.evaluate(async (o) => {
        const blob = await (window as any).makeJpeg(40, 20, o);
        const back = await (window as any).codec.decode(blob);
        const at = (x: number, y: number) => Array.from((back.data as Uint8ClampedArray).slice((y * back.width + x) * 4, (y * back.width + x) * 4 + 3));
        return { w: back.width, h: back.height, topLeft: at(1, 1), topRight: at(back.width - 2, 1), bottomLeft: at(1, back.height - 2), bottomRight: at(back.width - 2, back.height - 2) };
      }, orientation);
      console.log(`orientation ${orientation}:`, `${r.w}×${r.h}`, "red corner is at", ["topLeft", "topRight", "bottomLeft", "bottomRight"].find((k) => (r as any)[k][0] > 200 && (r as any)[k][2] < 60));
      expect([r.w, r.h]).toEqual(expected);
    });
  }

  test("EXIF 6 is really rotated, not just re-measured: the red quadrant moves from top-left to top-right", async ({ page }) => {
    await loadCodec(page);
    const r = await page.evaluate(async () => {
      const back = await (window as any).codec.decode(await (window as any).makeJpeg(40, 20, 6));
      const at = (x: number, y: number) => Array.from((back.data as Uint8ClampedArray).slice((y * back.width + x) * 4, (y * back.width + x) * 4 + 3));
      return { topRight: at(back.width - 2, 1), topLeft: at(1, 1) };
    });
    expect(r.topRight[0]).toBeGreaterThan(200);
    expect(r.topRight[2]).toBeLessThan(60);
    expect(r.topLeft[2]).toBeGreaterThan(200);
  });
});
