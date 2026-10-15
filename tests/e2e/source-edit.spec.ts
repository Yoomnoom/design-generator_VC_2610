import { Page, expect, test } from "@playwright/test";
import { BLUE, CARD, GRAY, PAGE, clientOf, drawStroke, dragImageRect, editor, exportPngBytes, idbKeys, openApp, openProjectFile, pageWithCard, pickTool, pngPixelAt, readPngSize, saveProjectFile, screenPixel, sourceHash, uploadPng, waitForAutosave, zoomTo } from "./helpers";

const LOCKED = "잠긴 원본입니다. 잠금을 풀면 수정할 수 있습니다";

const src = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__slc.getState();
    const screen = s.history?.present.screens[0];
    if (!screen) return { imageId: "", originalImageId: null as string | null, unlocked: false, past: 0, layers: 0, selected: false, notice: null as string | null, images: 0 };
    return { imageId: screen.source.imageId as string, originalImageId: (screen.source.originalImageId ?? null) as string | null, unlocked: (screen.source.unlocked ?? false) as boolean, past: s.history.past.length as number, layers: screen.layers.length as number, selected: s.sourceSelected as boolean, notice: (s.notice ?? null) as string | null, images: s.images.size as number };
  });
const hashOf = (page: Page, which: "current" | "original") =>
  page.evaluate(async (w) => {
    const s = (window as any).__slc.getState();
    const source = s.history.present.screens[0].source;
    const raw = s.images.get(w === "original" ? source.originalImageId ?? source.imageId : source.imageId).raw;
    const digest = await crypto.subtle.digest("SHA-256", raw.data);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }, which);
const setStyle = (page: Page, change: Record<string, unknown>) => page.evaluate((c) => (window as any).__slc.getState().setDrawStyle(c), change);

async function withProject(page: Page) {
  await openApp(page);
  await uploadPng(page, pageWithCard());
  await zoomTo(page, 1, 600, 400);
  await expect(page.getByTestId("source-row")).toBeVisible();
}
const unlockAndSelect = async (page: Page) => {
  await page.getByTestId("source-lock").click();
  await expect(page.getByTestId("source-row")).toHaveAttribute("data-locked", "false");
  await page.getByTestId("source-item").click();
  await expect(page.getByTestId("source-row")).toHaveAttribute("data-selected", "true");
};

test.describe("the original picture: lock", () => {
  test("a new project shows the 'background (original)' row, locked; the lock toggles and is saved", async ({ page }) => {
    await withProject(page);
    const row = page.getByTestId("source-row");
    await expect(row).toContainText("배경(원본)");
    await expect(row).toHaveAttribute("data-locked", "true");
    await expect(page.getByTestId("source-lock")).toHaveAttribute("aria-pressed", "true");
    expect((await src(page)).unlocked).toBe(false);

    await page.getByTestId("source-lock").click();
    await expect(row).toHaveAttribute("data-locked", "false");
    await expect(page.getByTestId("source-lock")).toHaveAttribute("aria-pressed", "false");
    const file = await saveProjectFile(page);
    const doc = JSON.parse(file);
    expect(doc.project.version).toBe(13);
    expect(doc.project.screens[0].source.unlocked).toBe(true);
    expect(doc.project.screens[0].source.originalImageId).toBeUndefined(); // never edited: no second picture

    // opening the saved file keeps it unlocked; a project that was saved locked opens locked
    await openProjectFile(page, file);
    await expect(page.getByTestId("source-row")).toHaveAttribute("data-locked", "false");
    await page.getByTestId("source-lock").click();
    const locked = await saveProjectFile(page);
    expect(JSON.parse(locked).project.screens[0].source.unlocked).toBeUndefined();
    await openProjectFile(page, locked);
    await expect(page.getByTestId("source-row")).toHaveAttribute("data-locked", "true");
  });

  test("the lock survives a reload (temporary save)", async ({ page }) => {
    await withProject(page);
    await page.getByTestId("source-lock").click();
    await waitForAutosave(page);
    await page.reload();
    await expect(page.getByTestId("restore-dialog")).toBeVisible();
    await page.getByRole("button", { name: "복원" }).click();
    await expect(page.getByTestId("source-row")).toHaveAttribute("data-locked", "false");
  });

  test("locked: the brush, finger and liquify say so and change nothing; the eraser too", async ({ page }) => {
    await withProject(page);
    await page.getByTestId("source-item").click();
    await expect(page.getByTestId("source-locked-note")).toContainText(LOCKED);
    const hash = await sourceHash(page);
    const past = (await src(page)).past;
    for (const tool of ["브러시", "손가락", "유동화"] as const) {
      await pickTool(page, tool);
      await expect(page.getByTestId("tool-hint")).toContainText(LOCKED);
      await page.evaluate(() => (window as any).__slc.getState().setNotice(null));
      await dragImageRect(page, { x: 450, y: 450 }, { x: 560, y: 470 });
      await expect.poll(async () => (await src(page)).notice).toContain(LOCKED);
    }
    expect(await sourceHash(page)).toBe(hash);
    const after = await src(page);
    expect(after.past).toBe(past);
    expect(after.layers).toBe(0);
    await page.getByTestId("source-row").screenshot({ path: "test-results/source-row-locked.png" });
  });

  test("while comparing the lock cannot be changed", async ({ page }) => {
    await withProject(page);
    await page.getByRole("button", { name: "원본", exact: true }).click();
    await expect(page.getByTestId("source-lock")).toBeDisabled();
    await page.getByRole("button", { name: "수정본", exact: true }).click();
    await expect(page.getByTestId("source-lock")).toBeEnabled();
  });
});

test.describe("the original picture: editing", () => {
  test("the brush paints the original: one undo step, a new image, the uploaded picture kept and shown by the comparison view", async ({ page }) => {
    await withProject(page);
    const uploaded = await hashOf(page, "current");
    await unlockAndSelect(page);
    await setStyle(page, { stroke: "#ff0000", strokeWidth: 14 });
    const before = await src(page);
    await drawStroke(page, "브러시", [{ x: 450, y: 500 }, { x: 560, y: 500 }]);
    const after = await src(page);
    expect(after.past).toBe(before.past + 1);
    expect(after.layers).toBe(0); // no brush layer was made
    expect(after.originalImageId).toBe(before.imageId);
    expect(after.imageId).not.toBe(before.imageId);
    expect(await hashOf(page, "current")).not.toBe(uploaded);
    expect(await hashOf(page, "original")).toBe(uploaded); // the uploaded picture is untouched
    await expect(page.getByTestId("source-state")).toContainText("수정됨");
    expect(await screenPixel(page, 500, 500)).toEqual([255, 0, 0, 255]);

    // the PNG is the modified picture at the original size; the comparison view's "original" is the uploaded one
    const png = await exportPngBytes(page);
    expect(readPngSize(png)).toMatchObject({ width: PAGE.width, height: PAGE.height });
    expect(await pngPixelAt(page, png, 500, 500)).toEqual([255, 0, 0, 255]);
    expect(await pngPixelAt(page, png, 100, 100)).toEqual(GRAY);
    await page.getByRole("button", { name: "원본", exact: true }).click();
    expect(await screenPixel(page, 500, 500)).toEqual(GRAY);
    await page.getByRole("button", { name: "나란히", exact: true }).click();
    await page.screenshot({ path: "test-results/source-edit-split.png" });
    await page.getByRole("button", { name: "수정본", exact: true }).click();
    expect(await screenPixel(page, 500, 500)).toEqual([255, 0, 0, 255]);

    // one undo takes the stroke back; the picture is the uploaded one again
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await src(page)).originalImageId).toBeNull();
    expect(await hashOf(page, "current")).toBe(uploaded);
    expect(await screenPixel(page, 500, 500)).toEqual(GRAY);
  });

  test("the eraser refuses the original, with the reason", async ({ page }) => {
    await withProject(page);
    await unlockAndSelect(page);
    await pickTool(page, "지우개");
    await expect(page.getByTestId("tool-hint")).toContainText("구멍");
    const past = (await src(page)).past;
    await dragImageRect(page, { x: 400, y: 250 }, { x: 450, y: 260 });
    await expect.poll(async () => (await src(page)).notice).toContain("지우개는 원본에 쓸 수 없습니다");
    expect((await src(page)).past).toBe(past);
  });

  test("the finger smudges the original across the card's edge (one step), and undo restores it", async ({ page }) => {
    await withProject(page);
    await unlockAndSelect(page);
    const uploaded = await hashOf(page, "current");
    const past = (await src(page)).past;
    expect(await screenPixel(page, CARD.x + CARD.width + 20, CARD.y + 60)).toEqual(GRAY);
    await pickTool(page, "손가락");
    await dragImageRect(page, { x: CARD.x + CARD.width - 30, y: CARD.y + 60 }, { x: CARD.x + CARD.width + 60, y: CARD.y + 60 });
    await expect.poll(async () => (await src(page)).past).toBe(past + 1);
    expect(await hashOf(page, "current")).not.toBe(uploaded);
    expect(await hashOf(page, "original")).toBe(uploaded);
    expect((await src(page)).layers).toBe(0);
    expect((await screenPixel(page, CARD.x + CARD.width + 20, CARD.y + 60))[0]).toBeLessThan(200); // the blue was dragged out of the card (no longer grey)
    await page.keyboard.press("Control+z");
    await expect.poll(async () => hashOf(page, "current")).toBe(uploaded);
  });

  test("liquify pushes the original's shape (one step)", async ({ page }) => {
    await withProject(page);
    await unlockAndSelect(page);
    const uploaded = await hashOf(page, "current");
    const past = (await src(page)).past;
    await pickTool(page, "유동화");
    await dragImageRect(page, { x: CARD.x + CARD.width - 20, y: CARD.y + 60 }, { x: CARD.x + CARD.width + 50, y: CARD.y + 60 });
    await expect.poll(async () => (await src(page)).past).toBe(past + 1);
    expect(await hashOf(page, "current")).not.toBe(uploaded);
    expect(await hashOf(page, "original")).toBe(uploaded);
  });

  test("image adjustment: applied to the original on 'apply', one undo step", async ({ page }) => {
    await withProject(page);
    await unlockAndSelect(page);
    const uploaded = await hashOf(page, "current");
    const past = (await src(page)).past;
    await page.getByTestId("source-adjust").locator("summary").click();
    await page.getByTestId("src-adj-brightness").fill("60");
    await page.getByTestId("src-adj-apply").click();
    await expect.poll(async () => (await src(page)).past).toBe(past + 1);
    expect(await hashOf(page, "current")).not.toBe(uploaded);
    expect(await hashOf(page, "original")).toBe(uploaded);
    const gray = await screenPixel(page, 450, 450);
    expect(gray[0]).toBeGreaterThan(240); // brighter than the uploaded 240
    await page.keyboard.press("Control+z");
    await expect.poll(async () => hashOf(page, "current")).toBe(uploaded);
  });

  test("an extraction cuts from the edited original", async ({ page }) => {
    await withProject(page);
    await unlockAndSelect(page);
    await setStyle(page, { stroke: "#00ff00", strokeWidth: 60 });
    await drawStroke(page, "브러시", [{ x: CARD.x + 40, y: CARD.y + 60 }, { x: CARD.x + 200, y: CARD.y + 60 }]);
    await expect.poll(async () => (await src(page)).originalImageId).not.toBeNull();
    await pickTool(page, "영역 추출");
    await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
    await expect.poll(async () => (await editor(page)).layers.length).toBe(1);
    const px = await page.evaluate(() => {
      const s = (window as any).__slc.getState();
      const l = s.history.present.screens[0].layers[0];
      const raw = s.images.get(l.imageId).raw;
      const i = (60 * raw.width + 100) * 4;
      return Array.from(raw.data.slice(i, i + 4)) as number[];
    });
    expect(px).toEqual([0, 255, 0, 255]); // the paint on the original is in the layer
  });

  test("'back to the original' restores the uploaded picture in one undo step; undo brings the edits back", async ({ page }) => {
    await withProject(page);
    await unlockAndSelect(page);
    const uploaded = await hashOf(page, "current");
    await setStyle(page, { stroke: "#ff0000", strokeWidth: 14 });
    await drawStroke(page, "브러시", [{ x: 450, y: 500 }, { x: 560, y: 500 }]);
    await drawStroke(page, "브러시", [{ x: 450, y: 540 }, { x: 560, y: 540 }]);
    await expect.poll(async () => (await src(page)).past).toBeGreaterThanOrEqual(3);
    const edited = await hashOf(page, "current");
    const past = (await src(page)).past;
    await page.getByTestId("source-revert").click();
    await expect.poll(async () => (await src(page)).originalImageId).toBeNull();
    expect((await src(page)).past).toBe(past + 1);
    expect(await hashOf(page, "current")).toBe(uploaded);
    await expect(page.getByTestId("source-revert")).toBeDisabled();
    await page.keyboard.press("Control+z");
    await expect.poll(async () => hashOf(page, "current")).toBe(edited);
  });

  test("never edited: the saved file holds one picture for the page (no duplicate); edited: the uploaded one is saved too, and the file opens", async ({ page }) => {
    await withProject(page);
    const plain = JSON.parse(await saveProjectFile(page));
    expect(Object.keys(plain.images)).toHaveLength(1);
    await unlockAndSelect(page);
    await setStyle(page, { stroke: "#ff0000", strokeWidth: 14 });
    await drawStroke(page, "브러시", [{ x: 450, y: 500 }, { x: 560, y: 500 }]);
    const text = await saveProjectFile(page);
    const doc = JSON.parse(text);
    const s = doc.project.screens[0].source;
    expect(s.originalImageId).toBeTruthy();
    expect(Object.keys(doc.images)).toEqual(expect.arrayContaining([s.imageId, s.originalImageId]));
    expect(Object.keys(doc.images)).toHaveLength(2);
    await openProjectFile(page, text);
    await expect.poll(async () => (await src(page)).originalImageId).toBe(s.originalImageId);
    expect(await screenPixel(page, 500, 500)).toEqual([255, 0, 0, 255]);
    await page.getByRole("button", { name: "원본", exact: true }).click();
    expect(await screenPixel(page, 500, 500)).toEqual(GRAY);
  });

  test("a temporary save keeps both pictures: restore brings back the edit and the uploaded original", async ({ page }) => {
    await withProject(page);
    await unlockAndSelect(page);
    await setStyle(page, { stroke: "#ff0000", strokeWidth: 14 });
    await drawStroke(page, "브러시", [{ x: 450, y: 500 }, { x: 560, y: 500 }]);
    await waitForAutosave(page);
    const keys = await idbKeys(page);
    const s = await src(page);
    expect(keys).toEqual(expect.arrayContaining([s.imageId, s.originalImageId!]));
    await page.reload();
    await expect(page.getByTestId("restore-dialog")).toBeVisible();
    await page.getByRole("button", { name: "복원" }).click();
    await expect.poll(async () => (await src(page)).originalImageId).toBe(s.originalImageId);
    expect(await screenPixel(page, 500, 500)).toEqual([255, 0, 0, 255]);
  });

  test("another tab cannot delete the first tab's saved pictures, the uploaded original included", async ({ page, context }) => {
    await withProject(page);
    await unlockAndSelect(page);
    await setStyle(page, { stroke: "#ff0000", strokeWidth: 14 });
    await drawStroke(page, "브러시", [{ x: 450, y: 500 }, { x: 560, y: 500 }]);
    await waitForAutosave(page);
    const keys = await idbKeys(page);
    const file = await saveProjectFile(page);
    const other = await context.newPage();
    await openApp(other);
    await expect(other.getByTestId("autosave-status")).toHaveAttribute("data-ownership", "other-tab");
    await uploadPng(other, pageWithCard(), "other.png");
    await openProjectFile(other, file, "mine.slc.json");
    await other.waitForTimeout(400);
    const confirm = other.getByRole("button", { name: "새로 불러오기" });
    if (await confirm.isVisible()) await confirm.click();
    await other.waitForTimeout(1500);
    expect(await idbKeys(other)).toEqual(keys);
    await other.close();
  });

  test("zoom 200%: the same edit lands on the same pixels in the PNG", async ({ page }) => {
    await withProject(page);
    await unlockAndSelect(page);
    await setStyle(page, { stroke: "#ff0000", strokeWidth: 10 });
    await zoomTo(page, 2, 500, 500);
    await drawStroke(page, "브러시", [{ x: 450, y: 500 }, { x: 540, y: 500 }]);
    await expect.poll(async () => (await src(page)).originalImageId).not.toBeNull();
    const png = await exportPngBytes(page);
    for (const [x, y] of [[450, 500], [500, 500], [540, 500], [500, 495]] as const) {
      expect(await pngPixelAt(page, png, x, y)).toEqual(await screenPixel(page, x, y));
    }
    expect(await pngPixelAt(page, png, 500, 480)).toEqual(GRAY);
  });
});

test.describe("the original picture at device pixel ratio 2", () => {
  test.use({ deviceScaleFactor: 2 });
  test("brush on the original: the screen and the PNG agree, the PNG keeps the page size", async ({ page }) => {
    await withProject(page);
    await unlockAndSelect(page);
    await setStyle(page, { stroke: "#ff0000", strokeWidth: 12 });
    await drawStroke(page, "브러시", [{ x: 450, y: 500 }, { x: 560, y: 500 }]);
    await expect.poll(async () => (await src(page)).originalImageId).not.toBeNull();
    const png = await exportPngBytes(page);
    expect(readPngSize(png)).toMatchObject({ width: PAGE.width, height: PAGE.height });
    for (const [x, y] of [[450, 500], [505, 500], [555, 500]] as const) expect(await pngPixelAt(page, png, x, y)).toEqual(await screenPixel(page, x, y));
    await page.getByTestId("source-row").screenshot({ path: "test-results/source-row-dpr2.png" });
  });
});

test("the panel with the source row: no overlap or cut-off (screenshot)", async ({ page }) => {
  await withProject(page);
  await pickTool(page, "영역 추출");
  await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
  await expect.poll(async () => (await editor(page)).layers.length).toBe(1);
  await unlockAndSelect(page);
  await page.screenshot({ path: "test-results/source-edit-panel.png" });
  const row = await page.getByTestId("source-row").boundingBox();
  const aside = await page.getByTestId("source-row").locator("xpath=ancestor::aside").boundingBox();
  expect(row!.x).toBeGreaterThanOrEqual(aside!.x);
  expect(row!.x + row!.width).toBeLessThanOrEqual(aside!.x + aside!.width + 1);
  await expect(page.getByTestId("source-edit-panel")).toBeVisible();
});
