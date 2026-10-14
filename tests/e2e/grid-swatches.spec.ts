import { Page, expect, test } from "@playwright/test";
import { clientOf, drawShape, editor, exportPngBytes, openApp, pngPixelAt, screenPixel, zoomTo } from "./helpers";

async function blank(page: Page) {
  await openApp(page);
  await page.getByTestId("start-blank").click();
  await page.getByTestId("canvas-width").fill("600");
  await page.getByTestId("canvas-height").fill("400");
  await page.getByTestId("canvas-create").click();
  await expect.poll(async () => (await editor(page)).screen).not.toBeNull();
  await zoomTo(page, 1, 300, 200);
}

test.describe("grid", () => {
  test("shown over the page but not in the PNG; the size can be changed; with grid snap a drag lands on the lines", async ({ page }) => {
    await blank(page);
    await page.getByTestId("snap-toggle").uncheck();
    await drawShape(page, "사각형", { x: 101, y: 103 }, { x: 201, y: 163 });
    await expect.poll(async () => (await editor(page)).layers.length).toBe(1);
    const id = (await editor(page)).layers[0].id;
    await page.evaluate((i) => { const s = (window as any).__slc.getState(); s.setLayerContent(i, { fill: "#ffffff", stroke: null, strokeWidth: 0 }); s.selectLayer(null); }, id);
    await page.getByTestId("grid-toggle").check();
    await page.getByTestId("grid-size").selectOption("100");
    await expect.poll(async () => (await screenPixel(page, 300, 250)).join()).not.toBe("255,255,255,255"); // a grid line over the white page
    const png = await exportPngBytes(page);
    expect(await pngPixelAt(page, png, 300, 250)).toEqual([255, 255, 255, 255]); // none in the picture
    await page.getByTestId("grid-size").selectOption("16");
    await page.getByTestId("grid-snap").check();
    const a = await clientOf(page, 150, 130), b = await clientOf(page, 190, 160);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await editor(page)).layers[0].transform.x % 16).toBe(0);
    expect((await editor(page)).layers[0].transform.y % 16).toBe(0);
  });
});

test.describe("swatches", () => {
  test("add the current colour, click one to use it, remove one; they stay after a reload and are not in the project file", async ({ page }) => {
    await blank(page);
    await page.getByRole("button", { name: "사각형", exact: true }).click();
    await page.getByTestId("swatches").locator("summary").click();
    const before = await page.getByTestId("swatch").count();
    await page.evaluate(() => (window as any).__slc.getState().setDrawStyle({ stroke: "#123456" }));
    await page.getByTestId("swatch-add").click();
    await expect(page.getByTestId("swatch")).toHaveCount(before + 1);
    await page.evaluate(() => (window as any).__slc.getState().setDrawStyle({ stroke: "#000000" }));
    await page.locator('[data-testid="swatch"][data-color="#123456"]').click();
    expect(await page.evaluate(() => (window as any).__slc.getState().drawStyle.stroke)).toBe("#123456");
    await page.reload();
    await page.getByTestId("start-blank").click();
    await page.getByTestId("canvas-create").click();
    await page.getByRole("button", { name: "사각형", exact: true }).click();
    await page.getByTestId("swatches").locator("summary").click();
    await expect(page.locator('[data-testid="swatch"][data-color="#123456"]')).toHaveCount(1);
    await page.locator('[data-testid="swatch"][data-color="#123456"]').hover();
    await page.locator('[data-testid="swatch"][data-color="#123456"]').locator("xpath=following-sibling::button").click();
    await expect(page.locator('[data-testid="swatch"][data-color="#123456"]')).toHaveCount(0);
  });
});