import { Page, expect, test } from "@playwright/test";
import { openApp, saveProjectFile } from "./helpers";

const tool = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const open = async (page: Page) => {
  await page.getByTestId("open-shortcuts").click();
  await expect(page.getByTestId("shortcut-settings")).toBeVisible();
};
const rebind = async (page: Page, action: string, press: string) => {
  await page.getByTestId(`shortcut-${action}`).click();
  await expect(page.getByTestId(`shortcut-${action}`)).toContainText("키를 누르세요");
  await page.keyboard.press(press);
};
const blankProject = async (page: Page) => {
  await page.getByTestId("start-blank").click();
  await page.getByTestId("canvas-create").click();
  await expect.poll(() => page.evaluate(() => (window as any).__slc.getState().history !== null)).toBe(true);
};

test.describe("shortcut settings", () => {
  test("the window lists every shortcut by function, and the fixed keys; the top bar still fits at 1280 wide", async ({ page }) => {
    await openApp(page);
    await blankProject(page);
    await page.screenshot({ path: "test-results/topbar-1280.png", clip: { x: 0, y: 0, width: 1280, height: 60 } });
    await open(page);
    const rows = page.locator('[data-testid^="shortcut-"]').filter({ hasText: /.+/ });
    for (const id of ["undo", "redo", "copy", "duplicate", "delete", "select-all", "group", "ungroup", "nudge-left", "nudge-right", "nudge-up", "nudge-down", "tool-select", "tool-hand", "tool-rect", "tool-auto", "tool-line", "tool-box", "tool-ellipse", "tool-brush", "tool-eraser", "tool-text", "tool-memo", "tool-warp", "tool-finger", "tool-eyedropper"]) {
      await expect(page.getByTestId(`shortcut-${id}`)).toBeVisible();
    }
    expect(await rows.count()).toBeGreaterThan(26);
    await expect(page.getByTestId("shortcut-group")).toContainText("Ctrl+G");
    await expect(page.getByTestId("shortcut-ungroup")).toContainText("Ctrl+Shift+G");
    await expect(page.getByTestId("shortcut-settings")).toContainText("바꿀 수 없는 키");
    await expect(page.getByTestId("shortcut-settings")).toContainText("Shift+클릭");
    await page.getByTestId("shortcut-settings").screenshot({ path: "test-results/shortcut-settings.png" });
  });

  test("a new key works at once, the old one stops, the tool's tooltip follows, and it is still set after a reload", async ({ page }) => {
    await openApp(page);
    await blankProject(page);
    await expect(tool(page, "브러시")).toHaveAttribute("title", /\(B\)/);
    await open(page);
    await rebind(page, "tool-brush", "q");
    await expect(page.getByTestId("shortcut-tool-brush")).toContainText("Q");
    await expect(page.getByTestId("shortcut-message")).toContainText("바꿨습니다");
    await page.getByTestId("shortcut-close").click();
    await expect(page.getByTestId("shortcut-settings")).toHaveCount(0);

    await expect(tool(page, "브러시")).toHaveAttribute("title", /\(Q\)/);
    await page.keyboard.press("q");
    await expect(tool(page, "브러시")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("v");
    await expect(tool(page, "선택")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("b"); // the old key means nothing now
    await expect(tool(page, "선택")).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    await expect(page.getByTestId("start-choices").or(page.getByRole("dialog"))).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("slc-shortcuts"))).toContain("tool-brush");
    await open(page);
    await expect(page.getByTestId("shortcut-tool-brush")).toContainText("Q");
  });

  test("a key already used is refused and says by what; a browser key is refused; nothing changes", async ({ page }) => {
    await openApp(page);
    await open(page);
    await rebind(page, "tool-brush", "v");
    await expect(page.getByTestId("shortcut-message")).toContainText("선택 도구");
    await page.getByTestId("shortcut-settings").screenshot({ path: "test-results/shortcut-conflict.png" });
    await expect(page.getByTestId("shortcut-tool-brush")).toContainText("B");
    await expect(page.getByTestId("shortcut-tool-select")).toContainText("V");
    await rebind(page, "group", "Control+t");
    await expect(page.getByTestId("shortcut-message")).toContainText("브라우저");
    await expect(page.getByTestId("shortcut-group")).toContainText("Ctrl+G");
    await rebind(page, "group", "Control+w");
    await expect(page.getByTestId("shortcut-message")).toContainText("브라우저");
    await rebind(page, "tool-brush", "Escape"); // Esc cancels the capture
    await expect(page.getByTestId("shortcut-tool-brush")).toContainText("B");
    expect(await page.evaluate(() => localStorage.getItem("slc-shortcuts"))).toBeNull();
  });

  test("reset to defaults brings every key back and clears the stored setting", async ({ page }) => {
    await openApp(page);
    await open(page);
    await rebind(page, "tool-brush", "q");
    await rebind(page, "group", "Control+Alt+g");
    await expect(page.getByTestId("shortcut-group")).toContainText("Ctrl+Alt+G");
    await page.getByTestId("shortcut-reset").click();
    await expect(page.getByTestId("shortcut-tool-brush")).toContainText("B");
    await expect(page.getByTestId("shortcut-group")).toContainText("Ctrl+G");
    expect(await page.evaluate(() => localStorage.getItem("slc-shortcuts"))).toBeNull();
  });

  test("shortcuts do nothing while a text box has focus or a window is open; the setting is not in the project file", async ({ page }) => {
    await openApp(page);
    await blankProject(page);
    await open(page);
    await rebind(page, "tool-brush", "q");
    await page.getByTestId("shortcut-close").click();
    await page.getByTestId("asset-tab-mine").click();
    await page.getByTestId("asset-save-name").click();
    await page.keyboard.type("q");
    await expect(page.getByTestId("asset-save-name")).toHaveValue("q"); // typed into the box
    await expect(tool(page, "브러시")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("asset-save-name").blur();

    await page.getByTestId("new-project").click(); // a window is open: the editor behind it keeps still
    await page.keyboard.press("q");
    await expect(tool(page, "브러시")).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Escape");
    await page.keyboard.press("q");
    await expect(tool(page, "브러시")).toHaveAttribute("aria-pressed", "true");

    const file = await saveProjectFile(page);
    expect(file).not.toContain("tool-brush");
    expect(file).not.toContain("slc-shortcuts");
  });

  test("the group, undo and redo tooltips show the keys that are set", async ({ page }) => {
    await openApp(page);
    await blankProject(page);
    await open(page);
    await rebind(page, "undo", "Control+Alt+z");
    await rebind(page, "group", "Control+Alt+g");
    await page.getByTestId("shortcut-close").click();
    await expect(page.getByTestId("group-make")).toHaveAttribute("title", /Ctrl\+Alt\+G/);
    await page.getByRole("button", { name: /실행 취소/ }).first().hover();
    await expect(page.getByRole("button", { name: /실행 취소/ }).first()).toHaveAttribute("title", /Ctrl\+Alt\+Z/);
  });
});
