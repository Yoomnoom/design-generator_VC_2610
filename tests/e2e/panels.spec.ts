import { Page, expect, test } from "@playwright/test";
import fs from "node:fs";
import { reloadAndDiscard, expectPixel, CARD, CARD2, PAGE, clientOf, dragImageRect, dragLayerBy, editor, idbKeys, openApp, openProjectFile, pageWithCard, pageWithTwoCards, panelNames, pickTool, pixelAt, readPngSize, saveProjectFile, uploadPng, zoomTo } from "./helpers";

const GRAY = [240, 240, 240, 255];
// a spot of plain background that is on screen at the 100% view these tests use (the canvas shows image y from about -19 to 619)
const EMPTY = { x: 850, y: 520 };
const cardCenter = { x: CARD.x + CARD.width / 2, y: CARD.y + CARD.height / 2 };

async function withCard(page: Page, two = false) {
  await openApp(page);
  await uploadPng(page, two ? pageWithTwoCards() : pageWithCard());
  await zoomTo(page, 1, 600, 300);
  await pickTool(page, "영역 추출");
  await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
  if (two) {
    await pickTool(page, "영역 추출"); // a finished extraction switches back to the select tool
    await dragImageRect(page, { x: CARD2.x, y: CARD2.y }, { x: CARD2.x + CARD2.width, y: CARD2.y + CARD2.height });
  }
  await pickTool(page, "선택");
}

const topBar = (page: Page, name: RegExp | string) => page.getByRole("banner").getByRole("button", { name });

test.describe("undo / redo buttons", () => {
  test("start disabled, then step back and forward through extract, move and delete", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    await expect(topBar(page, /실행 취소/)).toBeDisabled();
    await expect(topBar(page, /다시 실행/)).toBeDisabled();

    await zoomTo(page, 1, 600, 300);
    await pickTool(page, "영역 추출");
    await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
    await pickTool(page, "선택");
    await dragLayerBy(page, cardCenter, 100, 50);
    await page.getByRole("button", { name: "삭제" }).click();
    expect(await editor(page)).toMatchObject({ layers: [], past: 3 });

    await topBar(page, /실행 취소/).click(); // delete undone
    expect((await editor(page)).layers[0].transform).toMatchObject({ x: CARD.x + 100, y: CARD.y + 50 });
    await topBar(page, /실행 취소/).click(); // move undone
    expect((await editor(page)).layers[0].transform).toMatchObject({ x: CARD.x, y: CARD.y });
    await topBar(page, /실행 취소/).click(); // extraction undone: layer and patch go together
    expect(await editor(page)).toMatchObject({ layers: [], patches: [], past: 0 });
    await expect(topBar(page, /실행 취소/)).toBeDisabled();

    for (let i = 0; i < 3; i++) await topBar(page, /다시 실행/).click();
    expect(await editor(page)).toMatchObject({ layers: [], past: 3 });
    await expect(topBar(page, /다시 실행/)).toBeDisabled();
  });

  test("the button's tooltip names the step it would undo", async ({ page }) => {
    await withCard(page);
    await expect(topBar(page, /실행 취소/)).toHaveAttribute("title", "실행 취소: 영역 추출 (Ctrl+Z)");
  });

  test("redo is dropped by a new edit", async ({ page }) => {
    await withCard(page);
    await topBar(page, /실행 취소/).click();
    await expect(topBar(page, /다시 실행/)).toBeEnabled();
    await pickTool(page, "영역 추출");
    await dragImageRect(page, { x: 600, y: 500 }, { x: 700, y: 560 });
    await expect(topBar(page, /다시 실행/)).toBeDisabled();
  });
});

test.describe("layer panel", () => {
  test("lists layers front-first and selecting in the list selects on the canvas", async ({ page }) => {
    await withCard(page, true);
    expect(await panelNames(page)).toEqual(["레이어 2", "레이어 1"]); // 2 was extracted last, so it is on top
    await page.getByTestId("layer-item").filter({ hasText: "레이어 1" }).click();
    const s = await editor(page);
    expect(s.selected).toEqual([s.layers.find((l) => l.name === "레이어 1")!.id]);
    await expect(page.getByTestId("prop-name")).toHaveValue("레이어 1");
  });

  test("clicking a layer on the canvas highlights it in the list", async ({ page }) => {
    await withCard(page, true);
    const c = await clientOf(page, CARD.x + 100, CARD.y + 60);
    await page.mouse.click(c.x, c.y);
    await expect(page.getByTestId("layer-item").filter({ hasText: "레이어 1" })).toHaveAttribute("aria-current", "true");
  });

  test("forward/back change what is in front, and are disabled at the ends", async ({ page }) => {
    await withCard(page, true);
    await dragLayerBy(page, { x: CARD2.x + 100, y: CARD2.y + 50 }, -380, 60); // green over blue; green is selected and in front
    await expectPixel(page, 400, 290, [0, 160, 0, 255]);
    await expect(page.getByRole("button", { name: "앞으로" })).toBeDisabled(); // already in front
    await page.getByRole("button", { name: "뒤로" }).click();
    await expectPixel(page, 400, 290, [0, 0, 255, 255]);
    expect(await panelNames(page)).toEqual(["레이어 1", "레이어 2"]);
    await expect(page.getByRole("button", { name: "뒤로" })).toBeDisabled();
    await page.getByRole("button", { name: "앞으로" }).click();
    await expectPixel(page, 400, 290, [0, 160, 0, 255]);
    expect((await editor(page)).layers.map((l) => l.zIndex).sort()).toEqual([0, 1]);
  });

  test("buttons are disabled with nothing selected", async ({ page }) => {
    await withCard(page);
    const empty = await clientOf(page, EMPTY.x, EMPTY.y);
    await page.mouse.click(empty.x, empty.y); // empty canvas
    for (const name of ["앞으로", "뒤로", "복제", "삭제"]) await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  });

  test("duplicate: the copy is 16px right and down, on top, selected, and one undo removes it", async ({ page }) => {
    await withCard(page);
    await page.getByRole("button", { name: "복제" }).click();
    const s = await editor(page);
    expect(s.layers).toHaveLength(2);
    const copy = s.layers.find((l) => l.name === "레이어 1 복사")!;
    expect(copy.transform).toMatchObject({ x: CARD.x + 16, y: CARD.y + 16 });
    expect(copy.zIndex).toBeGreaterThan(s.layers.find((l) => l.name === "레이어 1")!.zIndex);
    expect(s.selected).toEqual([copy.id]);
    expect(s.patches).toHaveLength(1); // nothing was cut out, so no new patch
    expect(await panelNames(page)).toEqual(["레이어 1 복사", "레이어 1"]);
    await expect(page.getByTestId("prop-x")).toHaveText(String(CARD.x + 16));

    await topBar(page, /실행 취소/).click();
    expect((await editor(page)).layers).toHaveLength(1);
  });

  test("delete removes the layer but the patch (the filled old spot) stays", async ({ page }) => {
    await withCard(page);
    await page.getByRole("button", { name: "삭제" }).click();
    const s = await editor(page);
    expect(s.layers).toHaveLength(0);
    expect(s.patches).toHaveLength(1);
    await expectPixel(page, cardCenter.x, cardCenter.y, GRAY);
    await expect(page.getByText("영역 추출 도구로 사각형을 드래그하면")).toBeVisible();
  });
});

test.describe("property panel", () => {
  test("shows name, X, Y, width and height; only the name can be edited", async ({ page }) => {
    await withCard(page);
    await expect(page.getByTestId("prop-name")).toHaveValue("레이어 1");
    await expect(page.getByTestId("prop-x")).toHaveText(String(CARD.x));
    await expect(page.getByTestId("prop-y")).toHaveText(String(CARD.y));
    await expect(page.getByTestId("prop-width")).toHaveText(String(CARD.width));
    await expect(page.getByTestId("prop-height")).toHaveText(String(CARD.height));
    // the name is the only input in the section: X, Y, width and height are plain text
    await expect(page.getByRole("region", { name: "선택 레이어" }).locator("input, textarea, [contenteditable]")).toHaveCount(1);
    await expect(page.getByTestId("prop-name")).toBeEditable();
  });

  test("X and Y follow the layer live while it is being dragged", async ({ page }) => {
    await withCard(page);
    const a = await clientOf(page, cardCenter.x, cardCenter.y);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 40, a.y + 30, { steps: 8 });
    await expect(page.getByTestId("prop-x")).toHaveText(String(CARD.x + 40)); // before the button is released
    await expect(page.getByTestId("prop-y")).toHaveText(String(CARD.y + 30));
    expect((await editor(page)).past).toBe(1);
    await page.mouse.up();
    expect((await editor(page)).past).toBe(2);
  });
});

test.describe("fill tool: change the colour of an existing patch", () => {
  const spot = { x: CARD.x + 30, y: CARD.y + 60 };

  async function moveCardAway(page: Page) {
    await dragLayerBy(page, cardCenter, 0, 300);
  }

  test("clicking a patch selects it and shows its area and colour", async ({ page }) => {
    await withCard(page);
    await pickTool(page, "배경 채움");
    const c = await clientOf(page, spot.x, spot.y);
    await page.mouse.click(c.x, c.y);
    await expect(page.getByTestId("patch-hex")).toHaveText("#f0f0f0");
    await expect(page.getByTestId("prop-x")).toHaveText(String(CARD.x));
    await expect(page.getByTestId("prop-width")).toHaveText(String(CARD.width));
    expect((await editor(page)).selected).toEqual([]); // a patch and a layer are not selected together
  });

  test("a new colour shows on the canvas and in the exported PNG, as ONE undo step", async ({ page }) => {
    await withCard(page);
    await moveCardAway(page); // so the old spot is visible
    await pickTool(page, "배경 채움");
    const c = await clientOf(page, spot.x, spot.y);
    await page.mouse.click(c.x, c.y);
    const past = (await editor(page)).past;

    // dragging inside the picker fires many `input` events and must not each become an undo step
    await page.getByTestId("patch-color").evaluate((el: HTMLInputElement) => {
      for (const v of ["#aa0000", "#bb0000", "#cc0000"]) {
        el.value = v;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    expect((await editor(page)).past).toBe(past);
    await page.getByTestId("patch-color").evaluate((el: HTMLInputElement) => el.dispatchEvent(new Event("change", { bubbles: true })));
    expect((await editor(page)).past).toBe(past + 1);
    expect((await editor(page)).patches[0].fill).toBe("#cc0000");

    await expectPixel(page, spot.x, spot.y, [204, 0, 0, 255]);
    await page.getByRole("button", { name: "PNG 내보내기" }).click();
    const download = page.waitForEvent("download");
    await page.getByTestId("export-save").click();
    const png = fs.readFileSync(await (await download).path());
    expect(readPngSize(png)).toMatchObject({ width: PAGE.width, height: PAGE.height });
    const px = await page.evaluate(
      async ([b64, x, y]) => {
        const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64 as string), (ch) => ch.charCodeAt(0))]), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
        const g = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d")!;
        g.drawImage(bmp, 0, 0);
        return Array.from(g.getImageData(x as number, y as number, 1, 1).data);
      },
      [png.toString("base64"), spot.x, spot.y] as const,
    );
    expect(px).toEqual([204, 0, 0, 255]);

    await page.getByRole("button", { name: "닫기" }).click();
    await topBar(page, /실행 취소/).click();
    expect((await editor(page)).patches[0].fill).toBe("#f0f0f0");
    await expect(page.getByTestId("patch-hex")).toHaveText("#f0f0f0"); // the panel follows undo
  });

  test("the fill tool cannot paint new rectangles, and clicking empty canvas deselects", async ({ page }) => {
    await withCard(page);
    await pickTool(page, "배경 채움");
    await dragImageRect(page, { x: 800, y: 480 }, { x: 900, y: 580 });
    expect(await editor(page)).toMatchObject({ patches: expect.any(Array), past: 1 });
    expect((await editor(page)).patches).toHaveLength(1);

    const on = await clientOf(page, spot.x, spot.y);
    await page.mouse.click(on.x, on.y);
    await expect(page.getByTestId("patch-color")).toBeVisible();
    const off = await clientOf(page, EMPTY.x, EMPTY.y);
    await page.mouse.click(off.x, off.y);
    await expect(page.getByTestId("patch-color")).toHaveCount(0);
  });
});

test.describe("project files", () => {
  test("bad files are refused with a message and change nothing", async ({ page }) => {
    await withCard(page);
    const before = await editor(page);
    const alert = page.locator("aside").first().getByRole("alert");

    await openProjectFile(page, "{nope");
    await expect(alert).toContainText("JSON");
    await openProjectFile(page, JSON.stringify({ format: "other" }));
    await expect(alert).toContainText("프로젝트 파일");

    const good = JSON.parse(await saveProjectFile(page));
    good.project.screens.push(structuredClone(good.project.screens[0]));
    await openProjectFile(page, JSON.stringify(good));
    await expect(alert).toContainText("1개");

    good.project.screens.pop();
    good.project.screens[0].layers[0].imageId = "blob:http://localhost/1";
    await openProjectFile(page, JSON.stringify(good));
    await expect(alert).toContainText("imageId");

    expect((await editor(page)).layers).toEqual(before.layers);
  });

  test("opening prunes the blob store (only after the open); saving does not", async ({ page }) => {
    await withCard(page, true);
    const text = await saveProjectFile(page);
    const referenced = Object.keys(JSON.parse(text).images).sort();
    expect((await idbKeys(page)).sort()).toEqual(referenced); // saving wrote exactly what the project uses

    await page.getByRole("button", { name: "삭제" }).click(); // delete a layer, then save again
    await saveProjectFile(page);
    expect((await idbKeys(page)).sort()).toEqual(referenced); // its bitmap is still there, so undo/redo keep working
    await topBar(page, /실행 취소/).click();
    expect((await editor(page)).layers).toHaveLength(2);

    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const open = indexedDB.open("screenshot-layer-canvas");
          open.onsuccess = () => {
            const tx = open.result.transaction("blobs", "readwrite");
            tx.objectStore("blobs").put(new Blob(["stale"]), "stale-from-an-earlier-session");
            tx.oncomplete = () => (open.result.close(), resolve());
          };
        }),
    );
    expect(await idbKeys(page)).toContain("stale-from-an-earlier-session");
    await openProjectFile(page, text);
    await page.getByRole("button", { name: "새로 불러오기" }).click(); // the undo made the state differ from the last save, so it asks
    await expect.poll(async () => (await idbKeys(page)).sort()).toEqual(referenced);
  });

  test("replacing a project asks only when there are unsaved edits", async ({ page }) => {
    await withCard(page);
    await saveProjectFile(page);
    await page.getByTestId("file-input").setInputFiles({ name: "x.png", mimeType: "image/png", buffer: (await import("./helpers")).encodePng((await import("./helpers")).blank(50, 50, [1, 2, 3, 255])) });
    await expect(page.getByTestId("screen-label")).toContainText("50 × 50"); // saved, so no question

    await uploadPng(page, pageWithCard());
    await zoomTo(page, 1, 600, 300);
    await pickTool(page, "영역 추출");
    await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
    await page.getByTestId("file-input").setInputFiles({ name: "x.png", mimeType: "image/png", buffer: (await import("./helpers")).encodePng((await import("./helpers")).blank(50, 50, [1, 2, 3, 255])) });
    await expect(page.getByRole("alertdialog")).toBeVisible(); // unsaved edits: asks
  });

  test("a saved and re-opened project can be edited further and saved again", async ({ page }) => {
    await withCard(page);
    const text = await saveProjectFile(page);
    await reloadAndDiscard(page);
    await openProjectFile(page, text);
    await expect(page.getByTestId("layer-item")).toHaveCount(1);
    expect((await editor(page)).selected).toEqual([]); // nothing is selected right after opening
    await page.getByTestId("layer-item").click();
    await page.getByRole("button", { name: "복제" }).click();
    await dragLayerBy(page, { x: CARD.x + 16 + 100, y: CARD.y + 16 + 60 }, 50, 0);
    const again = JSON.parse(await saveProjectFile(page));
    expect(again.project.screens[0].layers).toHaveLength(2);
    expect(Object.keys(again.images)).toHaveLength(2); // the copy shares its original's bitmap
  });
});
