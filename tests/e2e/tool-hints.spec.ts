import { Page, expect, test } from "@playwright/test";
import { CARD, dragImageRect, openApp, pageWithCard, pickTool, uploadPng, zoomTo } from "./helpers";

const hint = (page: Page) => page.getByTestId("tool-hint");
const tool = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

test.describe("what each tool says about the current state", () => {
  test("fill: before any extraction the status bar says what to do first; after an extraction it is usable", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    await zoomTo(page, 1, 600, 330);
    await pickTool(page, "배경 채움");
    await expect(hint(page)).toHaveAttribute("data-usable", "no");
    await expect(hint(page)).toContainText("먼저 영역 추출로 카드를 떼어 낸 뒤, 채워진 자리를 클릭하세요");
    await expect(tool(page, "배경 채움")).toHaveAttribute("title", /지금은 쓸 수 없음/);
    await pickTool(page, "영역 추출");
    await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
    await expect.poll(async () => (await page.evaluate(() => (window as any).__slc.getState().history.present.screens[0].backgroundPatches.length))).toBe(1);
    await pickTool(page, "배경 채움");
    await expect(hint(page)).toHaveAttribute("data-usable", "yes");
    await page.screenshot({ path: "test-results/tool-hint-fill.png" });
  });

  test("eraser: says which layer to pick; works on an extracted layer; says why not on a locked one", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    await zoomTo(page, 1, 600, 330);
    await pickTool(page, "지우개");
    await expect(hint(page)).toContainText("이미지 레이어");
    await expect(hint(page)).toHaveAttribute("data-usable", "no");
    await pickTool(page, "영역 추출");
    await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
    await pickTool(page, "지우개");
    await expect(hint(page)).toHaveAttribute("data-usable", "yes");
    await page.getByRole("button", { name: /잠그기/ }).first().click();
    await expect(hint(page)).toContainText("잠긴");
  });

  test("a blank canvas and comparing give their own reasons; the hand and select tools stay usable", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("start-blank").click();
    await page.getByTestId("canvas-create").click();
    await expect.poll(() => page.evaluate(() => (window as any).__slc.getState().history !== null)).toBe(true);
    await page.getByRole("button", { name: "영역 추출", exact: true }).hover();
    await expect(tool(page, "영역 추출")).toHaveAttribute("title", /스크린샷이 없는 화면/);
    await page.getByRole("button", { name: "원본", exact: true }).click();
    await pickTool(page, "브러시");
    await expect(hint(page)).toContainText("비교 보기 중에는 편집할 수 없습니다");
    await pickTool(page, "선택");
    await expect(hint(page)).toHaveAttribute("data-usable", "yes");
  });

  test("with no project every tool is off and the bar says how to begin", async ({ page }) => {
    await openApp(page);
    await expect(hint(page)).toContainText("새 프로젝트");
    await expect(hint(page)).toHaveAttribute("data-usable", "no");
  });
});