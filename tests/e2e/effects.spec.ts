import { Page, expect, test } from "@playwright/test";
import { clientOf, drawShape, editor, exportPngBytes, openApp, pngPixelAt, screenPixel, zoomTo } from "./helpers";

async function scene(page: Page) {
  await openApp(page);
  await page.getByTestId("start-blank").click();
  await page.getByTestId("canvas-width").fill("600");
  await page.getByTestId("canvas-height").fill("400");
  await page.getByTestId("canvas-color-text").fill("#d0d0d0");
  await page.getByTestId("canvas-create").click();
  await expect.poll(async () => (await editor(page)).screen).not.toBeNull();
  await zoomTo(page, 1, 300, 200);
  await drawShape(page, "사각형", { x: 100, y: 100 }, { x: 200, y: 160 });
  await expect.poll(async () => (await editor(page)).layers.length).toBe(1);
  const id = (await editor(page)).layers[0].id;
  await page.evaluate((i) => { const s = (window as any).__slc.getState(); s.setLayerContent(i, { fill: "#cc3333", stroke: null, strokeWidth: 0 }); s.selectLayer(i); }, id);
  return id;
}
const effects = (page: Page, id: string) => page.evaluate((i) => (window as any).__slc.getState().history.present.screens[0].layers.find((l: any) => l.id === i).effects as any, id);
const fill = async (page: Page, testId: string, v: string) => { await page.getByTestId(testId).fill(v); await page.getByTestId(testId).press("Enter"); };

for (const dpr of [1, 2]) {
  test.describe(`layer effects: screen equals PNG (device pixel ratio ${dpr})`, () => {
    test.use({ deviceScaleFactor: dpr });
    test("a shadow and an outline reach beyond the layer, and the canvas shows what the PNG has", async ({ page }) => {
      const id = await scene(page);
      await page.getByTestId("fx-panel").locator("summary").click();
      await page.getByTestId("fx-shadow-on").check();
      await expect.poll(async () => (await effects(page, id))?.shadow?.on).toBe(true);
      await fill(page, "fx-shadow-dx", "20");
      await fill(page, "fx-shadow-dy", "20");
      await fill(page, "fx-shadow-blur", "0");
      await fill(page, "fx-shadow-opacity", "100");
      await page.getByTestId("fx-stroke-on").check();
      await fill(page, "fx-stroke-width", "5");
      await expect.poll(async () => (await effects(page, id))?.shadow?.dx).toBe(20);
      await expect.poll(async () => (await effects(page, id))?.stroke?.width).toBe(5);
      await page.evaluate(() => (window as any).__slc.getState().selectLayer(null));
      const png = await exportPngBytes(page);
      // right of the layer (x 200..): the outline, then the shadow reaching further than the layer
      let beyond = 0;
      for (const [x, y] of [[202, 130], [215, 140], [218, 158], [195, 163], [100, 98], [150, 130], [230, 180]]) {
        const p = await pngPixelAt(page, png, x, y), s = await screenPixel(page, x, y);
        expect(Math.max(...p.map((v, i) => Math.abs(v - s[i]))), `(${x},${y}) png ${p} screen ${s}`).toBeLessThanOrEqual(1);
        if (x >= 200 || y >= 160) if (p[0] !== 0xd0 || p[1] !== 0xd0) beyond++;
      }
      expect(beyond).toBeGreaterThanOrEqual(3); // the effects really are outside the layer, and were not cut off
    });
  });
}

test.describe("layer effects", () => {
  test("one undo step per change; the layer still drags with its effect following; switching off keeps the values; the panel can be folded", async ({ page }) => {
    const id = await scene(page);
    const past = (await editor(page)).past;
    await page.getByTestId("fx-panel").locator("summary").click();
    await page.getByTestId("fx-overlay-on").check();
    await expect.poll(async () => (await effects(page, id))?.overlay?.on).toBe(true);
    expect((await editor(page)).past).toBe(past + 1);
    await page.getByTestId("fx-overlay-on").uncheck();
    await expect.poll(async () => (await effects(page, id))?.overlay?.on).toBe(false);
    expect((await effects(page, id)).overlay.opacity).toBe(0.5); // the values stay
    await page.getByTestId("fx-overlay-on").check();
    await page.getByTestId("fx-shadow-on").check();
    await expect.poll(async () => (await effects(page, id))?.shadow?.on).toBe(true);
    // drag the layer: the layer node still takes the drag
    const a = await clientOf(page, 150, 130), b = await clientOf(page, 250, 230);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await editor(page)).layers[0].transform.x).toBe(200);
    await page.evaluate(() => (window as any).__slc.getState().selectLayer(null));
    const png = await exportPngBytes(page);
    const s = await screenPixel(page, 250, 230), p = await pngPixelAt(page, png, 250, 230);
    expect(Math.max(...p.map((v, i) => Math.abs(v - s[i])))).toBeLessThanOrEqual(1);
    await page.screenshot({ path: "test-results/effects.png" });
    await page.keyboard.press("Control+z"); // the drag
    await page.keyboard.press("Control+z"); // the shadow
    await expect.poll(async () => (await effects(page, id))?.shadow).toBeUndefined();
    await page.evaluate((i) => (window as any).__slc.getState().selectLayer(i), id);
    await page.getByTestId("fx-clear").click();
    await expect.poll(async () => await effects(page, id)).toBeUndefined();
  });

  test("a locked layer and comparing cannot take effects", async ({ page }) => {
    const id = await scene(page);
    await page.evaluate((i) => (window as any).__slc.getState().setLayerLocked(i, true), id);
    await expect(page.getByTestId("fx-shadow-on")).toBeDisabled();
    await page.evaluate((i) => (window as any).__slc.getState().setLayerLocked(i, false), id);
    await page.evaluate(() => (window as any).__slc.getState().setCompareMode("original"));
    const ok = await page.evaluate((i) => (window as any).__slc.getState().setLayerEffects(i, { shadow: { on: true, color: "#000000", dx: 1, dy: 1, blur: 0, opacity: 1 } }), id);
    expect(ok).toBe(false);
  });
});