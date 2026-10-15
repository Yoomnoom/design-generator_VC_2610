import { Page, expect, test } from "@playwright/test";
import { CARD, GRAY, PAGE, RED, blank, editor, encodePng, exportPngBytes, fill, openApp, openProjectFile, pageWithCard, pickTool, pngPixelAt, drawStroke, saveProjectFile, screenPixel, uploadPng, upload, waitForAutosave, zoomTo } from "./helpers";

const BLUE = [0, 0, 255, 255];
const state = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__slc.getState();
    const sc = s.history?.present.screens[0];
    return { patches: (sc?.backgroundPatches ?? []) as { id: string; hidden?: boolean }[], past: (s.history?.past.length ?? 0) as number, layers: (sc?.layers ?? []).length as number, imageId: (sc?.source.imageId ?? "") as string, notice: (s.notice ?? null) as string | null };
  });
const cardCenter = { x: CARD.x + CARD.width / 2, y: CARD.y + CARD.height / 2 };

/** the card extracted (a patch over its place), its layer deleted so what shows is the patch over the original */
async function withPatch(page: Page) {
  await openApp(page);
  await uploadPng(page, pageWithCard());
  await zoomTo(page, 1, cardCenter.x, cardCenter.y + 100);
  await pickTool(page, "영역 추출");
  const a = await page.evaluate(([x, y, w, h]) => (window as any).__slc.getState().beginExtraction({ x, y, width: w, height: h }), [CARD.x, CARD.y, CARD.width, CARD.height]);
  expect(a.status).toBe("committed");
  await page.evaluate((id) => (window as any).__slc.getState().deleteLayer(id), a.layerId);
  await expect.poll(async () => (await state(page)).layers).toBe(0);
  await pickTool(page, "선택");
}
const unlock = async (page: Page) => {
  await page.getByTestId("source-lock").click();
  await expect(page.getByTestId("source-row")).toHaveAttribute("data-locked", "false");
};
const openList = async (page: Page) => {
  const list = page.getByTestId("patch-list");
  if ((await list.getAttribute("open")) === null) await list.locator("summary").click();
};

test.describe("background patches: list, hide, delete", () => {
  test("the list shows each patch; locked, the buttons are disabled with the reason; unlocked, hide and delete work and undo", async ({ page }) => {
    await withPatch(page);
    await openList(page);
    await expect(page.getByTestId("patch-item")).toHaveCount(1);
    await expect(page.getByTestId("patch-hide")).toBeDisabled();
    await expect(page.getByTestId("patch-delete")).toBeDisabled();
    expect(await page.getByTestId("patch-hide").getAttribute("title")).toContain("잠긴 원본");
    expect(await screenPixel(page, cardCenter.x, cardCenter.y)).toEqual(GRAY); // the patch covers the card's old place
    await unlock(page);
    const base = (await state(page)).past;
    await page.getByTestId("patch-hide").click();
    await expect.poll(async () => (await state(page)).patches[0]?.hidden).toBe(true);
    expect((await state(page)).past).toBe(base + 1);
    await expect(page.getByTestId("patch-item")).toHaveAttribute("data-hidden", "true");
    expect(await screenPixel(page, cardCenter.x, cardCenter.y)).toEqual(BLUE); // the original shows through
    const png = await exportPngBytes(page);
    expect(await pngPixelAt(page, png, cardCenter.x, cardCenter.y)).toEqual(BLUE); // and so does the PNG
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await state(page)).patches[0]?.hidden).toBeUndefined();
    expect(await screenPixel(page, cardCenter.x, cardCenter.y)).toEqual(GRAY);
    await page.getByTestId("patch-delete").click();
    await expect.poll(async () => (await state(page)).patches.length).toBe(0);
    expect(await screenPixel(page, cardCenter.x, cardCenter.y)).toEqual(BLUE);
    await page.screenshot({ path: "test-results/patch-list.png" });
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await state(page)).patches.length).toBe(1);
  });

  test("while comparing the buttons are disabled", async ({ page }) => {
    await withPatch(page);
    await unlock(page);
    await openList(page);
    await page.getByRole("button", { name: "원본", exact: true }).click();
    await expect(page.getByTestId("patch-hide")).toBeDisabled();
    await expect(page.getByTestId("patch-delete")).toBeDisabled();
    expect(await page.getByTestId("patch-hide").getAttribute("title")).toContain("비교 보기");
    await page.getByRole("button", { name: "수정본", exact: true }).click();
    await expect(page.getByTestId("patch-hide")).toBeEnabled();
  });

  test("a hidden patch is saved with the project and kept by the temporary save", async ({ page }) => {
    await withPatch(page);
    await unlock(page);
    await openList(page);
    await page.getByTestId("patch-hide").click();
    await expect.poll(async () => (await state(page)).patches[0]?.hidden).toBe(true);
    const text = await saveProjectFile(page);
    const doc = JSON.parse(text);
    expect(doc.project.version).toBe(14);
    expect(doc.project.screens[0].backgroundPatches[0].hidden).toBe(true);
    await waitForAutosave(page);
    await page.reload();
    await expect(page.getByTestId("restore-dialog")).toBeVisible();
    await page.getByRole("button", { name: "복원" }).click();
    await expect.poll(async () => (await state(page)).patches[0]?.hidden).toBe(true);
    await openProjectFile(page, text);
    await expect.poll(async () => (await state(page)).patches[0]?.hidden).toBe(true);
  });
});

test.describe("an edit under a patch", () => {
  test("it is reported, and 'delete the patch here' makes the edit show (screen and PNG)", async ({ page }) => {
    await withPatch(page);
    await unlock(page);
    await page.getByTestId("source-item").click();
    await page.evaluate(() => (window as any).__slc.getState().setDrawStyle({ stroke: "#ff0000", strokeWidth: 12 }));
    await drawStroke(page, "브러시", [{ x: cardCenter.x - 30, y: cardCenter.y }, { x: cardCenter.x + 30, y: cardCenter.y }]);
    await expect(page.getByTestId("source-covered-warning")).toBeVisible();
    expect((await state(page)).notice).toContain("배경 패치");
    expect(await screenPixel(page, cardCenter.x, cardCenter.y)).toEqual(GRAY); // hidden under the patch
    await page.screenshot({ path: "test-results/source-covered.png" });
    await page.getByTestId("patch-delete-here").click();
    await expect.poll(async () => (await state(page)).patches.length).toBe(0);
    expect(await screenPixel(page, cardCenter.x, cardCenter.y)).toEqual(RED);
    await page.evaluate(() => (window as any).__slc.getState().setNotice(null)); // the notice has its own close button
    const png = await exportPngBytes(page);
    expect(await pngPixelAt(page, png, cardCenter.x, cardCenter.y)).toEqual(RED);
    await expect(page.getByTestId("source-covered-warning")).toHaveCount(0);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await state(page)).patches.length).toBe(1);
  });

  test("an edit away from the patches says nothing about them", async ({ page }) => {
    await withPatch(page);
    await unlock(page);
    await page.getByTestId("source-item").click();
    await page.evaluate(() => (window as any).__slc.getState().setDrawStyle({ stroke: "#ff0000", strokeWidth: 12 }));
    await drawStroke(page, "브러시", [{ x: cardCenter.x - 30, y: cardCenter.y + 160 }, { x: cardCenter.x + 30, y: cardCenter.y + 160 }]);
    await expect.poll(async () => (await state(page)).past).toBeGreaterThan(2);
    await expect(page.getByTestId("source-covered-warning")).toHaveCount(0);
    await expect(page.getByTestId("source-patch-note")).toBeVisible(); // the general note: patches cover the original where they are
  });
});

test.describe("original adjustment preview", () => {
  test("while a slider moves the page shows a reduced preview; 'apply' bakes the full-size one, and the two agree where the picture is flat", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    await zoomTo(page, 1, 600, 400);
    await unlock(page);
    await page.getByTestId("source-item").click();
    await page.getByTestId("source-adjust").locator("summary").click();
    const before = await screenPixel(page, 450, 450);
    expect(before).toEqual(GRAY);
    await page.getByTestId("src-adj-brightness").fill("-40");
    await expect.poll(async () => (await screenPixel(page, 450, 450))[0]).toBeLessThan(before[0] - 20); // the preview shows at once
    const preview = await screenPixel(page, 450, 450);
    const flatBlue = await screenPixel(page, CARD.x + 100, CARD.y + 60);
    expect((await state(page)).past).toBe(1); // only the unlock: the preview wrote no history
    await page.getByTestId("src-adj-apply").click();
    await expect(page.getByTestId("source-message")).toContainText("원본에 적용했습니다");
    const past = (await state(page)).past;
    expect(past).toBe(2);
    const applied = await screenPixel(page, 450, 450);
    for (let i = 0; i < 3; i++) expect(Math.abs(applied[i] - preview[i])).toBeLessThanOrEqual(1);
    const blueApplied = await screenPixel(page, CARD.x + 100, CARD.y + 60);
    for (let i = 0; i < 3; i++) expect(Math.abs(blueApplied[i] - flatBlue[i])).toBeLessThanOrEqual(1);
    const png = await exportPngBytes(page);
    expect(await pngPixelAt(page, png, 450, 450)).toEqual(applied); // screen = PNG
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await screenPixel(page, 450, 450))[0]).toBe(GRAY[0]);
    await page.screenshot({ path: "test-results/source-adjust.png" });
  });

  test("cancelling the preview restores the picture and writes nothing; while comparing the sliders are disabled", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    await zoomTo(page, 1, 600, 400);
    await unlock(page);
    await page.getByTestId("source-item").click();
    await page.getByTestId("source-adjust").locator("summary").click();
    await page.getByTestId("src-adj-contrast").fill("80");
    await expect(page.getByTestId("src-adj-cancel")).toBeEnabled();
    await page.getByTestId("src-adj-cancel").click();
    await expect.poll(async () => await screenPixel(page, 450, 450)).toEqual(GRAY);
    await page.getByTestId("src-adj-contrast").fill("80");
    await page.getByRole("button", { name: "원본", exact: true }).click();
    await expect(page.getByTestId("src-adj-contrast")).toBeDisabled();
    await expect(page.getByTestId("src-adj-apply")).toBeDisabled();
    expect((await state(page)).past).toBe(1);
  });

  test("leaving the original ends the preview", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    await zoomTo(page, 1, 600, 400);
    await unlock(page);
    await page.getByTestId("source-item").click();
    await page.getByTestId("source-adjust").locator("summary").click();
    await page.getByTestId("src-adj-brightness").fill("-40");
    await expect.poll(async () => (await screenPixel(page, 450, 450))[0]).toBeLessThan(220);
    await page.evaluate(() => (window as any).__slc.getState().deselectAll()); // the original is no longer selected: its panel goes, and so does the preview
    await expect.poll(async () => await screenPixel(page, 450, 450)).toEqual(GRAY);
  });
});
