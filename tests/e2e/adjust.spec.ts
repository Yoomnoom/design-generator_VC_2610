import { Page, expect, test } from "@playwright/test";
import { editor, exportPngBytes, openApp, pngPixelAt, screenPixel, zoomTo } from "./helpers";

async function scene(page: Page) {
  await openApp(page);
  await page.getByTestId("start-blank").click();
  await page.getByTestId("canvas-width").fill("600");
  await page.getByTestId("canvas-height").fill("400");
  await page.getByTestId("canvas-color-text").fill("#d0d0d0");
  await page.getByTestId("canvas-create").click();
  await expect.poll(async () => (await editor(page)).screen).not.toBeNull();
  await zoomTo(page, 1, 300, 200);
  const id = await page.evaluate(() => {
    const raw = { width: 100, height: 60, data: new Uint8ClampedArray(100 * 60 * 4) };
    for (let i = 0; i < raw.data.length; i += 4) { raw.data[i] = 100; raw.data[i + 1] = 50; raw.data[i + 2] = 50; raw.data[i + 3] = 255; }
    const s = (window as any).__slc.getState();
    const id = s.addImageLayer({ raw, name: "bm" });
    s.selectLayer(id);
    return id as string;
  });
  return id;
}
const adjust = (page: Page, id: string) => page.evaluate((i) => (window as any).__slc.getState().history.present.screens[0].layers.find((l: any) => l.id === i).adjust as any, id);
const box = (page: Page, id: string) => page.evaluate((i) => (window as any).__slc.getState().history.present.screens[0].layers.find((l: any) => l.id === i).transform as { x: number; y: number }, id);

for (const dpr of [1, 2]) {
  test.describe(`image adjustments (device pixel ratio ${dpr})`, () => {
    test.use({ deviceScaleFactor: dpr });
    test("dragging a slider writes no history until it is let go, then one step; the canvas shows what the PNG has", async ({ page }) => {
      const id = await scene(page);
      const past = (await editor(page)).past;
      await page.getByTestId("adjust-panel").locator("summary").click();
      const slider = page.getByTestId("adj-brightness");
      const b = (await slider.boundingBox())!;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width * 0.85, b.y + b.height / 2, { steps: 5 });
      await expect.poll(() => page.evaluate(() => (window as any).__slc.getState().adjustPreview?.adjust?.brightness ?? 0)).toBeGreaterThan(0);
      expect((await editor(page)).past).toBe(past); // a preview only
      expect(await adjust(page, id)).toBeUndefined();
      await page.mouse.up();
      await expect.poll(async () => (await adjust(page, id))?.brightness).toBeGreaterThan(0);
      expect((await editor(page)).past).toBe(past + 1);
      await page.evaluate(() => (window as any).__slc.getState().selectLayer(null));
      const t = await box(page, id);
      const png = await exportPngBytes(page);
      const p = await pngPixelAt(page, png, t.x + 10, t.y + 10), s = await screenPixel(page, t.x + 10, t.y + 10);
      expect(p[0]).toBeGreaterThan(110);
      expect(Math.max(...p.map((v, i) => Math.abs(v - s[i])))).toBeLessThanOrEqual(1);
    });
  });
}

test.describe("image adjustments", () => {
  test("clear-all is one step; undo brings the values back", async ({ page }) => {
    const id = await scene(page);
    await page.evaluate((i) => (window as any).__slc.getState().setLayerAdjust(i, { brightness: 0, contrast: 0, saturation: -100, hue: 0, blur: 0, sharpen: 0 }), id);
    await expect.poll(async () => (await adjust(page, id))?.saturation).toBe(-100);
    await page.screenshot({ path: "test-results/adjust-panel.png" });
    const past = (await editor(page)).past;
    await page.getByTestId("adj-reset").click();
    await expect.poll(async () => await adjust(page, id)).toBeUndefined();
    expect((await editor(page)).past).toBe(past + 1);
    await page.evaluate(() => (window as any).__slc.getState().undo());
    await expect.poll(async () => (await adjust(page, id))?.saturation).toBe(-100);
  });
});