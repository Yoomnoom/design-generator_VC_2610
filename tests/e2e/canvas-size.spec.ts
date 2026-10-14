import { expect, test } from "@playwright/test";
import { CARD, dragImageRect, editor, exportPngBytes, openApp, pageWithCard, pickTool, pngPixelAt, readPngSize, uploadPng, zoomTo } from "./helpers";

test.describe("canvas size", () => {
  test("the dialog grows the page from the centre with a coloured margin; the PNG has the new size; layers follow; undo restores", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    await zoomTo(page, 1, 600, 330);
    await pickTool(page, "영역 추출");
    await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
    await expect.poll(async () => (await editor(page)).layers.length).toBe(1);
    const x0 = (await editor(page)).layers[0].transform.x;
    await page.getByTestId("canvas-size-open").click();
    await expect(page.getByTestId("canvas-size-dialog")).toBeVisible();
    await page.getByTestId("csize-width").fill("1400");
    await page.getByTestId("csize-height").fill("1000");
    await page.getByTestId("csize-margin").check();
    await page.getByTestId("csize-colour").fill("#ff8800");
    await page.screenshot({ path: "test-results/canvas-size.png" });
    await page.getByTestId("csize-apply").click();
    await expect(page.getByTestId("canvas-size-dialog")).toHaveCount(0);
    await expect.poll(async () => (await editor(page)).screen).toMatchObject({ width: 1400, height: 1000 });
    expect((await editor(page)).layers[0].transform.x).toBe(x0 + 100);
    const png = await exportPngBytes(page);
    expect(readPngSize(png)).toMatchObject({ width: 1400, height: 1000 });
    expect(await pngPixelAt(page, png, 3, 3)).toEqual([255, 136, 0, 255]); // the margin
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await editor(page)).screen).toMatchObject({ width: 1200, height: 800 });
  });

  test("bad sizes show the reason and the button stays off; 8192 is allowed, 8193 is not", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    await page.getByTestId("canvas-size-open").click();
    for (const [w, h, why] of [["8193", "100", "8192"], ["0", "100", "1px"], ["abc", "100", "숫자"]] as const) {
      await page.getByTestId("csize-width").fill(w);
      await page.getByTestId("csize-height").fill(h);
      await expect(page.getByTestId("csize-note")).toContainText(why);
      await expect(page.getByTestId("csize-apply")).toBeDisabled();
    }
    await page.getByTestId("csize-width").fill("8192");
    await page.getByTestId("csize-height").fill("100");
    await expect(page.getByTestId("csize-apply")).toBeEnabled();
    await page.getByTestId("csize-cancel").click();
    await expect(page.getByTestId("canvas-size-dialog")).toHaveCount(0);
  });
});