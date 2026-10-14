import { Page, expect, test } from "@playwright/test";
import { CARD, clientOf, dragImageRect, editor, exportPngBytes, openApp, pageWithCard, pngPixelAt, pickTool, screenPixel, uploadPng, zoomTo } from "./helpers";

const tool = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
async function withCard(page: Page) {
  await openApp(page);
  await uploadPng(page, pageWithCard());
  await zoomTo(page, 1, 600, 330);
  await pickTool(page, "영역 추출");
  await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
  await expect.poll(async () => (await editor(page)).layers.length).toBe(1);
  return (await editor(page)).layers[0].id;
}
async function pull(page: Page, p: { x: number; y: number }, q: { x: number; y: number }, steps = 14) {
  const a = await clientOf(page, p.x, p.y);
  const b = await clientOf(page, q.x, q.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
}
const imageId = async (page: Page) => (await editor(page)).layers[0].imageId;

test.describe("liquify tool", () => {
  test("it sits before the finger in the tool bar, has Shift+X, a panel with the four modes, a tooltip and a hint", async ({ page }) => {
    await withCard(page);
    const names = await page.getByRole("navigation", { name: "도구" }).getByRole("button").allInnerTexts();
    const flat = names.map((n) => n.replace(/\s+/g, "").replace(/[^가-힣]/g, ""));
    expect(flat.indexOf("유동화")).toBeGreaterThan(-1);
    expect(flat.indexOf("유동화")).toBe(flat.indexOf("손가락") - 1);
    await expect(tool(page, "유동화")).toHaveAttribute("title", /유동화:.*손가락은 색을 번지게 하고 유동화는 모양을 밀어 바꿉니다.*\(Shift\+X\)/);
    await page.keyboard.press("Shift+x");
    await expect(tool(page, "유동화")).toHaveAttribute("aria-pressed", "true");
    for (const m of ["push", "bloat", "pucker", "restore"]) await expect(page.getByTestId(`liquify-mode-${m}`)).toBeVisible();
    await expect(page.getByTestId("tool-hint")).toHaveAttribute("data-usable", "yes");
    await page.screenshot({ path: "test-results/liquify-panel.png" });
    await page.getByTestId("open-help").click();
    await expect(page.getByTestId("help-liquify")).toContainText("손가락은 색을 번지게 하고 유동화는 모양을 밀어 바꿉니다");
  });

  test("one drag pushes the picture visibly, is ONE undo step, and the screen and the PNG show the same pixels", async ({ page }) => {
    await withCard(page);
    await pickTool(page, "유동화");
    const before = await imageId(page);
    const past = (await editor(page)).past;
    // the card's top-left corner holds a red square: push it to the right across the blue
    const sx = CARD.x + 10, sy = CARD.y + 10;
    expect((await screenPixel(page, sx + 60, sy)).slice(0, 3)).toEqual([0, 0, 255]);
    await pull(page, { x: sx - 15, y: sy }, { x: sx + 90, y: sy });
    await expect.poll(() => imageId(page)).not.toBe(before);
    expect((await editor(page)).past).toBe(past + 1);
    await page.evaluate(() => (window as any).__slc.getState().selectLayer(null));
    const png = await exportPngBytes(page);
    let differing = 0;
    for (const dx of [20, 40, 60, 80]) {
      const p = await pngPixelAt(page, png, sx + dx, sy), s = await screenPixel(page, sx + dx, sy);
      if (p[0] > 60) differing++; // red reached this far
      expect(Math.max(...p.map((v, i) => Math.abs(v - s[i])))).toBeLessThanOrEqual(2);
    }
    expect(differing).toBeGreaterThanOrEqual(1);
    await page.keyboard.press("Control+z");
    await expect.poll(() => imageId(page)).toBe(before);
  });

  test("with no layer chosen the first drag takes the layer under the pointer; over empty page it says what to do", async ({ page }) => {
    await withCard(page);
    await page.evaluate(() => (window as any).__slc.getState().selectLayer(null));
    await pickTool(page, "유동화");
    await pull(page, { x: 700, y: 500 }, { x: 760, y: 520 }); // empty part of the capture
    await expect(page.getByTestId("notice")).toContainText("이미지 레이어 위에서");
    expect((await editor(page)).past).toBe(1);
    await pull(page, { x: CARD.x + 40, y: CARD.y + 60 }, { x: CARD.x + 100, y: CARD.y + 60 });
    await expect.poll(async () => (await editor(page)).past).toBe(2);
  });

  test("a locked layer and a warped layer are refused with the reason; nothing is recorded", async ({ page }) => {
    const id = await withCard(page);
    await pickTool(page, "유동화");
    await page.evaluate((i) => (window as any).__slc.getState().setLayerLocked(i, true), id);
    await pull(page, { x: CARD.x + 40, y: CARD.y + 60 }, { x: CARD.x + 100, y: CARD.y + 60 });
    await expect(page.getByTestId("notice")).toContainText("잠긴");
    await page.evaluate((i) => (window as any).__slc.getState().setLayerLocked(i, false), id);
    await page.evaluate((i) => (window as any).__slc.getState().setLayerWarp(i, { kind: "quad", points: [{ x: 6, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 120 }, { x: 0, y: 120 }] }), id);
    await pull(page, { x: CARD.x + 40, y: CARD.y + 60 }, { x: CARD.x + 100, y: CARD.y + 60 });
    await expect(page.getByTestId("notice")).toContainText("변형 초기화");
    await expect(page.getByTestId("tool-hint")).toHaveAttribute("data-usable", "no");
    expect((await editor(page)).past).toBe(4); // the extraction, the lock, the unlock and the warp: the refused strokes added nothing
  });

  test("bloat and pucker act on a plain press; restore brings a pushed place back", async ({ page }) => {
    await withCard(page);
    await pickTool(page, "유동화");
    const cx = CARD.x + 120, cy = CARD.y + 60;
    await page.getByTestId("liquify-size").evaluate((el: HTMLInputElement) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(el, "180"); el.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.getByTestId("liquify-mode-bloat").click();
    const a = await clientOf(page, cx, cy);
    const id0 = await imageId(page);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(() => imageId(page)).not.toBe(id0); // a bare press already changed the picture
    await page.getByTestId("liquify-mode-pucker").click();
    const id1 = await imageId(page);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(() => imageId(page)).not.toBe(id1);
    await page.getByTestId("liquify-mode-restore").click();
    const id2 = await imageId(page);
    await pull(page, { x: cx - 60, y: cy }, { x: cx + 60, y: cy });
    await expect.poll(() => imageId(page)).not.toBe(id2);
  });
});

test.describe("liquify with a turned and scaled layer at 200% and device pixel ratio 2", () => {
  test.use({ deviceScaleFactor: 2 });
  test("the picture moves along the pointer in the page's frame, whatever the layer's turn", async ({ page }) => {
    const id = await withCard(page);
    await page.evaluate((i) => { const s = (window as any).__slc.getState(); const t = s.history.present.screens[0].layers[0].transform; s.transformLayer(i, { ...t, scaleX: 1.5, scaleY: 1.5, rotation: 30 }); }, id);
    await zoomTo(page, 2, 420, 300);
    await pickTool(page, "유동화");
    const before = await imageId(page);
    // a push along the page's x through the layer's middle
    const l = (await editor(page)).layers[0];
    const mid = { x: l.transform.x + 100, y: l.transform.y + 120 };
    await pull(page, { x: mid.x - 30, y: mid.y }, { x: mid.x + 60, y: mid.y });
    await expect.poll(() => imageId(page)).not.toBe(before);
    expect((await editor(page)).past).toBe(3);
    // undo and redo give the same pictures
    await page.keyboard.press("Control+z");
    await expect.poll(() => imageId(page)).toBe(before);
    await page.keyboard.press("Control+Shift+z");
    await expect.poll(() => imageId(page)).not.toBe(before);
  });
});