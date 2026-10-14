import { Page, expect, test } from "@playwright/test";
import { editor, exportPngBytes, openApp, pngPixelAt, screenPixel } from "./helpers";

/* A warped layer that covers more than ~1.5 million pixels is drawn in two stages on screen (a coarse picture at once, the real one from a
 * Web Worker). Once the real one has arrived the canvas must show what the PNG has, to within 1 per channel. */

async function scene(page: Page) {
  await openApp(page);
  await page.getByTestId("start-blank").click();
  await page.getByTestId("canvas-width").fill("2000");
  await page.getByTestId("canvas-height").fill("1300");
  await page.getByTestId("canvas-color-text").fill("#d0d0d0");
  await page.getByTestId("canvas-create").click();
  await expect.poll(async () => (await editor(page)).screen).not.toBeNull();
  return page.evaluate(() => {
    const w = 1600, h = 1000;
    const raw = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; raw.data[o] = (x * 255) / w; raw.data[o + 1] = (y * 255) / h; raw.data[o + 2] = ((x + y) % 64) * 4; raw.data[o + 3] = 255; }
    const s = (window as any).__slc.getState();
    const id = s.addImageLayer({ raw, name: "big" });
    s.transformLayer(id, { x: 100, y: 100, scaleX: 1, scaleY: 1, rotation: 0 });
    s.setLayerWarp(id, { kind: "quad", points: [{ x: 0, y: 0 }, { x: 1600, y: 40 }, { x: 1560, y: 1000 }, { x: 20, y: 960 }] });
    s.selectLayer(null);
    return id as string;
  });
}

for (const dpr of [1, 2]) {
  test.describe(`staged warp render (device pixel ratio ${dpr})`, () => {
    test.use({ deviceScaleFactor: dpr });
    test("the real picture from the worker equals the PNG", async ({ page }) => {
      await scene(page);
      const spots = [[400, 300], [900, 600], [1300, 800], [300, 900], [1500, 300]];
      const png = await exportPngBytes(page);
      for (const [x, y] of spots) {
        await page.evaluate(([cx, cy]) => {
          const st = (window as any).__slc.getState();
          const box = document.querySelector('[data-testid="viewport"]')!.getBoundingClientRect();
          const s = st.history.present.screens[0];
          st.setView({ zoom: 1, panX: Math.round(box.width / 2 - (s.x + cx)), panY: Math.round(box.height / 2 - (s.y + cy)) });
        }, [x, y]);
        const p = await pngPixelAt(page, png, x, y);
        // coarse first, real later: wait for the real one (within 1 of the PNG), but fail with the numbers if it never comes
        await expect.poll(async () => { const s = await screenPixel(page, x, y); return Math.max(...p.map((v, i) => Math.abs(v - s[i]))); }, { timeout: 15000, message: `(${x},${y}) png ${p}` }).toBeLessThanOrEqual(1);
      }
    });
  });
}