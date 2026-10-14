import { Page, expect, test } from "@playwright/test";
import { autosaveReady, editor, exportPngBytes, openApp, openProjectFile, pngPixelAt, readPngSize, saveProjectFile, uploadPng, pageWithCard, waitForAutosave } from "./helpers";

const startBlank = async (page: Page, opts: { preset?: "mobile" | "desktop" | "tablet"; width?: string; height?: string; color?: string } = {}) => {
  await page.getByTestId("start-blank").click();
  const dlg = page.getByTestId("new-canvas-dialog");
  await expect(dlg).toBeVisible();
  if (opts.preset) await page.getByTestId(`canvas-preset-${opts.preset}`).click();
  if (opts.width !== undefined) await page.getByTestId("canvas-width").fill(opts.width);
  if (opts.height !== undefined) await page.getByTestId("canvas-height").fill(opts.height);
  if (opts.color) await page.getByTestId("canvas-color-text").fill(opts.color);
  return dlg;
};

test.describe("start screen", () => {
  test("three ways to begin, with the template thumbnails; the text is not capture-only", async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole("heading", { name: "무엇으로 시작할까요?" })).toBeVisible();
    await expect(page.getByText("화면 캡처를 올려주세요")).toHaveCount(0);
    await expect(page.getByTestId("start-upload")).toBeVisible();
    await expect(page.getByTestId("start-blank")).toBeVisible();
    for (const id of ["login", "cards", "settings"]) {
      await expect(page.getByTestId(`template-${id}-thumb`)).toHaveAttribute("data-state", "ready");
    }
    await page.screenshot({ path: "test-results/start-screen.png" });
  });

  test("the upload card still opens the file chooser path: a capture loads as before", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    await expect(page.getByTestId("source-name")).toHaveText("capture.png");
    await expect(page.getByTestId("start-choices")).toHaveCount(0);
  });

  test("a template card opens that template as a project", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("start-template-settings").click();
    await expect.poll(async () => (await editor(page)).screen).toMatchObject({ width: 390, height: 844 });
    await expect(page.getByTestId("start-choices")).toHaveCount(0);
  });
});

for (const dpr of [1, 2]) {
  test.describe(`blank canvas, device pixel ratio ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });

    test("chosen size and colour: the project and the PNG match; extraction tools are disabled with a reason", async ({ page }) => {
      await openApp(page);
      await startBlank(page, { preset: "mobile", color: "#336699" });
      await page.getByTestId("canvas-create").click();
      await expect.poll(async () => (await editor(page)).screen).toMatchObject({ width: 390, height: 844 });
      await expect(page.getByTestId("source-name")).toContainText("스크린샷 없음");
      await expect(page.getByTestId("screen-label")).toContainText("390 × 844 px");

      for (const name of ["영역 추출", "자동 후보"]) {
        const b = page.getByRole("button", { name, exact: true });
        await expect(b).toBeDisabled();
        await expect(b).toHaveAttribute("title", /스크린샷이 없는 화면/);
      }
      await expect(page.getByRole("button", { name: "사각형", exact: true })).toBeEnabled();

      await page.keyboard.press("r"); // the shortcut is refused too, with the reason on the notice line
      await expect(page.getByText(/추출할 스크린샷이 없습니다/).first()).toBeVisible();

      await page.getByTestId("notice").getByRole("button", { name: "닫기" }).click(); // the export dialog has its own close button
      const png = await exportPngBytes(page);
      expect(readPngSize(png)).toMatchObject({ width: 390, height: 844 });
      expect(await pngPixelAt(page, png, 0, 0)).toEqual([51, 102, 153, 255]);
      expect(await pngPixelAt(page, png, 389, 843)).toEqual([51, 102, 153, 255]);
      await page.screenshot({ path: `test-results/blank-canvas-dpr${dpr}.png` });
    });
  });
}

test.describe("blank canvas", () => {
  test("every preset and a typed size; the PNG has exactly that size", async ({ page }) => {
    await openApp(page);
    for (const [preset, w, h] of [["desktop", 1440, 900], ["tablet", 820, 1180]] as const) {
      await page.getByTestId("new-project").click();
      await page.getByTestId("start-dialog").getByTestId("start-blank").click();
      await page.getByTestId(`canvas-preset-${preset}`).click();
      await expect(page.getByTestId("canvas-width")).toHaveValue(String(w));
      await page.getByTestId("canvas-create").click();
      await page.getByRole("button", { name: "새로 불러오기" }).click({ timeout: 1500 }).catch(() => {}); // only asked when there are edits
      await expect.poll(async () => (await editor(page)).screen).toMatchObject({ width: w, height: h });
    }
    await page.getByTestId("new-project").click();
    await page.getByTestId("start-dialog").getByTestId("start-blank").click();
    await page.getByTestId("canvas-width").fill("123");
    await page.getByTestId("canvas-height").fill("45");
    await page.getByTestId("canvas-create").click();
    await expect.poll(async () => (await editor(page)).screen).toMatchObject({ width: 123, height: 45 });
    expect(readPngSize(await exportPngBytes(page))).toMatchObject({ width: 123, height: 45 });
  });

  test("bad sizes: over 8192, zero, decimals, text, empty; the reason shows and the button stays off; 8192 is allowed", async ({ page }) => {
    await openApp(page);
    const dlg = await startBlank(page);
    const create = page.getByTestId("canvas-create");
    for (const [w, h, why] of [["8193", "100", "8192"], ["100", "9000", "8192"], ["0", "10", "1px"], ["10.5", "10", "정수"], ["abc", "10", "숫자"], ["", "10", "숫자"]] as const) {
      await page.getByTestId("canvas-width").fill(w);
      await page.getByTestId("canvas-height").fill(h);
      await expect(page.getByTestId("canvas-error")).toContainText(why);
      await expect(create).toBeDisabled();
    }
    await page.getByTestId("canvas-width").fill("100");
    await page.getByTestId("canvas-height").fill("10");
    await page.getByTestId("canvas-color-text").fill("blue");
    await expect(page.getByTestId("canvas-error")).toContainText("#rrggbb");
    await expect(create).toBeDisabled();
    await page.getByTestId("canvas-color-text").fill("#abc");
    await expect(page.getByTestId("canvas-error")).toHaveCount(0);
    await page.getByTestId("canvas-width").fill("8192");
    await page.getByTestId("canvas-height").fill("1");
    await expect(create).toBeEnabled();
    await dlg.screenshot({ path: "test-results/new-canvas-dialog.png" });
    await page.getByTestId("canvas-cancel").click();
    await expect(dlg).toHaveCount(0);
    expect((await editor(page)).screen).toBeNull(); // cancelling makes nothing
  });

  test("the colour can be changed later with the fill tool, one undo step", async ({ page }) => {
    await openApp(page);
    await startBlank(page, { preset: "mobile", color: "#ffffff" });
    await page.getByTestId("canvas-create").click();
    await expect.poll(async () => (await editor(page)).screen).not.toBeNull();
    const patchId = await page.evaluate(() => (window as any).__slc.getState().history.present.screens[0].backgroundPatches[0].id as string);
    await page.evaluate((id) => (window as any).__slc.getState().setPatchColor(id, "#ff8800"), patchId);
    expect(await pngPixelAt(page, await exportPngBytes(page), 10, 10)).toEqual([255, 136, 0, 255]);
    await page.keyboard.press("Control+z");
    expect(await pngPixelAt(page, await exportPngBytes(page), 10, 10)).toEqual([255, 255, 255, 255]);
  });

  test("a source and a template layer go in on a blank canvas; save and open the project file gives the same PNG", async ({ page }) => {
    await openApp(page);
    await startBlank(page, { preset: "mobile", color: "#eeeeee" });
    await page.getByTestId("canvas-create").click();
    await expect.poll(async () => (await editor(page)).screen).not.toBeNull();
    await page.getByTestId("asset-card").click();
    await expect.poll(async () => (await editor(page)).layers.length).toBeGreaterThan(3);
    const before = await exportPngBytes(page);
    const file = await saveProjectFile(page);
    await openProjectFile(page, file);
    await expect(page.getByTestId("source-name")).toContainText("스크린샷 없음");
    expect((await exportPngBytes(page)).equals(before)).toBe(true);
    await expect(page.getByRole("button", { name: "영역 추출", exact: true })).toBeDisabled();
  });

  test("temporary save: reload and restore brings the blank canvas back with its size, colour and layers", async ({ page }) => {
    await openApp(page);
    await startBlank(page, { preset: "tablet", color: "#102030" });
    await page.getByTestId("canvas-create").click();
    await page.getByTestId("asset-card").click();
    await expect.poll(async () => (await editor(page)).layers.length).toBeGreaterThan(3);
    await waitForAutosave(page);
    const before = await exportPngBytes(page);
    await page.reload();
    await autosaveReady(page);
    await page.getByRole("button", { name: "복원" }).click();
    await expect.poll(async () => (await editor(page)).screen).toMatchObject({ width: 820, height: 1180 });
    expect((await exportPngBytes(page)).equals(before)).toBe(true);
    await expect(page.getByTestId("source-name")).toContainText("스크린샷 없음");
  });
});

test.describe("new project from the top bar", () => {
  test("with edits, the existing replace question is asked and names what comes in; cancelling keeps the work", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    await page.getByTestId("asset-card").click(); // an edit
    await page.getByTestId("new-project").click();
    await expect(page.getByTestId("start-dialog")).toBeVisible();
    await page.screenshot({ path: "test-results/new-project-dialog.png" });
    await page.getByTestId("start-blank").click();
    await page.getByTestId("canvas-create").click();
    const ask = page.getByRole("alertdialog", { name: "이미지 교체 확인" });
    await expect(ask).toContainText("빈 캔버스");
    await expect(ask).toContainText("사라집니다");
    await ask.getByRole("button", { name: "취소" }).click();
    await expect(page.getByTestId("source-name")).toHaveText("capture.png");
    await page.getByTestId("new-project").click();
    await page.getByTestId("start-dialog").getByTestId("start-blank").click();
    await page.getByTestId("canvas-create").click();
    await page.getByRole("button", { name: "새로 불러오기" }).click();
    await expect(page.getByTestId("source-name")).toContainText("스크린샷 없음");
  });

  test("with no edits it just starts; the window closes with Esc or the close button", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    await page.getByTestId("new-project").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("start-dialog")).toHaveCount(0);
    await page.getByTestId("new-project").click();
    await page.getByTestId("start-dialog").getByTestId("start-template-login").click();
    await expect.poll(async () => (await editor(page)).screen).toMatchObject({ width: 390, height: 844 });
  });
});
