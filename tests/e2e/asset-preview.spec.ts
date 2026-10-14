import { Page, expect, test } from "@playwright/test";
import { CARD, dragImageRect, editor, openApp, pageWithCard, pickTool, uploadPng, zoomTo } from "./helpers";

const tab = (page: Page, id: "builtin" | "mine" | "template") => page.getByTestId(`asset-tab-${id}`).click();

/** how many pixels of a thumbnail canvas are neither of the two checkerboard greys: i.e. the source's own drawing */
const inkOf = (page: Page, testId: string, nth = 0) =>
  page.getByTestId(testId).nth(nth).locator("canvas").evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 0; i < d.length; i += 4) {
      const grey = (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 255) || (d[i] === 229 && d[i + 1] === 231 && d[i + 2] === 235);
      if (!grey) ink++;
    }
    return { ink, width: c.width, height: c.height };
  });

async function withLayer(page: Page) {
  await openApp(page);
  await uploadPng(page, pageWithCard());
  await zoomTo(page, 1, 600, 300);
  await pickTool(page, "영역 추출");
  await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
  await expect.poll(async () => (await editor(page)).layers.length).toBe(1);
}

test.describe("source previews", () => {
  test("built-in: every card shows a drawing, a button's three looks sit side by side in one card, and no label is cut off", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    const thumbs = page.getByTestId("asset-thumb");
    const count = await thumbs.count();
    expect(count).toBeGreaterThanOrEqual(12 + 4 + 5);
    // thumbnails are drawn as they come into view: scroll through the panel so each one is seen
    for (let i = 0; i < count; i++) {
      await thumbs.nth(i).scrollIntoViewIfNeeded();
      await expect(thumbs.nth(i)).toHaveAttribute("data-state", "ready");
      expect((await inkOf(page, "asset-thumb", i)).ink, `thumb ${i} has a drawing`).toBeGreaterThan(5);
    }
    const group = page.getByTestId("asset-button-group-fill");
    await group.scrollIntoViewIfNeeded();
    const boxes = await group.getByTestId("asset-thumb").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
    expect(boxes).toHaveLength(3);
    expect(boxes[0].y).toBeCloseTo(boxes[1].y, 0); // side by side
    expect(boxes[1].x).toBeGreaterThan(boxes[0].x + boxes[0].width - 1);
    // the three looks are drawn differently
    const sigs = await group.getByTestId("asset-thumb").locator("canvas").evaluateAll((cs) => cs.map((c) => (c as HTMLCanvasElement).toDataURL()));
    expect(new Set(sigs).size).toBe(3);
    // nothing is clipped: no card is wider than the panel
    const panel = await page.getByTestId("asset-panel").boundingBox();
    for (const b of await page.getByTestId("asset-panel").locator("button").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
      expect(b.x + b.width).toBeLessThanOrEqual(panel!.x + panel!.width + 1);
    }
    await page.getByTestId("asset-panel").screenshot({ path: "test-results/asset-preview-builtin.png" });
  });

  test("hovering a card shows a larger preview", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    const thumb = page.getByTestId("asset-thumb").nth(12); // the card
    await thumb.scrollIntoViewIfNeeded();
    await expect(thumb).toHaveAttribute("data-state", "ready");
    await thumb.hover();
    const big = page.getByTestId("asset-big-preview");
    await expect(big).toBeVisible();
    const small = await thumb.locator("canvas").first().boundingBox();
    const large = await big.locator("canvas").boundingBox();
    expect(large!.width).toBeGreaterThan(small!.width);
    await page.getByTestId("asset-panel").screenshot({ path: "test-results/asset-preview-hover.png" });
    await page.mouse.move(5, 5);
    await expect(big).toHaveCount(0);
  });

  test("my sources: an empty list says so; saving adds a picture card; deleting removes it", async ({ page }) => {
    await withLayer(page);
    await tab(page, "mine");
    await expect(page.getByTestId("asset-empty")).toBeVisible();
    await page.getByTestId("asset-save-name").fill("Blue card");
    await page.getByTestId("asset-save").click();
    const thumb = page.getByTestId("my-asset-thumb");
    await expect(thumb).toHaveCount(1);
    await expect(thumb).toHaveAttribute("data-state", "ready");
    const ink = await inkOf(page, "my-asset-thumb");
    expect(ink.ink).toBeGreaterThan(50);
    await page.getByTestId("asset-panel").screenshot({ path: "test-results/asset-preview-mine.png" });
    await page.getByTestId("asset-delete").click();
    await expect(page.getByTestId("my-asset-thumb")).toHaveCount(0);
    await expect(page.getByTestId("asset-empty")).toBeVisible();
  });

  test("templates: each card shows the whole screen in the right proportions", async ({ page }) => {
    await openApp(page); // no project: templates still show
    await tab(page, "template");
    for (const id of ["login", "cards", "settings"]) {
      const t = page.getByTestId(`template-${id}-thumb`);
      await t.scrollIntoViewIfNeeded(); // drawn when it comes into view
      await expect(t).toHaveAttribute("data-state", "ready");
      const { ink, width, height } = await inkOf(page, `template-${id}-thumb`);
      expect(ink).toBeGreaterThan(100);
      expect(Math.abs(width / height - 390 / 844)).toBeLessThan(0.03);
    }
    await page.getByTestId("asset-panel").screenshot({ path: "test-results/asset-preview-templates.png" });
  });
});
