import { Page, expect, test } from "@playwright/test";
import { CARD, PAGE, blank, dragImageRect, editor, encodePng, openApp, pageWithCard, pickTool, uploadPng, zoomTo } from "./helpers";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/** puts an image on the real clipboard, then presses Ctrl+V */
async function pasteImage(page: Page, png: Buffer, type = "image/png") {
  await page.evaluate(
    async ([b64, mime]) => {
      window.focus();
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await navigator.clipboard.write([new ClipboardItem({ [mime]: new Blob([bytes], { type: mime }) })]);
    },
    [png.toString("base64"), type],
  );
  await page.keyboard.press("Control+V");
}

/** a paste event carrying a file, for types the real clipboard will not hold */
const syntheticPaste = (page: Page, name: string, type: string) =>
  page.evaluate(
    ([n, t]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([1, 2, 3])], n, { type: t }));
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    },
    [name, type],
  );

test.describe("paste an image (Ctrl+V)", () => {
  test("a PNG on the clipboard becomes the screen, at its own size", async ({ page }) => {
    await openApp(page);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await pasteImage(page, encodePng(pageWithCard()));
    await expect(page.getByTestId("screen-label")).toContainText(`${PAGE.width} × ${PAGE.height} px`);
    expect((await editor(page)).screen).toMatchObject({ width: PAGE.width, height: PAGE.height });
    await expect(page.getByTestId("source-name")).toContainText("image.png");
  });

  test("a different size pastes at that size", async ({ page }) => {
    await openApp(page);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await pasteImage(page, encodePng(blank(375, 812, [240, 240, 240, 255])));
    await expect(page.getByTestId("screen-label")).toContainText("375 × 812 px");
  });

  test("with unsaved edits it asks first; cancelling keeps the work, confirming replaces it", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    await zoomTo(page, 1, 600, 300);
    await pickTool(page, "영역 추출");
    await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
    expect((await editor(page)).layers).toHaveLength(1);

    await pasteImage(page, encodePng(blank(100, 100, [1, 2, 3, 255])));
    await expect(page.getByRole("alertdialog")).toContainText("image.png");
    await page.getByRole("button", { name: "취소", exact: true }).click();
    expect((await editor(page)).layers).toHaveLength(1);
    await expect(page.getByTestId("screen-label")).toContainText(`${PAGE.width} × ${PAGE.height}`);

    await pasteImage(page, encodePng(blank(100, 100, [1, 2, 3, 255])));
    await page.getByRole("button", { name: "새로 불러오기" }).click();
    await expect(page.getByTestId("screen-label")).toContainText("100 × 100");
    expect((await editor(page)).layers).toHaveLength(0);
  });

  test("text on the clipboard is ignored, and the screen is left alone", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.evaluate(() => navigator.clipboard.writeText("just some text"));
    await page.keyboard.press("Control+V");
    await page.waitForTimeout(300);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByTestId("screen-label")).toContainText(`${PAGE.width} × ${PAGE.height}`);
  });

  test("an image type that is not PNG/JPG is refused with the usual message", async ({ page }) => {
    await openApp(page);
    await syntheticPaste(page, "pasted.webp", "image/webp");
    await expect(page.locator("aside").first().getByRole("alert")).toContainText("PNG 또는 JPG");
    await expect(page.getByTestId("screen-label")).toHaveCount(0);
  });

  test("a corrupt image is refused with the usual message", async ({ page }) => {
    await openApp(page);
    await syntheticPaste(page, "broken.png", "image/png");
    await expect(page.locator("aside").first().getByRole("alert")).toContainText("읽을 수 없습니다");
  });
});
