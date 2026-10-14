import { Page, expect, test } from "@playwright/test";
import { drawShape, editor, exportPngBytes, openApp, zoomTo } from "./helpers";

async function scene(page: Page) {
  await openApp(page);
  await page.getByTestId("start-blank").click();
  await page.getByTestId("canvas-width").fill("600");
  await page.getByTestId("canvas-height").fill("400");
  await page.getByTestId("canvas-create").click();
  await expect.poll(async () => (await editor(page)).screen).not.toBeNull();
  await zoomTo(page, 1, 300, 200);
  await drawShape(page, "사각형", { x: 100, y: 100 }, { x: 200, y: 160 });
  await drawShape(page, "원", { x: 150, y: 130 }, { x: 260, y: 220 });
  await expect.poll(async () => (await editor(page)).layers.length).toBe(2);
  const ids = (await editor(page)).layers.map((l) => l.id);
  await page.evaluate(([a, b]) => { const s = (window as any).__slc.getState(); s.setLayerContent(a, { fill: "#cc3333", stroke: null, strokeWidth: 0 }); s.setLayerContent(b, { fill: "#3366cc", stroke: null, strokeWidth: 0 }); s.setLayerOpacity(b, 0.6); }, ids);
  return ids;
}

/** the largest channel difference between two PNGs (decoded without colour management) */
const pixelDiff = (page: Page, a: Buffer, b: Buffer) =>
  page.evaluate(async ([s1, s2]) => {
    const dec = async (s: string) => {
      const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(s), (c) => c.charCodeAt(0))]), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
      const g = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d")!;
      g.drawImage(bmp, 0, 0);
      return g.getImageData(0, 0, bmp.width, bmp.height).data;
    };
    const p = await dec(s1), q = await dec(s2);
    let n = 0;
    for (let i = 0; i < p.length; i++) n = Math.max(n, Math.abs(p[i] - q[i]));
    return n;
  }, [a.toString("base64"), b.toString("base64")]);

test.describe("rasterize and merge", () => {
  test("rasterize turns a shape into an image with the same PNG; merge makes the PNG-identical single bitmap; Ctrl+E merges down; Ctrl+Shift+E all", async ({ page }) => {
    const [a, b] = await scene(page);
    const before = await exportPngBytes(page);
    await page.evaluate((i) => (window as any).__slc.getState().selectLayer(i), a);
    await page.getByTestId("rasterize").click();
    await expect.poll(async () => (await editor(page)).layers.find((l) => l.id === a)!.content).toBeUndefined();
    expect(await pixelDiff(page, before, await exportPngBytes(page))).toBeLessThanOrEqual(2); // merging blends in two steps: an anti-aliased edge can differ by a rounding
    await page.keyboard.press("Control+a");
    await page.getByTestId("merge-selected").click();
    await expect.poll(async () => (await editor(page)).layers.length).toBe(1);
    expect(await pixelDiff(page, before, await exportPngBytes(page))).toBeLessThanOrEqual(2); // merging blends in two steps: an anti-aliased edge can differ by a rounding
    await page.screenshot({ path: "test-results/merge.png" });
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await editor(page)).layers.length).toBe(2);
    await page.evaluate((i) => (window as any).__slc.getState().selectLayer(i), b);
    await page.keyboard.press("Control+e");
    await expect.poll(async () => (await editor(page)).layers.length).toBe(1);
    expect(await pixelDiff(page, before, await exportPngBytes(page))).toBeLessThanOrEqual(2); // merging blends in two steps: an anti-aliased edge can differ by a rounding
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+Shift+e");
    await expect.poll(async () => (await editor(page)).layers.length).toBe(1);
    expect(await pixelDiff(page, before, await exportPngBytes(page))).toBeLessThanOrEqual(2); // merging blends in two steps: an anti-aliased edge can differ by a rounding
  });
});