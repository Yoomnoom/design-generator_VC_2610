import { Page, expect, test } from "@playwright/test";
import { CARD, dragImageRect, openApp, pageWithCard, pickTool, uploadPng, zoomTo } from "./helpers";

const TOOL_NAMES = ["선택", "이동", "영역 추출", "자동 후보", "배경 채움", "선", "사각형", "원", "브러시", "지우개", "텍스트", "메모", "변형", "손가락", "스포이트", "자유 변형"];
const tool = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

test.describe("tool tooltips", () => {
  test("every tool in the rail has a tooltip with what it does, when to use it and the key", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    for (const name of TOOL_NAMES) {
      const title = (await tool(page, name).getAttribute("title")) ?? "";
      expect(title.length, `${name}: ${title}`).toBeGreaterThan(40);
      expect(title, name).toContain(`${name}:`);
    }
    await expect(tool(page, "배경 채움")).toHaveAttribute("title", /추출 후 채워진 자리를 클릭해 색을 바꿉니다. 그림자·그라데이션에서 색이 어색할 때/);
    await expect(tool(page, "영역 추출")).toHaveAttribute("title", /\(M\)$/);
    await expect(tool(page, "지우개")).toHaveAttribute("title", /\(E\)/);
    await expect(tool(page, "선")).toHaveAttribute("title", /U를 반복해서 누르면/);
    await expect(tool(page, "배경 채움")).toHaveAttribute("title", /지금은 쓸 수 없음: 배경 채움: 먼저 영역 추출로 카드를 떼어 낸 뒤, 채워진 자리를 클릭하세요/); // the reason is added to the same tooltip
    await expect(page.getByTestId("asset-panel").locator(".panel-title")).toHaveAttribute("title", /소스·템플릿:/);
  });

  test("the tooltip follows a key changed in the settings", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    await page.getByTestId("open-shortcuts").click();
    await page.getByTestId("shortcut-tool-brush").click();
    await page.keyboard.press("q");
    await page.getByTestId("shortcut-close").click();
    await expect(tool(page, "브러시")).toHaveAttribute("title", /\(Q\)$/);
  });
});

test.describe("help panel", () => {
  test("it lists every tool with its example, the usual problems and the keys of the current preset; the keys follow the preset", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("open-help").click();
    const panel = page.getByTestId("help-panel");
    await expect(panel).toBeVisible();
    for (const id of ["select", "hand", "rect", "auto", "fill", "line", "box", "ellipse", "brush", "eraser", "text", "memo", "warp", "finger", "eyedropper", "free-transform", "sources"]) {
      await expect(page.getByTestId(`help-${id}`)).toBeAttached();
    }
    await expect(page.getByTestId("help-fill")).toContainText("그림자·그라데이션");
    await expect(page.getByTestId("help-eraser")).toContainText("막힐 때");
    await expect(page.getByTestId("help-warp")).toContainText("변형 초기화");
    await expect(page.getByTestId("help-stuck")).toContainText("지우개가 안 지워져요");
    await expect(page.getByTestId("help-keys")).toContainText("Ctrl+J");
    await expect(page.getByTestId("help-rect")).toContainText("M");
    await panel.screenshot({ path: "test-results/help-panel.png" });
    await page.getByTestId("help-close").click();
    await expect(panel).toHaveCount(0);
    await page.getByTestId("open-shortcuts").click();
    await page.getByTestId("preset-legacy").click();
    await page.getByTestId("shortcut-close").click();
    await page.getByTestId("open-help").click();
    await expect(page.getByTestId("help-keys")).toContainText("Ctrl+D");
    await expect(page.getByTestId("help-rect")).toContainText("R");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("help-panel")).toHaveCount(0);
  });

  test("with the panel open the editor behind it keeps still", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    await page.getByTestId("open-help").click();
    await page.keyboard.press("b");
    await expect(tool(page, "브러시")).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("first-use guide", () => {
  test("it shows on the first visit with four steps, can be stepped through, and does not come back after it is answered", async ({ page }) => {
    await openApp(page);
    const guide = page.getByTestId("onboarding");
    await expect(guide).toBeVisible();
    await expect(page.getByTestId("onboarding-body")).toContainText("빈 캔버스");
    await page.screenshot({ path: "test-results/onboarding.png" });
    await page.getByTestId("onboarding-next").click();
    await expect(page.getByTestId("onboarding-body")).toContainText("영역 추출");
    await page.getByTestId("onboarding-prev").click();
    await expect(page.getByTestId("onboarding-body")).toContainText("빈 캔버스");
    for (let i = 0; i < 3; i++) await page.getByTestId("onboarding-next").click();
    await expect(page.getByTestId("onboarding-body")).toContainText("PNG");
    await page.getByTestId("onboarding-done").click();
    await expect(guide).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("start-choices")).toBeVisible();
    await expect(page.getByTestId("onboarding")).toHaveCount(0); // once only
    // the help can bring it back, as a window
    await page.getByTestId("open-help").click();
    await page.getByTestId("help-guide").click();
    await expect(page.getByRole("dialog", { name: "처음 사용 안내" })).toBeVisible();
    await page.getByTestId("onboarding-skip").click();
    await expect(page.getByRole("dialog", { name: "처음 사용 안내" })).toHaveCount(0);
  });

  test("skipping counts as answered; a visit with a project already open has no card to get in the way", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("onboarding-skip").click();
    await page.reload();
    await expect(page.getByTestId("onboarding")).toHaveCount(0);
    await uploadPng(page, pageWithCard());
    await zoomTo(page, 1, 600, 330);
    await pickTool(page, "영역 추출");
    await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
    await expect(page.getByTestId("onboarding")).toHaveCount(0);
  });
});