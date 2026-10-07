import { Page, expect, test } from "@playwright/test";
import fs from "node:fs";
import {
  CARD, PAGE, autosaveReady, brushLayer, clientOf, dragImageRect, drawStroke, drawStyleOf, editor, exportPngBytes, openProjectFile, pageWithCard, panelNames, pickTool, pngPixelAt, reloadAndDiscard, saveProjectFile,
  screenPixel, sourceHash, uploadPng, waitForAutosave, zoomTo,
} from "./helpers";
import { GRAY, RED, deselect, diff, setup } from "./shape-helpers";

const H = [{ x: 600, y: 500 }, { x: 800, y: 500 }]; // a horizontal stroke, 200 px long
const setSize = async (page: Page, n: number) => {
  await page.getByTestId("draw-width").fill(String(n));
  await page.getByTestId("draw-width").press("Enter");
  await expect.poll(async () => (await drawStyleOf(page)).strokeWidth).toBe(n);
};

test.describe("the brush", () => {
  test("a stroke makes a new bitmap layer in the drawing colour, as one undo step; the capture is not touched", async ({ page }) => {
    await setup(page);
    const before = await sourceHash(page);
    await pickTool(page, "브러시");
    await expect(page.getByTestId("draw-style")).toBeVisible();
    await setSize(page, 10);
    await drawStroke(page, "브러시", H, { pick: false });

    const layer = await brushLayer(page);
    expect(layer).toMatchObject({ name: "브러시 1" });
    expect((await editor(page)).past).toBe(1);
    expect(await panelNames(page)).toEqual(["브러시 1"]);
    expect(await sourceHash(page)).toBe(before);

    await deselect(page);
    const png = await exportPngBytes(page);
    expect(diff(await pngPixelAt(page, png, 700, 500), RED)).toBeLessThanOrEqual(2); // on the stroke
    expect(diff(await pngPixelAt(page, png, 700, 520), GRAY)).toBeLessThanOrEqual(2); // beside it
    expect(diff(await screenPixel(page, 700, 500), RED)).toBeLessThanOrEqual(3);
    expect(diff(await screenPixel(page, 700, 520), GRAY)).toBeLessThanOrEqual(3);
    // a round cap reaches 5px beyond the end point
    expect(diff(await pngPixelAt(page, png, 802, 500), RED)).toBeLessThanOrEqual(2);
    expect(diff(await pngPixelAt(page, png, 808, 500), GRAY)).toBeLessThanOrEqual(2);
  });

  test("the bitmap is exactly the stroke's box, whatever the zoom or devicePixelRatio the stroke was drawn at", async ({ page }) => {
    await setup(page, 1);
    await pickTool(page, "브러시");
    await setSize(page, 10);
    await drawStroke(page, "브러시", H, { pick: false });
    const at100 = await brushLayer(page);
    expect(at100).toMatchObject({ x: 594, y: 494, width: 212, height: 12 }); // 600-6 … 800+6, 500-6 … 500+6
    await page.keyboard.press("Control+z");
    await zoomTo(page, 2, 700, 500);
    await drawStroke(page, "브러시", H, { pick: false });
    const at200 = await brushLayer(page);
    expect([at200!.x, at200!.y, at200!.width, at200!.height]).toEqual([594, 494, 212, 12]);
  });

  test.describe("devicePixelRatio 2", () => {
    test.use({ deviceScaleFactor: 2 });
    test("at 200% zoom the same stroke lands on the same original pixels, and the PNG shows it there", async ({ page }) => {
      await setup(page, 2, { x: 700, y: 500 });
      await pickTool(page, "브러시");
      await setSize(page, 10);
      await drawStroke(page, "브러시", H.map((p) => ({ x: p.x, y: p.y })).map((p, i) => ({ x: i === 0 ? 640 : 760, y: p.y })), { pick: false });
      expect(await brushLayer(page)).toMatchObject({ x: 634, y: 494, width: 132, height: 12 });
      await deselect(page);
      const png = await exportPngBytes(page);
      expect(diff(await pngPixelAt(page, png, 700, 500), RED)).toBeLessThanOrEqual(2);
      expect(diff(await pngPixelAt(page, png, 700, 508), GRAY)).toBeLessThanOrEqual(2);
    });
  });

  test("the next stroke goes on the same layer and grows its bitmap; each stroke is one undo step; undo takes back one", async ({ page }) => {
    await setup(page);
    await pickTool(page, "브러시");
    await setSize(page, 10);
    await drawStroke(page, "브러시", H, { pick: false });
    const first = (await brushLayer(page))!;
    await drawStroke(page, "브러시", [{ x: 600, y: 560 }, { x: 800, y: 600 }], { pick: false });
    const second = (await brushLayer(page))!;
    expect((await editor(page)).layers.filter((l) => l.name.startsWith("브러시"))).toHaveLength(1);
    expect(second.imageId).not.toBe(first.imageId);
    expect(second.height).toBeGreaterThan(first.height);
    expect((await editor(page)).past).toBe(2);

    await deselect(page);
    expect(diff(await screenPixel(page, 700, 580), RED)).toBeLessThanOrEqual(4);
    await page.keyboard.press("Control+z");
    expect(await brushLayer(page)).toMatchObject({ imageId: first.imageId, height: first.height });
    expect(diff(await screenPixel(page, 700, 580), GRAY)).toBeLessThanOrEqual(3);
    expect(diff(await screenPixel(page, 700, 500), RED)).toBeLessThanOrEqual(3); // the first stroke is still there
    await page.keyboard.press("Control+Shift+Z");
    expect((await brushLayer(page))!.imageId).toBe(second.imageId);
  });

  test("a dot (a click) paints a round dot of the brush's size", async ({ page }) => {
    await setup(page);
    await pickTool(page, "브러시");
    await setSize(page, 20);
    const c = await clientOf(page, 700, 500);
    await page.mouse.click(c.x, c.y);
    await deselect(page);
    const png = await exportPngBytes(page);
    expect(diff(await pngPixelAt(page, png, 700, 500), RED)).toBeLessThanOrEqual(2);
    expect(diff(await pngPixelAt(page, png, 700, 515), GRAY)).toBeLessThanOrEqual(2); // beyond the 10px radius
  });

  test("a stroke on a locked, hidden or turned brush layer starts a new layer instead", async ({ page }) => {
    await setup(page);
    await pickTool(page, "브러시");
    await drawStroke(page, "브러시", H, { pick: false });
    await page.getByRole("button", { name: /잠그기/ }).click();
    await drawStroke(page, "브러시", [{ x: 600, y: 560 }, { x: 800, y: 560 }], { pick: false });
    expect(await panelNames(page)).toEqual(["브러시 2", "브러시 1"]);
  });

  test("the colour comes from the colour field and from the eyedropper", async ({ page }) => {
    await setup(page);
    await pickTool(page, "스포이트");
    const c = await clientOf(page, CARD.x + 100, CARD.y + 60);
    await page.mouse.click(c.x, c.y);
    await expect.poll(async () => (await drawStyleOf(page)).stroke).toBe("#0000ff");
    await drawStroke(page, "브러시", [{ x: 600, y: 500 }, { x: 700, y: 500 }]);
    await deselect(page);
    expect(diff(await pngPixelAt(page, await exportPngBytes(page), 650, 500), [0, 0, 255, 255])).toBeLessThanOrEqual(2);
  });
});

test.describe("the eraser", () => {
  async function withStroke(page: Page) {
    await setup(page);
    await pickTool(page, "브러시");
    await setSize(page, 20);
    await drawStroke(page, "브러시", H, { pick: false });
  }

  test("it clears what it passes over on the brush layer, as one undo step, keeping the bitmap's size", async ({ page }) => {
    await withStroke(page);
    const before = (await brushLayer(page))!;
    const past = (await editor(page)).past;
    await pickTool(page, "지우개");
    await setSize(page, 12);
    await drawStroke(page, "지우개", [{ x: 690, y: 500 }, { x: 710, y: 500 }], { pick: false });
    const after = (await brushLayer(page))!;
    expect([after.x, after.y, after.width, after.height]).toEqual([before.x, before.y, before.width, before.height]);
    expect(after.imageId).not.toBe(before.imageId);
    expect((await editor(page)).past).toBe(past + 1);

    await deselect(page);
    const png = await exportPngBytes(page);
    expect(diff(await pngPixelAt(page, png, 700, 500), GRAY)).toBeLessThanOrEqual(2); // erased: the page shows through
    expect(diff(await pngPixelAt(page, png, 650, 500), RED)).toBeLessThanOrEqual(2); // beside it the stroke stays
    expect(diff(await screenPixel(page, 700, 500), GRAY)).toBeLessThanOrEqual(3);

    await page.keyboard.press("Control+z");
    expect((await brushLayer(page))!.imageId).toBe(before.imageId);
    expect(diff(await screenPixel(page, 700, 500), RED)).toBeLessThanOrEqual(3);
  });

  test("it never erases the capture: with nothing to erase it refuses, says why, and records nothing", async ({ page }) => {
    await setup(page);
    const hash = await sourceHash(page);
    await pickTool(page, "지우개");
    await drawStroke(page, "지우개", [{ x: 400, y: 260 }, { x: 520, y: 300 }], { pick: false }); // right across the card in the capture
    await expect(page.getByTestId("notice")).toContainText("브러시로 직접 그린 레이어");
    expect(await editor(page)).toMatchObject({ layers: [], past: 0 });
    expect(await sourceHash(page)).toBe(hash);
    await deselect(page);
    expect(diff(await screenPixel(page, 450, 280), [0, 0, 255, 255])).toBeLessThanOrEqual(3); // the card is still blue
  });

  test("it does not erase an extracted layer either", async ({ page }) => {
    await setup(page, 1, { x: 630, y: 450 });
    await pickTool(page, "영역 추출");
    await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
    const layers = (await editor(page)).layers.length;
    await drawStroke(page, "지우개", [{ x: 400, y: 260 }, { x: 520, y: 300 }]);
    await expect(page.getByTestId("notice")).toBeVisible();
    expect((await editor(page)).layers).toHaveLength(layers);
    expect((await editor(page)).past).toBe(1); // just the extraction
  });

  test("it refuses a locked layer, naming the reason", async ({ page }) => {
    await withStroke(page);
    await page.getByRole("button", { name: /잠그기/ }).click();
    await drawStroke(page, "지우개", [{ x: 690, y: 500 }, { x: 710, y: 500 }]);
    await expect(page.getByTestId("notice")).toContainText("잠긴");
  });
});

test.describe("with the rest of the app", () => {
  test("hiding the brush layer shows the capture exactly as it was uploaded", async ({ page }) => {
    await setup(page);
    const clean = await exportPngBytes(page);
    await pickTool(page, "브러시");
    await drawStroke(page, "브러시", H, { pick: false });
    await page.getByRole("button", { name: /숨기기/ }).click();
    expect((await exportPngBytes(page)).equals(clean)).toBe(true);
  });

  test("comparing blocks painting", async ({ page }) => {
    await setup(page);
    await page.getByRole("group", { name: "원본 비교" }).getByRole("button", { name: "원본", exact: true }).click();
    await pickTool(page, "브러시");
    await drawStroke(page, "브러시", H, { pick: false });
    expect(await editor(page)).toMatchObject({ layers: [], past: 0 });
  });

  test("B and E pick the tools and are ignored while typing", async ({ page }) => {
    await setup(page);
    await page.keyboard.press("b");
    await expect(page.getByRole("button", { name: "브러시", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("e");
    await expect(page.getByRole("button", { name: "지우개", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("b");
    await page.getByTestId("draw-width").focus();
    await page.keyboard.type("e");
    await expect(page.getByRole("button", { name: "브러시", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("the project file holds the layer's current bitmap and opens again exactly", async ({ page }) => {
    await setup(page);
    await pickTool(page, "브러시");
    await drawStroke(page, "브러시", H, { pick: false });
    await drawStroke(page, "브러시", [{ x: 600, y: 560 }, { x: 700, y: 560 }], { pick: false });
    const before = await exportPngBytes(page);
    const text = await saveProjectFile(page);
    const file = JSON.parse(text);
    expect(file.project.version).toBe(4);
    expect(file.project.screens[0].layers[0]).toMatchObject({ drawn: true, name: "브러시 1" });
    expect(Object.keys(file.images)).toHaveLength(2); // the capture and the layer's CURRENT bitmap, not the one before the second stroke
    await reloadAndDiscard(page);
    await openProjectFile(page, text);
    await expect(page.getByTestId("screen-label")).toBeVisible();
    expect(await brushLayer(page)).toMatchObject({ name: "브러시 1" });
    expect((await exportPngBytes(page)).equals(before)).toBe(true);
    // and it can be painted on after opening (nothing is selected after an open, so the stroke makes a new layer)
    await drawStroke(page, "브러시", [{ x: 600, y: 600 }, { x: 650, y: 600 }]);
    expect((await editor(page)).layers).toHaveLength(2);
  });

  test("it survives a reload through the temporary save, with its lock", async ({ page }) => {
    await setup(page);
    await pickTool(page, "브러시");
    await drawStroke(page, "브러시", H, { pick: false });
    await page.getByRole("button", { name: /잠그기/ }).click();
    await expect
      .poll(async () => {
        const rec = await page.evaluate(() => new Promise<any>((res) => { const o = indexedDB.open("screenshot-layer-canvas"); o.onsuccess = () => { const q = o.result.transaction("autosave").objectStore("autosave").get("current"); q.onsuccess = () => (o.result.close(), res(q.result)); }; }));
        return rec?.project?.screens?.[0]?.layers?.[0]?.locked === true;
      })
      .toBe(true);
    await waitForAutosave(page);
    const before = await exportPngBytes(page);
    await page.reload();
    await autosaveReady(page);
    await page.getByRole("button", { name: "복원" }).click();
    await expect(page.getByTestId("screen-label")).toBeVisible();
    expect(await brushLayer(page)).toMatchObject({ name: "브러시 1", locked: true });
    expect((await exportPngBytes(page)).equals(before)).toBe(true);
  });

  test("Ctrl+C on a brush layer and Ctrl+V give another brush layer (it is still a brush layer)", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await setup(page);
    await pickTool(page, "브러시");
    await drawStroke(page, "브러시", H, { pick: false });
    await pickTool(page, "선택");
    await page.getByTestId("layer-item").click();
    await page.keyboard.press("Control+c");
    await expect.poll(() => page.evaluate(() => !!(window as any).__slc.getState().layerClipboard?.hash)).toBe(true);
    await page.keyboard.press("Control+v");
    await expect.poll(async () => (await editor(page)).layers.length).toBe(2);
    expect(await page.evaluate(() => (window as any).__slc.getState().history.present.screens[0].layers.every((l: any) => l.drawn))).toBe(true);
  });

  test("a file saved by the previous version opens, and strokes can be painted on it", async ({ page }) => {
    await setup(page);
    await reloadAndDiscard(page);
    await openProjectFile(page, fs.readFileSync("tests/fixtures/project-v3.slc.json", "utf8"), "v3.slc.json");
    await expect(page.getByTestId("screen-label")).toBeVisible();
    const layers = (await editor(page)).layers.length;
    await zoomTo(page, 1, 630, 450);
    await drawStroke(page, "브러시", [{ x: 400, y: 600 }, { x: 600, y: 620 }]);
    expect((await editor(page)).layers).toHaveLength(layers + 1);
    expect(JSON.parse(await saveProjectFile(page)).project.version).toBe(4);
  });
});

test.describe("big images", () => {
  test("painting and erasing on a 4000 × 3000 image (measurement)", async ({ page }) => {
    test.setTimeout(240_000);
    const { blank, encodePng } = await import("./helpers");
    await page.goto("/");
    await expect(page.getByTestId("viewport")).toBeVisible();
    await page.getByTestId("file-input").setInputFiles({ name: "big.png", mimeType: "image/png", buffer: encodePng(blank(4000, 3000, [240, 240, 240, 255])) });
    await expect(page.getByTestId("screen-label")).toContainText("4000 × 3000", { timeout: 90_000 });
    await zoomTo(page, 0.15, 2000, 1500);
    await pickTool(page, "브러시");
    await setSize(page, 60);
    const timed = async (fn: () => Promise<unknown>) => { const t = Date.now(); await fn(); return Date.now() - t; };
    const wide = [{ x: 400, y: 400 }, { x: 3600, y: 400 }, { x: 3600, y: 2600 }, { x: 400, y: 2600 }]; // a scribble across most of the image
    const first = await timed(async () => { await drawStroke(page, "브러시", wide, { pick: false }); await expect.poll(async () => (await brushLayer(page))?.width ?? 0).toBeGreaterThan(3000); });
    const second = await timed(async () => { await drawStroke(page, "브러시", [{ x: 1000, y: 1200 }, { x: 3000, y: 1500 }], { pick: false }); await expect.poll(async () => (await editor(page)).past).toBe(2); });
    await pickTool(page, "지우개");
    const erase = await timed(async () => { await drawStroke(page, "지우개", [{ x: 1000, y: 400 }, { x: 3000, y: 400 }], { pick: false }); await expect.poll(async () => (await editor(page)).past).toBe(3); });
    const bytes = await page.evaluate(() => { const s = (window as any).__slc.getState(); let n = 0; for (const [, v] of s.images) n += v.raw.data.length; return n; });
    console.log(`MEASURE 4000x3000 brush: first big stroke (box ${(await brushLayer(page))!.width}x${(await brushLayer(page))!.height}) ${first} ms incl. the drag, a second stroke ${second} ms, an erase ${erase} ms; pixel memory kept for undo: ${(bytes / 1048576).toFixed(0)} MB across ${await page.evaluate(() => (window as any).__slc.getState().images.size)} images`);
    expect(first).toBeLessThan(60_000);
  });
});
