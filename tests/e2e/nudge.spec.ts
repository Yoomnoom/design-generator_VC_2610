import { Page, expect, test } from "@playwright/test";
import {
  BLUE, CARD, autosaveReady, drawStyleOf, editor, exportPngBytes, firstLayer, openApp, openProjectFile, pageWithCard, pickTool, pngPixelAt, reloadAndDiscard, saveProjectFile, uploadPng, waitForAutosave, zoomTo, dragImageRect,
} from "./helpers";

/** the card (300..540 × 200..320) sits in the middle of the canvas window when image point (420, 260) is centred */
const AT = { x: 420, y: 260 };

async function withCardLayer(page: Page, zoom = 1) {
  await openApp(page);
  await uploadPng(page, pageWithCard());
  await zoomTo(page, zoom, AT.x, AT.y);
  await pickTool(page, "영역 추출");
  await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
  await expect.poll(async () => (await editor(page)).layers.length).toBe(1);
  await pickTool(page, "선택");
  await expect.poll(async () => (await editor(page)).selected.length).toBe(1);
  return (await firstLayer(page)).transform;
}
/** the first layer's [x, y], or null while no project is loaded (so a poll can wait through an open or a restore) */
const where = (page: Page) =>
  page.evaluate(() => {
    const l = (window as any).__slc.getState().history?.present.screens[0].layers[0];
    return l ? [l.transform.x, l.transform.y] : null;
  });
test.describe("moving a layer with the arrow keys", () => {
  test("an arrow key moves the selected layer 1 px and Shift+arrow moves it 10 px, in image pixels", async ({ page }) => {
    const t0 = await withCardLayer(page);
    await page.keyboard.press("ArrowRight");
    expect(await where(page)).toEqual([t0.x + 1, t0.y]);
    await page.keyboard.press("ArrowDown");
    expect(await where(page)).toEqual([t0.x + 1, t0.y + 1]);
    await page.keyboard.press("Shift+ArrowLeft");
    expect(await where(page)).toEqual([t0.x - 9, t0.y + 1]);
    await page.keyboard.press("Shift+ArrowUp");
    expect(await where(page)).toEqual([t0.x - 9, t0.y - 9]);
  });

  test("at 200% zoom a key press is still exactly 1 image pixel (the step does not depend on the zoom)", async ({ page }) => {
    const t0 = await withCardLayer(page, 2);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    expect(await where(page)).toEqual([t0.x + 1, t0.y + 1]);
  });

  test("a burst of presses is one undo step; one undo puts the layer back, one redo moves it again", async ({ page }) => {
    const t0 = await withCardLayer(page);
    const past = (await editor(page)).past;
    for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
    expect(await where(page)).toEqual([t0.x + 50, t0.y + 3]);
    expect((await editor(page)).past).toBe(past + 1);
    await page.keyboard.press("Control+z");
    expect(await where(page)).toEqual([t0.x, t0.y]);
    await page.keyboard.press("Control+Shift+z");
    expect(await where(page)).toEqual([t0.x + 50, t0.y + 3]);
  });

  test("after a pause the next press is a new step", async ({ page }) => {
    const t0 = await withCardLayer(page);
    const past = (await editor(page)).past;
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(800);
    await page.keyboard.press("ArrowRight");
    expect((await editor(page)).past).toBe(past + 2);
    await page.keyboard.press("Control+z");
    expect(await where(page)).toEqual([t0.x + 1, t0.y]);
  });

  test("the PNG has the layer where the keys put it (screen and file agree)", async ({ page }) => {
    await withCardLayer(page);
    for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight"); // 30 px right
    const png = await exportPngBytes(page);
    // 20 px past the card's old right edge is now card; the old left strip (first 30 px) is the page background
    expect(await pngPixelAt(page, png, CARD.x + CARD.width + 10, CARD.y + 60)).toEqual(BLUE);
    expect(await pngPixelAt(page, png, CARD.x + 10, CARD.y + 60)).toEqual([240, 240, 240, 255]);
  });

  test("nothing moves with no layer selected, while typing in a field, for a locked layer, or while comparing", async ({ page }) => {
    const t0 = await withCardLayer(page);

    // typing in a field: the arrow keys belong to the field
    await pickTool(page, "선");
    await page.getByTestId("draw-width").focus();
    await page.keyboard.press("ArrowRight");
    expect(await where(page)).toEqual([t0.x, t0.y]);
    expect((await drawStyleOf(page)).strokeWidth).toBeGreaterThan(0);
    await page.getByTestId("draw-width").blur();
    await pickTool(page, "선택");

    // locked
    await page.getByRole("button", { name: /잠그기$/ }).click();
    await page.keyboard.press("ArrowRight");
    expect(await where(page)).toEqual([t0.x, t0.y]);
    await page.getByRole("button", { name: /잠금 해제$/ }).click();

    // comparing with the original
    await page.evaluate(() => (window as any).__slc.getState().setCompareMode("original"));
    await page.keyboard.press("ArrowRight");
    expect(await where(page)).toEqual([t0.x, t0.y]);
    await page.evaluate(() => (window as any).__slc.getState().setCompareMode("off"));

    // nothing selected
    await page.evaluate(() => (window as any).__slc.getState().selectLayer?.(null));
    await page.keyboard.press("ArrowRight");
    expect(await where(page)).toEqual([t0.x, t0.y]);

    // and a normal press still works afterwards
    await page.getByTestId("layer-item").first().click();
    await page.keyboard.press("ArrowRight");
    expect(await where(page)).toEqual([t0.x + 1, t0.y]);
  });

  test("a dialog open in front blocks the keys: the export dialog and the restore question", async ({ page }) => {
    const t0 = await withCardLayer(page);
    await page.getByRole("button", { name: "PNG 내보내기" }).click();
    await expect(page.locator('[role="dialog"][aria-modal="true"]')).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    expect(await where(page)).toEqual([t0.x, t0.y]);
  });
  test("the position survives a project save and open, and the automatic save", async ({ page }) => {
    const t0 = await withCardLayer(page);
    await autosaveReady(page);
    const stamp = Date.now();
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("ArrowDown");
    const moved = [t0.x + 20, t0.y + 1];
    expect(await where(page)).toEqual(moved);
    await waitForAutosave(page, stamp);

    const text = await saveProjectFile(page);
    await reloadAndDiscard(page);
    await openProjectFile(page, text);
    await expect.poll(() => where(page)).toEqual(moved);

    // and the automatic save restores the same place after a plain reload
    await waitForAutosave(page);
    await page.reload();
    await expect(page.getByTestId("restore-dialog")).toBeVisible();
    // the restore question is a dialog too: the keys do nothing behind it
    await page.keyboard.press("ArrowRight");
    await page.getByRole("button", { name: "복원", exact: true }).click();
    await expect.poll(() => where(page)).toEqual(moved);
  });
});