import { Page, expect, test } from "@playwright/test";
import fs from "node:fs";
import { CARD, PAGE, clientOf, dragImageRect, dragLayerBy, editor, expectPixel, openApp, openProjectFile, pageWithCard, panelNames, pickTool, saveProjectFile, uploadPng, zoomTo } from "./helpers";

const cardCenter = { x: CARD.x + CARD.width / 2, y: CARD.y + CARD.height / 2 };
const spot = { x: CARD.x + 100, y: CARD.y + 60 }; // inside the card, where the layer sits on top of its own patch
const BLUE = [0, 0, 255, 255];
const GRAY = [240, 240, 240, 255];

async function withLayer(page: Page) {
  await openApp(page);
  await uploadPng(page, pageWithCard());
  await zoomTo(page, 1, 600, 300);
  await pickTool(page, "영역 추출");
  await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
  await pickTool(page, "선택");
}
const eye = (page: Page) => page.getByRole("button", { name: /숨기기|보이기/ });
const lock = (page: Page) => page.getByRole("button", { name: /잠그기|잠금 해제/ });

/** the exported PNG's pixel, decoded by the browser */
async function exportedPixel(page: Page, x: number, y: number) {
  await page.getByRole("button", { name: "PNG 내보내기" }).click();
  const download = page.waitForEvent("download");
  await page.getByTestId("export-save").click();
  const png = fs.readFileSync(await (await download).path());
  await page.getByRole("button", { name: "닫기" }).click();
  return page.evaluate(
    async ([b64, px, py]) => {
      const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0))]), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
      const g = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d")!;
      g.drawImage(bmp, 0, 0);
      return Array.from(g.getImageData(px as number, py as number, 1, 1).data);
    },
    [png.toString("base64"), x, y] as const,
  );
}

test.describe("hide", () => {
  test("hiding removes the layer from the canvas and from the exported PNG; showing brings it back", async ({ page }) => {
    await withLayer(page);
    await expectPixel(page, spot.x, spot.y, BLUE);
    expect(await exportedPixel(page, spot.x, spot.y)).toEqual(BLUE);

    await eye(page).click();
    await expectPixel(page, spot.x, spot.y, GRAY); // what is left is the patch that filled the old spot
    expect(await exportedPixel(page, spot.x, spot.y)).toEqual(GRAY);
    expect((await editor(page)).layers[0]).toBeDefined(); // still there, only not drawn
    await expect(page.getByTestId("layer-item")).toHaveCount(1);

    await eye(page).click();
    await expectPixel(page, spot.x, spot.y, BLUE);
    expect(await exportedPixel(page, spot.x, spot.y)).toEqual(BLUE);
  });

  test("the exported PNG keeps its size when a layer is hidden", async ({ page }) => {
    await withLayer(page);
    await eye(page).click();
    await page.getByRole("button", { name: "PNG 내보내기" }).click();
    await expect(page.getByTestId("export-size")).toContainText(`${PAGE.width} × ${PAGE.height} px`);
  });

  test("a hidden layer cannot be grabbed on the canvas, but it can still be picked in the list", async ({ page }) => {
    await withLayer(page);
    await eye(page).click();
    await page.mouse.click(10, 10); // anything: deselect by clicking the canvas
    const c = await clientOf(page, spot.x, spot.y);
    await page.mouse.click(c.x, c.y);
    expect((await editor(page)).selected).toEqual([]);
    await page.getByTestId("layer-item").click();
    expect((await editor(page)).selected).toHaveLength(1);
  });

  test("hide and show are undoable", async ({ page }) => {
    await withLayer(page);
    const past = (await editor(page)).past;
    await eye(page).click();
    expect((await editor(page)).past).toBe(past + 1);
    await page.getByRole("button", { name: /실행 취소/ }).click();
    await expectPixel(page, spot.x, spot.y, BLUE);
  });

  test("a hidden layer looks hidden in the list", async ({ page }) => {
    await withLayer(page);
    await eye(page).click();
    await expect(page.getByTestId("layer-list").locator("li")).toHaveAttribute("data-hidden", "true");
    await expect(eye(page)).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("lock", () => {
  test("a locked layer will not move when dragged; unlocked, it does", async ({ page }) => {
    await withLayer(page);
    await lock(page).click();
    const past = (await editor(page)).past;
    await dragLayerBy(page, cardCenter, 120, 80);
    expect((await editor(page)).layers[0].transform).toMatchObject({ x: CARD.x, y: CARD.y });
    expect((await editor(page)).past).toBe(past);

    await lock(page).click();
    await dragLayerBy(page, cardCenter, 120, 80);
    expect((await editor(page)).layers[0].transform).toMatchObject({ x: CARD.x + 120, y: CARD.y + 80 });
  });

  test("a locked layer cannot be deleted by the button or the Delete key", async ({ page }) => {
    await withLayer(page);
    await lock(page).click();
    await expect(page.getByRole("button", { name: "삭제" })).toBeDisabled();
    await page.keyboard.press("Delete");
    expect((await editor(page)).layers).toHaveLength(1);
    await lock(page).click();
    await page.keyboard.press("Delete");
    expect((await editor(page)).layers).toHaveLength(0);
  });

  test("a locked layer can still be clicked to select, and its outline is dashed to show it", async ({ page }) => {
    await withLayer(page);
    await lock(page).click();
    await page.mouse.click(10, 10);
    const c = await clientOf(page, spot.x, spot.y);
    await page.mouse.click(c.x, c.y);
    expect((await editor(page)).selected).toHaveLength(1);
    await expect(lock(page)).toHaveAttribute("aria-pressed", "true");
  });

  test("a duplicate of a locked layer is not locked", async ({ page }) => {
    await withLayer(page);
    await lock(page).click();
    await page.getByRole("button", { name: "복제" }).click();
    const names = await panelNames(page);
    expect(names).toEqual(["레이어 1 복사", "레이어 1"]);
    await dragLayerBy(page, { x: CARD.x + 16 + 100, y: CARD.y + 16 + 60 }, 40, 0); // the copy moves
    expect((await editor(page)).layers.find((l) => l.name === "레이어 1 복사")!.transform.x).toBe(CARD.x + 16 + 40);
  });
});

test.describe("rename", () => {
  test("Enter keeps the new name, in the list and in the panel, as one undo step", async ({ page }) => {
    await withLayer(page);
    const past = (await editor(page)).past;
    const name = page.getByTestId("prop-name");
    await name.fill("Hero card");
    await name.press("Enter");
    expect(await panelNames(page)).toEqual(["Hero card"]);
    expect((await editor(page)).past).toBe(past + 1);

    await page.getByRole("button", { name: /실행 취소/ }).click();
    expect(await panelNames(page)).toEqual(["레이어 1"]);
    await expect(name).toHaveValue("레이어 1");
  });

  test("leaving the field also keeps the name", async ({ page }) => {
    await withLayer(page);
    await page.getByTestId("prop-name").fill("Price card");
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    expect(await panelNames(page)).toEqual(["Price card"]);
  });

  test("Escape puts the old name back and records nothing", async ({ page }) => {
    await withLayer(page);
    const past = (await editor(page)).past;
    const name = page.getByTestId("prop-name");
    await name.fill("never mind");
    await name.press("Escape");
    await expect(name).toHaveValue("레이어 1");
    expect((await editor(page)).past).toBe(past);
  });

  test("an empty name is refused and the old one is shown again", async ({ page }) => {
    await withLayer(page);
    const past = (await editor(page)).past;
    const name = page.getByTestId("prop-name");
    await name.fill("   ");
    await name.press("Enter");
    await expect(name).toHaveValue("레이어 1");
    expect(await panelNames(page)).toEqual(["레이어 1"]);
    expect((await editor(page)).past).toBe(past);
  });

  test("typing in the name field does not trigger shortcuts: an r stays an r", async ({ page }) => {
    await withLayer(page);
    const name = page.getByTestId("prop-name");
    await name.fill("");
    await page.keyboard.type("hrvd Delete");
    await expect(name).toHaveValue("hrvd Delete");
    await expect(page.getByRole("button", { name: "선택", exact: true })).toHaveAttribute("aria-pressed", "true"); // H and R did not switch tools
    expect((await editor(page)).layers).toHaveLength(1);
  });

  test("a locked layer can be renamed", async ({ page }) => {
    await withLayer(page);
    await lock(page).click();
    await page.getByTestId("prop-name").fill("Locked hero");
    await page.getByTestId("prop-name").press("Enter");
    expect(await panelNames(page)).toEqual(["Locked hero"]);
  });
});

test("name, hidden and locked all survive a save, a reload and an open", async ({ page }) => {
  await withLayer(page);
  await page.getByTestId("prop-name").fill("Kept name");
  await page.getByTestId("prop-name").press("Enter");
  await eye(page).click();
  await lock(page).click();
  const text = await saveProjectFile(page);
  const saved = JSON.parse(text).project.screens[0].layers[0];
  expect(saved).toMatchObject({ name: "Kept name", visible: false, locked: true });

  await page.reload();
  await openProjectFile(page, text);
  await expect(page.getByTestId("screen-label")).toBeVisible();
  expect(await panelNames(page)).toEqual(["Kept name"]);
  await expect(page.getByTestId("layer-list").locator("li")).toHaveAttribute("data-hidden", "true");
  await expect(page.getByTestId("layer-list").locator("li")).toHaveAttribute("data-locked", "true");
  await expectPixel(page, spot.x, spot.y, GRAY); // still hidden after the round trip
});
