import { Page, expect, test } from "@playwright/test";
import { autosaveReady, drawShape, editor, exportPngBytes, openApp, openProjectFile, pngPixelAt, saveProjectFile, screenPixel, waitForAutosave, zoomTo } from "./helpers";

/* a blank white 600 × 400 canvas (it fits the viewport at 100%) with one red rectangle at (60,60)–(260,180) (200 × 120), selected */
async function scene(page: Page) {
  await openApp(page);
  await page.getByTestId("start-blank").click();
  await page.getByTestId("canvas-width").fill("600");
  await page.getByTestId("canvas-height").fill("400");
  await page.getByTestId("canvas-create").click();
  await expect.poll(async () => (await editor(page)).screen).toMatchObject({ width: 600, height: 400 });
  await zoomTo(page, 1, 300, 200);
  await drawShape(page, "사각형", { x: 60, y: 60 }, { x: 260, y: 180 });
  await expect.poll(async () => (await editor(page)).layers.length).toBe(1);
  const id = (await editor(page)).layers[0].id;
  await page.evaluate((i) => (window as any).__slc.getState().setLayerContent(i, { fill: "#cc0000", stroke: null, strokeWidth: 0 }), id);
  await page.evaluate((i) => (window as any).__slc.getState().selectLayer(i), id);
  await expect(page.getByTestId("vec-radius-num")).toBeVisible();
  return id;
}
const content = async (page: Page, id: string) => (await editor(page)).layers.find((l) => l.id === id)!.content as { width: number; height: number; cornerRadius?: number };
/** Ctrl+Z means nothing while a text box has focus, so leave the box first */
const undo = async (page: Page, redo = false) => {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(redo ? "Control+Shift+z" : "Control+z");
};
const setRadius = async (page: Page, v: number) => {
  await page.getByTestId("vec-radius-num").fill(String(v));
  await page.getByTestId("vec-radius-num").press("Enter");
};

test.describe("rectangle corner radius", () => {
  test("the panel sets the radius (0 to half of the shorter side), one undo step per commit, and undo and redo bring it back", async ({ page }) => {
    const id = await scene(page);
    await expect(page.getByTestId("vec-radius")).toHaveAttribute("max", "60");
    const past = (await editor(page)).past;
    await setRadius(page, 24);
    await expect.poll(async () => (await content(page, id)).cornerRadius).toBe(24);
    expect((await editor(page)).past).toBe(past + 1);
    await setRadius(page, 500); // over the limit: held at 60 (half of 120)
    await expect.poll(async () => (await content(page, id)).cornerRadius).toBe(60);
    await setRadius(page, 0);
    await expect.poll(async () => "cornerRadius" in (await content(page, id))).toBe(false);
    await undo(page);
    await expect.poll(async () => (await content(page, id)).cornerRadius).toBe(60);
    await undo(page);
    await expect.poll(async () => (await content(page, id)).cornerRadius).toBe(24);
    await undo(page, true);
    await expect.poll(async () => (await content(page, id)).cornerRadius).toBe(60);
  });

  test("dragging the slider shows the rounding live and writes no history; letting go is ONE undo step", async ({ page }) => {
    const id = await scene(page);
    const slider = page.getByTestId("vec-radius");
    await slider.scrollIntoViewIfNeeded(); // the panel is taller than the window
    const box = (await slider.boundingBox())!;
    const past = (await editor(page)).past;
    await page.mouse.move(box.x + 4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 6 });
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 6 });
    // still held: the canvas shows it, the history has nothing new
    expect((await editor(page)).past).toBe(past);
    const live = await page.evaluate(() => (window as any).__slc.getState().cornerPreview as { cornerRadius: number } | null);
    expect(live && live.cornerRadius).toBeGreaterThan(30);
    expect((await content(page, id)).cornerRadius).toBeUndefined();
    expect(await screenPixel(page, 61, 61)).toEqual([255, 255, 255, 255]); // the corner is already round on screen
    await page.mouse.up();
    await expect.poll(async () => (await content(page, id)).cornerRadius).toBeGreaterThan(30);
    expect((await editor(page)).past).toBe(past + 1);
    expect(await page.evaluate(() => (window as any).__slc.getState().cornerPreview)).toBeNull();
  });

  test("screen and PNG draw the same rounded shape: corners are empty, the middle is red, and points along the edge agree", async ({ page }) => {
    const id = await scene(page);
    await setRadius(page, 40);
    await expect.poll(async () => (await content(page, id)).cornerRadius).toBe(40);
    await page.evaluate(() => (window as any).__slc.getState().selectLayer(null)); // no selection handles over the corners
    const png = await exportPngBytes(page);
    // the corners of the box are outside the rounded shape: the page's white
    for (const [x, y] of [[60, 60], [259, 60], [60, 179], [259, 179], [63, 63]]) {
      expect(await pngPixelAt(page, png, x, y), `png (${x},${y})`).toEqual([255, 255, 255, 255]);
      expect(await screenPixel(page, x, y), `screen (${x},${y})`).toEqual([255, 255, 255, 255]);
    }
    for (const [x, y] of [[160, 120], [100, 60], [60, 100], [210, 179], [240, 120]]) {
      expect(await pngPixelAt(page, png, x, y), `png (${x},${y})`).toEqual([204, 0, 0, 255]);
      expect(await screenPixel(page, x, y), `screen (${x},${y})`).toEqual([204, 0, 0, 255]);
    }
    // along the arc of the top-left corner (centre (100,100), radius 40) the screen and the PNG differ by at most a little anti-aliasing
    let worst = 0;
    for (let a = 180; a <= 270; a += 6) {
      const x = Math.round(100 + 40 * Math.cos((a * Math.PI) / 180)), y = Math.round(100 + 40 * Math.sin((a * Math.PI) / 180));
      const p = await pngPixelAt(page, png, x, y), s = await screenPixel(page, x, y);
      worst = Math.max(worst, ...p.map((v, i) => Math.abs(v - s[i])));
    }
    expect(worst).toBeLessThanOrEqual(8);
    await page.screenshot({ path: "test-results/corner-radius.png" });
  });

  test("resizing with a handle keeps the radius in pixels; a box too small for it rounds as much as it can", async ({ page }) => {
    const id = await scene(page);
    await setRadius(page, 40);
    await page.evaluate((i) => {
      const s = (window as any).__slc.getState();
      const t = s.history.present.screens[0].layers[0].transform;
      s.transformLayer(i, { ...t, scaleX: 0.5, scaleY: 0.5 }); // 100 × 60: the radius 40 no longer fits
    }, id);
    await expect.poll(async () => await content(page, id)).toMatchObject({ width: 100, height: 60, cornerRadius: 30 });
    await undo(page);
    await expect.poll(async () => await content(page, id)).toMatchObject({ width: 200, height: 120, cornerRadius: 40 });
  });

  test("only a rectangle has it: an ellipse and a line show no radius control", async ({ page }) => {
    await scene(page);
    await drawShape(page, "원", { x: 320, y: 60 }, { x: 440, y: 160 });
    await expect(page.getByTestId("vector-section")).toBeVisible();
    await expect(page.getByTestId("vec-radius")).toHaveCount(0);
    await drawShape(page, "선", { x: 320, y: 220 }, { x: 440, y: 300 });
    await expect(page.getByTestId("vec-radius")).toHaveCount(0);
  });

  test("saved, opened and restored: the radius comes back, and the PNG is identical", async ({ page }) => {
    const id = await scene(page);
    await setRadius(page, 32);
    await expect.poll(async () => (await content(page, id)).cornerRadius).toBe(32);
    const before = await exportPngBytes(page);
    const file = await saveProjectFile(page);
    expect(JSON.parse(file).project.version).toBe(10);
    expect(JSON.parse(file).project.screens[0].layers[0].content.cornerRadius).toBe(32);
    await openProjectFile(page, file);
    await expect.poll(async () => (await content(page, (await editor(page)).layers[0].id)).cornerRadius).toBe(32);
    expect((await exportPngBytes(page)).equals(before)).toBe(true);

    const t = await page.getByTestId("autosave-status").getAttribute("data-saved-at").then(Number);
    await page.evaluate(() => { const s = (window as any).__slc.getState(); s.selectLayer(s.history.present.screens[0].layers[0].id); });
    await setRadius(page, 36);
    await waitForAutosave(page, t);
    await page.reload();
    await autosaveReady(page);
    await page.getByRole("button", { name: "복원" }).click();
    await expect.poll(async () => (await content(page, (await editor(page)).layers[0].id)).cornerRadius).toBe(36);
  });

  test("a locked layer cannot be changed and comparing blocks it", async ({ page }) => {
    const id = await scene(page);
    await page.evaluate((i) => (window as any).__slc.getState().setLayerLocked(i, true), id);
    await expect(page.getByTestId("vec-radius-num")).toBeDisabled();
    await page.evaluate((i) => (window as any).__slc.getState().setLayerLocked(i, false), id);
    await page.evaluate(() => (window as any).__slc.getState().setCompareMode("original"));
    const ok = await page.evaluate((i) => (window as any).__slc.getState().setLayerContent(i, { cornerRadius: 10 }), id);
    expect(ok).toBe(false);
  });

  test("the built-in button, card, input and tag are rounded on screen, and the template thumbnails show it", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("start-blank").click();
    await page.getByTestId("canvas-create").click();
    await expect.poll(async () => (await editor(page)).screen).not.toBeNull();
    for (const id of ["button-fill-rest", "card", "input", "tag"]) await page.getByTestId(`asset-${id}`).click();
    const radii = (await editor(page)).layers.filter((l) => l.content?.kind === "rect").map((l) => l.content.cornerRadius ?? 0);
    expect(radii.filter((r) => r > 0).length).toBeGreaterThanOrEqual(8);
    await page.getByTestId("asset-panel").scrollIntoViewIfNeeded();
    await page.getByTestId("asset-tab-template").click();
    for (const id of ["login", "cards", "settings"]) {
      const thumb = page.getByTestId("asset-panel").getByTestId(`template-${id}-thumb`);
      await thumb.scrollIntoViewIfNeeded();
      await expect(thumb).toHaveAttribute("data-state", "ready");
    }
    await page.getByTestId("asset-panel").screenshot({ path: "test-results/corner-radius-templates.png" });
    await page.getByTestId("asset-tab-builtin").click();
    await page.getByTestId("asset-panel").screenshot({ path: "test-results/corner-radius-builtin.png" });
  });
});
