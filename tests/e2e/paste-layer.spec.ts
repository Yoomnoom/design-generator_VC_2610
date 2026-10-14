import { Page, expect, test } from "@playwright/test";
import { CARD, PAGE, blank, dragImageRect, editor, encodePng, fill, openApp, openProjectFile, pageWithCard, pickTool, saveProjectFile, uploadPng, zoomTo } from "./helpers";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

async function putOnClipboard(page: Page, png: Buffer) {
  await page.evaluate(async (b64) => {
    window.focus();
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })]);
  }, png.toString("base64"));
}
async function pasteImage(page: Page, png: Buffer) {
  await putOnClipboard(page, png);
  await page.keyboard.press("Control+V");
}
const small = (c: [number, number, number, number] = [10, 200, 30, 255]) => {
  const p = blank(100, 60, c);
  fill(p, 0, 0, 10, 10, [255, 0, 0, 255]);
  return p;
};

async function withLayer(page: Page) {
  await openApp(page);
  await uploadPng(page, pageWithCard());
  await zoomTo(page, 1, 600, 300);
  await pickTool(page, "영역 추출");
  await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
  await expect.poll(async () => (await editor(page)).layers.length).toBe(1);
}

test.describe("pasting while a project is open", () => {
  test("a copied layer pasted three times gives three offset copies", async ({ page }) => {
    await withLayer(page);
    const origin = (await editor(page)).layers[0].transform;
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+c");
    for (let i = 1; i <= 3; i++) {
      await page.keyboard.press("Control+v");
      await expect.poll(async () => (await editor(page)).layers.length).toBe(1 + i);
    }
    const layers = (await editor(page)).layers;
    expect(layers.map((l) => l.transform.x - origin.x).sort((a, b) => a - b)).toEqual([0, 16, 32, 48]);
  });

  test("an outside picture is added as a new layer, three times in a row, each one undo step", async ({ page }) => {
    await withLayer(page);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    const before = await editor(page);
    for (let i = 1; i <= 3; i++) {
      await pasteImage(page, encodePng(small()));
      await expect.poll(async () => (await editor(page)).layers.length).toBe(1 + i);
    }
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    const after = await editor(page);
    expect(after.screen).toEqual(before.screen); // the screen was not replaced
    expect(after.past).toBe(before.past + 3);
    const added = after.layers.filter((l) => l.id !== before.layers[0].id).sort((a, b) => a.zIndex - b.zIndex);
    expect(added.map((l) => l.transform.x)).toEqual([550, 566, 582]); // centred (1200-100)/2, then +16 each
    expect(added.map((l) => l.transform.y)).toEqual([370, 386, 402]);
    expect(added[0].transform).toMatchObject({ scaleX: 1, scaleY: 1, rotation: 0 });
    expect(new Set(added.map((l) => l.imageId)).size).toBe(3);

    await page.keyboard.press("Control+z");
    expect((await editor(page)).layers).toHaveLength(3);
    await page.keyboard.press("Control+Shift+z");
    expect((await editor(page)).layers).toHaveLength(4);
  });

  test("a picture bigger than the frame is shrunk to fit and centred", async ({ page }) => {
    await withLayer(page);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await pasteImage(page, encodePng(blank(2400, 800, [1, 2, 3, 255])));
    await expect.poll(async () => (await editor(page)).layers.length).toBe(2);
    const l = (await editor(page)).layers.find((x) => x.crop.width === 2400)!;
    expect(l.transform.scaleX).toBeCloseTo(0.5, 6);
    expect(l.transform.scaleY).toBeCloseTo(0.5, 6);
    expect(l.transform.x).toBeCloseTo(0, 6);
    expect(l.transform.y).toBeCloseTo(200, 6);
  });

  test("it is refused while comparing, and the notice says why", async ({ page }) => {
    await withLayer(page);
    await page.evaluate(() => (window as any).__slc.getState().setCompareMode("original"));
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await pasteImage(page, encodePng(small()));
    await expect(page.getByText("비교 보기 중에는 이미지를 붙여넣을 수 없습니다")).toBeVisible();
    expect((await editor(page)).layers).toHaveLength(1);
  });

  test("the added layer survives saving and opening the project", async ({ page }) => {
    await withLayer(page);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await pasteImage(page, encodePng(small([200, 10, 10, 255])));
    await expect.poll(async () => (await editor(page)).layers.length).toBe(2);
    const text = await saveProjectFile(page);
    await openProjectFile(page, text);
    await expect.poll(async () => (await editor(page)).layers.length).toBe(2);
    const l = (await editor(page)).layers.find((x) => x.crop.width === 100)!;
    expect(l.transform).toMatchObject({ x: 550, y: 370 });
    const px = await page.evaluate(async (id) => {
      const s = (window as any).__slc.getState();
      const raw = s.images.get(id).raw;
      return Array.from(raw.data.slice((20 * raw.width + 20) * 4, (20 * raw.width + 20) * 4 + 4));
    }, l.imageId);
    expect(px).toEqual([200, 10, 10, 255]);
  });

  test("dropping a file on the canvas adds a layer instead of replacing the screen", async ({ page }) => {
    await withLayer(page);
    const b64 = encodePng(small()).toString("base64");
    await page.evaluate(async (data) => {
      const dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], "dropped.png", { type: "image/png" }));
      document.querySelector('[data-testid="viewport"]')!.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, b64);
    await expect.poll(async () => (await editor(page)).layers.length).toBe(2);
    expect((await editor(page)).screen).toMatchObject({ width: PAGE.width, height: PAGE.height });
    await expect(page.getByTestId("layer-item").first()).toContainText("dropped");
  });

  test("the upload button still replaces the screen", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    await uploadPng(page, blank(300, 200, [9, 9, 9, 255]), "other.png");
    await expect(page.getByTestId("screen-label")).toContainText("300 × 200");
  });
});