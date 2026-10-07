import { Page, expect, test } from "@playwright/test";
import { CARD, PAGE, clientOf, dragImageRect, dragLayerBy, editor, exportPngBytes, expectPixel, konvaPixel, openApp, pageWithCard, pickTool, pngPixelAt, uploadPng, zoomTo } from "./helpers";

const BLUE = [0, 0, 255, 255];
const GRAY = [240, 240, 240, 255];
const cardCenter = { x: CARD.x + CARD.width / 2, y: CARD.y + CARD.height / 2 };
const MOVE = { dx: 300, dy: 200 };
const oldSpot = { x: CARD.x + 100, y: CARD.y + 60 }; // inside the card where it was cut from
const newSpot = { x: oldSpot.x + MOVE.dx, y: oldSpot.y + MOVE.dy }; // the same point of the card, after it was moved
const GAP = 48; // the app's gap between the two frames, in image pixels

/** a card cut out and moved away: the edited page has gray where it was and blue where it is now */
async function movedCard(page: Page) {
  await openApp(page);
  await uploadPng(page, pageWithCard());
  await zoomTo(page, 1, 600, 300);
  await pickTool(page, "영역 추출");
  await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
  await pickTool(page, "선택");
  await dragLayerBy(page, cardCenter, MOVE.dx, MOVE.dy);
  await page.mouse.click(...(Object.values(await clientOf(page, 1100, 700)) as [number, number])); // deselect, so no handles are drawn
}
const show = (page: Page, label: "수정본" | "원본" | "나란히") => page.getByRole("group", { name: "원본 비교" }).getByRole("button", { name: label, exact: true }).click();

test.describe("one at a time", () => {
  test("original shows the page as it was uploaded; edited shows the result; they switch back and forth", async ({ page }) => {
    await movedCard(page);
    await expectPixel(page, oldSpot.x, oldSpot.y, GRAY); // edited: the card has left its old place...
    await expectPixel(page, newSpot.x, newSpot.y, BLUE); // ...and is at the new one

    await show(page, "원본");
    await expectPixel(page, oldSpot.x, oldSpot.y, BLUE); // original: the card is where it always was
    await expectPixel(page, newSpot.x, newSpot.y, GRAY);
    await expect(page.getByTestId("compare-badge")).toContainText("원본 보기");

    await show(page, "수정본");
    await expectPixel(page, oldSpot.x, oldSpot.y, GRAY);
    await expectPixel(page, newSpot.x, newSpot.y, BLUE);
    await expect(page.getByTestId("compare-badge")).toHaveCount(0);
  });

  test("the toggle shows which view is on, and is unavailable until there is a screen", async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole("group", { name: "원본 비교" }).getByRole("button", { name: "원본", exact: true })).toBeDisabled();
    await uploadPng(page, pageWithCard());
    await expect(page.getByRole("group", { name: "원본 비교" }).getByRole("button", { name: "수정본", exact: true })).toHaveAttribute("aria-pressed", "true");
    await show(page, "원본");
    await expect(page.getByRole("group", { name: "원본 비교" }).getByRole("button", { name: "원본", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("group", { name: "원본 비교" }).getByRole("button", { name: "수정본", exact: true })).toHaveAttribute("aria-pressed", "false");
  });

  test("a hidden or locked layer makes no difference to the original", async ({ page }) => {
    await movedCard(page);
    await page.getByRole("button", { name: /숨기기/ }).click();
    await show(page, "원본");
    await expectPixel(page, oldSpot.x, oldSpot.y, BLUE);
  });
});

test.describe("side by side", () => {
  /** an image point of the left (original) frame, in the coordinates the app uses for the right (edited) one */
  const left = (p: { x: number; y: number }) => ({ x: p.x - (PAGE.width + GAP), y: p.y });

  test("the original is on the left and the edited page on the right, both fully in view", async ({ page }) => {
    await movedCard(page);
    await show(page, "나란히");
    await expect(page.getByTestId("compare-badge")).toContainText("나란히 보기");
    await expectPixel(page, left(oldSpot).x, left(oldSpot).y, BLUE); // left: original, card in place
    await expectPixel(page, left(newSpot).x, left(newSpot).y, GRAY);
    await expectPixel(page, oldSpot.x, oldSpot.y, GRAY); // right: edited
    await expectPixel(page, newSpot.x, newSpot.y, BLUE);
    await expect(page.getByTestId("compare-label-original")).toHaveText("원본");
    await expect(page.getByTestId("compare-label-modified")).toHaveText("수정본");

    // both frames fit inside the canvas
    const vp = (await page.getByTestId("viewport").boundingBox())!;
    for (const corner of [left({ x: 0, y: 0 }), { x: PAGE.width, y: PAGE.height }]) {
      const c = await clientOf(page, corner.x, corner.y);
      expect(c.x).toBeGreaterThanOrEqual(vp.x - 1);
      expect(c.x).toBeLessThanOrEqual(vp.x + vp.width + 1);
      expect(c.y).toBeGreaterThanOrEqual(vp.y - 1);
      expect(c.y).toBeLessThanOrEqual(vp.y + vp.height + 1);
    }
  });

  test("leaving side by side puts the view back where it was", async ({ page }) => {
    await movedCard(page);
    await zoomTo(page, 1.5, cardCenter.x, cardCenter.y);
    const before = (await editor(page)).view;
    await show(page, "나란히");
    expect((await editor(page)).view.zoom).not.toBeCloseTo(before.zoom, 3); // it had to zoom out to fit both
    await show(page, "수정본");
    expect((await editor(page)).view).toEqual(before);
  });

  test("going from side by side straight to original also restores the view", async ({ page }) => {
    await movedCard(page);
    const before = (await editor(page)).view;
    await show(page, "나란히");
    await show(page, "원본");
    expect((await editor(page)).view).toEqual(before);
  });
});

test.describe("nothing can be edited while comparing", () => {
  for (const mode of ["원본", "나란히"] as const) {
    test(`${mode}: the Delete, Ctrl+D and Ctrl+V keys, dragging the layer and extracting change nothing`, async ({ page }) => {
      await movedCard(page);
      await page.getByTestId("layer-item").click(); // select it first
      await show(page, mode);
      const past = (await editor(page)).past;
      const layer = (await editor(page)).layers[0];
      expect((await editor(page)).selected).toHaveLength(1);

      // keys first, while the layer is still selected (a click on the canvas would deselect it and make these no-ops)
      await page.keyboard.press("Delete");
      await page.keyboard.press("Control+d");
      await page.keyboard.press("Control+c");
      await page.keyboard.press("Control+v");
      expect((await editor(page)).layers).toHaveLength(1);

      const c = await clientOf(page, newSpot.x, newSpot.y);
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      await page.mouse.move(c.x + 60, c.y + 40, { steps: 6 });
      await page.mouse.up(); // try to drag the layer
      await pickTool(page, "영역 추출");
      await dragImageRect(page, { x: 600, y: 500 }, { x: 700, y: 560 }); // try to extract

      expect((await editor(page)).past).toBe(past);
      expect((await editor(page)).layers).toHaveLength(1);
      expect((await editor(page)).layers[0].transform).toEqual(layer.transform);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });

    test(`${mode}: the panels' edit controls are disabled`, async ({ page }) => {
      await movedCard(page);
      await page.getByTestId("layer-item").click();
      await show(page, mode);
      for (const name of ["앞으로", "뒤로", "복제", "삭제"]) await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: /숨기기/ })).toBeDisabled();
      await expect(page.getByRole("button", { name: /잠그기/ })).toBeDisabled();
      await expect(page.getByTestId("prop-name")).toBeDisabled();
      await expect(page.getByRole("button", { name: "크기·회전 초기화" })).toBeDisabled();
    });
  }

  test("no resize handles are offered, and a drag where a handle would be does nothing", async ({ page }) => {
    await movedCard(page);
    await page.getByTestId("layer-item").click();
    await show(page, "원본");
    const t = (await editor(page)).layers[0].transform;
    const br = await clientOf(page, newSpot.x + 140, newSpot.y + 60); // the layer's bottom-right corner
    await page.mouse.move(br.x, br.y);
    await page.mouse.down();
    await page.mouse.move(br.x + 50, br.y + 50, { steps: 5 });
    await page.mouse.up();
    expect((await editor(page)).layers[0].transform).toEqual(t);
  });

  test("looking around still works: the view can be zoomed and moved", async ({ page }) => {
    await movedCard(page);
    await show(page, "원본");
    const before = (await editor(page)).view;
    await page.getByRole("button", { name: "확대" }).click();
    expect((await editor(page)).view.zoom).toBeGreaterThan(before.zoom);
    await pickTool(page, "이동");
    const v = (await editor(page)).view;
    await page.mouse.move(600, 400);
    await page.mouse.down();
    await page.mouse.move(650, 430, { steps: 4 });
    await page.mouse.up();
    expect((await editor(page)).view.panX).toBeCloseTo(v.panX + 50, 0);
  });

  test("back to the edited view, editing works again", async ({ page }) => {
    await movedCard(page);
    await page.getByTestId("layer-item").click();
    await show(page, "원본");
    await show(page, "수정본");
    await page.getByRole("button", { name: "복제" }).click();
    expect((await editor(page)).layers).toHaveLength(2);
  });
});

test.describe("what gets saved", () => {
  test("the PNG is the edited result whichever view is on, and is the same file byte for byte", async ({ page }) => {
    await movedCard(page);
    const edited = await exportPngBytes(page);
    expect(await pngPixelAt(page, edited, oldSpot.x, oldSpot.y)).toEqual(GRAY);
    expect(await pngPixelAt(page, edited, newSpot.x, newSpot.y)).toEqual(BLUE);

    for (const mode of ["원본", "나란히"] as const) {
      await show(page, mode);
      await page.getByRole("button", { name: "PNG 내보내기" }).click();
      await expect(page.getByText("비교 보기와 관계없이, 수정한 결과를 저장합니다.")).toBeVisible();
      await page.getByRole("button", { name: "닫기" }).click();
      const png = await exportPngBytes(page);
      expect(png.equals(edited)).toBe(true);
    }
  });
});

test.describe("at 200% on a retina screen", () => {
  test.use({ deviceScaleFactor: 2 });
  test("the original and the edited page still differ where they should, pixel for pixel", async ({ page }) => {
    await movedCard(page);
    await zoomTo(page, 2, oldSpot.x, oldSpot.y);
    await show(page, "원본");
    await expectPixel(page, oldSpot.x, oldSpot.y, BLUE);
    const k = await konvaPixel(page, ...(Object.values(await clientOf(page, oldSpot.x, oldSpot.y)) as [number, number]));
    expect(k.scale).toBe(2);
    await show(page, "수정본");
    await expectPixel(page, oldSpot.x, oldSpot.y, GRAY);
  });
});

test("opening or loading another picture leaves comparing", async ({ page }) => {
  await movedCard(page);
  await show(page, "나란히");
  await page.getByRole("button", { name: "이미지 업로드" }).click().catch(() => {});
  await page.getByTestId("file-input").setInputFiles({ name: "other.png", mimeType: "image/png", buffer: (await import("./helpers")).encodePng((await import("./helpers")).blank(80, 60, [10, 20, 30, 255])) });
  await page.getByRole("button", { name: "새로 불러오기" }).click();
  await expect(page.getByTestId("screen-label")).toContainText("80 × 60");
  await expect(page.getByRole("group", { name: "원본 비교" }).getByRole("button", { name: "수정본", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("compare-badge")).toHaveCount(0);
});
