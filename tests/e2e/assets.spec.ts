import { Page, expect, test } from "@playwright/test";
import fs from "node:fs";
import { CARD, dragImageRect, editor, openApp, pageWithCard, pickTool, reloadAndDiscard, saveProjectFile, uploadPng, zoomTo } from "./helpers";

const tab = (page: Page, id: "builtin" | "mine" | "template") => page.getByTestId(`asset-tab-${id}`).click();
const names = (page: Page) => page.getByTestId("my-asset-name").allInnerTexts();

async function withLayer(page: Page) {
  await openApp(page);
  await uploadPng(page, pageWithCard());
  await zoomTo(page, 1, 600, 300);
  await pickTool(page, "영역 추출");
  await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
  await expect.poll(async () => (await editor(page)).layers.length).toBe(1);
}

test.describe("built-in sources", () => {
  test("a click puts the button in the middle of the frame as new layers, in one undo step", async ({ page }) => {
    await withLayer(page);
    const before = await editor(page);
    await page.getByTestId("asset-button-fill-hover").click();
    const after = await editor(page);
    expect(after.layers.length).toBe(before.layers.length + 4);
    expect(after.past).toBe(before.past + 1);
    expect(after.selected.length).toBe(4); // the paler soft edge, the shadow, the body and the label
    const added = after.layers.filter((l) => after.selected.includes(l.id));
    const xs = added.flatMap((l) => [l.transform.x, l.transform.x + (l.content?.width ?? 0)]);
    expect(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 600)).toBeLessThanOrEqual(1); // the frame is 1200 wide
    await page.keyboard.press("Control+z");
    expect((await editor(page)).layers.length).toBe(before.layers.length);
  });

  test("the buttons are disabled with no image and while comparing", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("asset-card")).toBeDisabled();
    await uploadPng(page, pageWithCard());
    await expect(page.getByTestId("asset-card")).toBeEnabled();
    await page.evaluate(() => (window as any).__slc.getState().setCompareMode("original"));
    await expect(page.getByTestId("asset-card")).toBeDisabled();
  });
});

test.describe("my sources", () => {
  test("save the selected layer, insert it, rename, delete; it survives a reload and is not in the project file", async ({ page }) => {
    await withLayer(page);
    await tab(page, "mine");
    await page.getByTestId("asset-save-name").fill("Blue card");
    await page.getByTestId("asset-save").click();
    await expect.poll(() => names(page)).toEqual(["Blue card"]);

    await page.getByTestId("asset-insert").click();
    await expect.poll(async () => (await editor(page)).layers.length).toBe(2);

    await page.getByTestId("asset-rename").click();
    await page.getByTestId("asset-rename-input").fill("Renamed");
    await page.keyboard.press("Enter");
    await expect.poll(() => names(page)).toEqual(["Renamed"]);

    expect(await saveProjectFile(page)).not.toContain("Renamed");

    await reloadAndDiscard(page);
    await tab(page, "mine");
    await expect.poll(() => names(page)).toEqual(["Renamed"]);
    await page.getByTestId("asset-delete").click();
    await expect.poll(() => names(page)).toEqual([]);
  });

  test("export, then import into the same library: the same name is kept apart, a damaged file says why", async ({ page }) => {
    await withLayer(page);
    await tab(page, "mine");
    await page.getByTestId("asset-save-name").fill("Card");
    await page.getByTestId("asset-save").click();
    await expect.poll(() => names(page)).toEqual(["Card"]);
    const download = page.waitForEvent("download");
    await page.getByTestId("asset-export").click();
    const file = await (await download).path();
    const text = fs.readFileSync(file, "utf8");
    expect(JSON.parse(text).format).toBe("slc-assets");

    await page.getByTestId("asset-import-input").setInputFiles({ name: "my.slc-assets.json", mimeType: "application/json", buffer: Buffer.from(text) });
    await expect.poll(() => names(page)).toEqual(["Card", "Card (2)"]);
    await expect(page.getByTestId("asset-message")).toContainText("Card → Card (2)");

    await page.getByTestId("asset-import-input").setInputFiles({ name: "broken.slc-assets.json", mimeType: "application/json", buffer: Buffer.from("{oops") });
    await expect(page.getByTestId("asset-message")).toContainText("가져오지 못했습니다");
    expect(await names(page)).toEqual(["Card", "Card (2)"]);
  });
});

test.describe("templates", () => {
  test("open as a new project (390 x 844, vector layers); with edits in it the first click only asks", async ({ page }) => {
    await openApp(page);
    await tab(page, "template");
    await page.getByTestId("template-login-new").click();
    await expect(page.getByTestId("screen-label")).toContainText("390 × 844 px");
    const e = await editor(page);
    expect(e.layers.length).toBeGreaterThan(5);
    expect(e.layers.every((l) => l.content)).toBe(true);
    expect(e.past).toBe(0);
    // edit, then try to open another: it asks first
    await page.evaluate(() => { const s = (window as any).__slc.getState(); s.setLayerLocked(s.history.present.screens[0].layers[0].id, true); });
    await page.getByTestId("template-cards-new").click();
    await expect(page.getByTestId("template-cards-new")).toContainText("작업이 사라집니다");
    expect((await editor(page)).layers.length).toBe(e.layers.length);
    await page.getByTestId("template-cards-new").click();
    await expect.poll(async () => (await editor(page)).layers.length).not.toBe(e.layers.length);
  });

  test("add to the current screen: only layers come in, one undo step, the screen stays", async ({ page }) => {
    await withLayer(page);
    const before = await editor(page);
    await tab(page, "template");
    await page.getByTestId("template-settings-add").click();
    const after = await editor(page);
    expect(after.layers.length).toBeGreaterThan(before.layers.length + 10);
    expect(after.past).toBe(before.past + 1);
    expect(after.screen).toEqual(before.screen);
    await page.keyboard.press("Control+z");
    expect((await editor(page)).layers.length).toBe(before.layers.length);
  });
});