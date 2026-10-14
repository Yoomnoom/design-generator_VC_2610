import { Page, expect, test } from "@playwright/test";
import { CARD, CARD2, pageWithCard, pngPixelAt, screenPixel, autosaveReady, clientOf, dragImageRect, drawShape, editor, exportPngBytes, openApp, openProjectFile, pageWithTwoCards, pickTool, saveProjectFile, uploadPng, waitForAutosave, zoomTo } from "./helpers";

/* three layers: card A (bitmap), card B (bitmap) and a rectangle R (vector); then groups of them */
const A = { x: CARD.x + CARD.width / 2, y: CARD.y + CARD.height / 2 };
const B = { x: CARD2.x + CARD2.width / 2, y: CARD2.y + CARD2.height / 2 };
const R = { x: 360, y: 360 };

const layers = async (page: Page) => (await editor(page)).layers;
const selected = (page: Page) => page.evaluate(() => (window as any).__slc.getState().selectedLayerIds as string[]);
const groups = (page: Page) => page.evaluate(() => ((window as any).__slc.getState().history?.present.screens[0].groups ?? []) as { id: string; name: string }[]);
const groupIdOf = async (page: Page, id: string) => (await layers(page)).find((l) => l.id === id) && (await page.evaluate((i) => (window as any).__slc.getState().history.present.screens[0].layers.find((l: any) => l.id === i).groupId as string | undefined, id));
const xOf = async (page: Page, id: string) => (await layers(page)).find((l) => l.id === id)!.transform.x;

async function scene(page: Page) {
  await openApp(page);
  await uploadPng(page, pageWithTwoCards());
  await zoomTo(page, 1, 600, 330);
  await pickTool(page, "영역 추출");
  await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
  await pickTool(page, "영역 추출");
  await dragImageRect(page, { x: CARD2.x, y: CARD2.y }, { x: CARD2.x + CARD2.width, y: CARD2.y + CARD2.height });
  await drawShape(page, "사각형", { x: 320, y: 340 }, { x: 400, y: 380 });
  await pickTool(page, "선택");
  await expect.poll(async () => (await layers(page)).length).toBe(3);
  const [a, b, r] = (await layers(page)).map((l) => l.id);
  await zoomTo(page, 1, 600, 330);
  if (await page.getByTestId("snap-toggle").isChecked()) await page.getByTestId("snap-toggle").click();
  await clickEmpty(page);
  return { a, b, r };
}
async function clickEmpty(page: Page) {
  const box = (await page.getByTestId("viewport").boundingBox())!;
  await page.mouse.click(box.x + 10, box.y + 10);
  await expect.poll(async () => (await selected(page)).length).toBe(0);
}
async function click(page: Page, p: { x: number; y: number }, mods: ("Shift" | "Control")[] = []) {
  const c = await clientOf(page, p.x, p.y);
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.click(c.x, c.y);
  for (const m of [...mods].reverse()) await page.keyboard.up(m);
}
async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  const a = await clientOf(page, from.x, from.y);
  const b = await clientOf(page, from.x + dx, from.y + dy);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}
/** A and B grouped (selected, then Ctrl+G) */
async function groupAB(page: Page, ids: { a: string; b: string }) {
  await click(page, A);
  await click(page, B, ["Shift"]);
  expect((await selected(page)).sort()).toEqual([ids.a, ids.b].sort());
  await page.keyboard.press("Control+g");
  await expect.poll(async () => (await groups(page)).length).toBe(1);
}

const L = async (page: Page, id: string) => (await layers(page)).find((l) => l.id === id)! as Awaited<ReturnType<typeof layers>>[number] & { opacity: number; blend?: string };
const blank = async (page: Page, color = "#808080") => {
  await openApp(page);
  await page.getByTestId("start-blank").click();
  await page.getByTestId("canvas-width").fill("600");
  await page.getByTestId("canvas-height").fill("400");
  await page.getByTestId("canvas-color-text").fill(color);
  await page.getByTestId("canvas-create").click();
  await expect.poll(async () => (await editor(page)).screen).not.toBeNull();
  await zoomTo(page, 1, 300, 200);
};
const setFill = (page: Page, id: string, fill: string) => page.evaluate(([i, f]) => (window as any).__slc.getState().setLayerContent(i, { fill: f, stroke: null, strokeWidth: 0 }), [id, fill]);
async function redRect(page: Page) {
  await drawShape(page, "사각형", { x: 100, y: 100 }, { x: 300, y: 220 });
  await expect.poll(async () => (await layers(page)).length).toBe(1);
  const id = (await layers(page))[0].id;
  await setFill(page, id, "#cc3333");
  await page.evaluate((i) => (window as any).__slc.getState().selectLayer(i), id);
  return id;
}

for (const dpr of [1, 2]) {
  test.describe(`opacity, blend modes and flip: screen equals PNG (device pixel ratio ${dpr})`, () => {
    test.use({ deviceScaleFactor: dpr });
    test("every blend mode and half opacity: the pixel on screen and in the PNG differ by at most 1 per channel", async ({ page }) => {
      await blank(page);
      const id = await redRect(page);
      for (const mode of ["", "multiply", "screen", "overlay", "darken", "lighten"]) {
        await page.getByTestId("blend-select").selectOption(mode);
        await expect.poll(async () => (await L(page, id)).blend ?? "").toBe(mode);
        await page.evaluate(() => (window as any).__slc.getState().selectLayer(null));
        const png = await exportPngBytes(page);
        const p = await pngPixelAt(page, png, 200, 160);
        const s = await screenPixel(page, 200, 160);
        expect(Math.max(...p.map((v, i) => Math.abs(v - s[i]))), `${mode || "normal"}: png ${p} screen ${s}`).toBeLessThanOrEqual(1);
        await page.evaluate((i) => (window as any).__slc.getState().selectLayer(i), id);
      }
      await page.getByTestId("opacity-num").fill("50");
      await page.getByTestId("opacity-num").press("Enter");
      await expect.poll(async () => (await L(page, id)).opacity).toBe(0.5);
      await page.evaluate(() => (window as any).__slc.getState().selectLayer(null));
      const png = await exportPngBytes(page);
      const p = await pngPixelAt(page, png, 200, 160);
      const s = await screenPixel(page, 200, 160);
      expect(Math.max(...p.map((v, i) => Math.abs(v - s[i])))).toBeLessThanOrEqual(1);
    });
  });
}

test.describe("opacity slider, flip, align", () => {
  test("dragging the opacity slider shows it live with no history; release is one undo step; the layer panel dims nothing else", async ({ page }) => {
    await blank(page);
    const id = await redRect(page);
    const slider = page.getByTestId("opacity-range");
    await slider.scrollIntoViewIfNeeded();
    const box = (await slider.boundingBox())!;
    const past = (await editor(page)).past;
    await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2, { steps: 6 });
    expect((await editor(page)).past).toBe(past);
    expect(await page.evaluate(() => (window as any).__slc.getState().opacityPreview)).not.toBeNull();
    await page.mouse.up();
    await expect.poll(async () => (await L(page, id)).opacity).toBeLessThan(0.7);
    expect((await editor(page)).past).toBe(past + 1);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // Ctrl+Z means nothing while a field has focus
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await L(page, id)).opacity).toBe(1);
  });

  test("flip: a bitmap is mirrored in place on screen and in the PNG; the button of a text box says why not", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    await zoomTo(page, 1, 600, 330);
    await pickTool(page, "영역 추출");
    await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
    await expect.poll(async () => (await layers(page)).length).toBe(1);
    const id = (await layers(page))[0].id;
    const t0 = (await L(page, id)).transform;
    await page.getByTestId("flip-x").click();
    await expect.poll(async () => (await L(page, id)).transform.scaleX).toBe(-t0.scaleX);
    const png = await exportPngBytes(page);
    // the red square in the card's top-left corner is now in its top-right corner
    expect(await pngPixelAt(page, png, CARD.x + CARD.width - 5, CARD.y + 5)).toEqual([255, 0, 0, 255]);
    expect(await screenPixel(page, CARD.x + CARD.width - 5, CARD.y + 5)).toEqual([255, 0, 0, 255]);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await L(page, id)).transform.scaleX).toBe(t0.scaleX);
  });

  test("align and distribute buttons: numbers; a single layer aligns to the frame", async ({ page }) => {
    await blank(page);
    await drawShape(page, "사각형", { x: 50, y: 60 }, { x: 110, y: 100 });
    await drawShape(page, "사각형", { x: 200, y: 150 }, { x: 240, y: 200 });
    await drawShape(page, "사각형", { x: 400, y: 250 }, { x: 430, y: 300 });
    await expect.poll(async () => (await layers(page)).length).toBe(3);
    const ids = (await layers(page)).map((l) => l.id);
    await page.keyboard.press("Control+a");
    expect((await selected(page)).length).toBe(3);
    await page.getByTestId("align-left").click();
    await expect.poll(async () => (await layers(page)).map((l) => l.transform.x)).toEqual([50, 50, 50]);
    await page.getByTestId("distribute-y").click();
    const ys = (await layers(page)).map((l) => l.transform.y);
    const hs = (await layers(page)).map((l) => l.content.height);
    expect(ys[1] - (ys[0] + hs[0])).toBeCloseTo(ys[2] - (ys[1] + hs[1]), 1); // equal gaps
    await page.evaluate((i) => (window as any).__slc.getState().selectLayer(i), ids[0]);
    await page.getByTestId("align-hcenter").click();
    await expect.poll(async () => (await L(page, ids[0])).transform.x).toBe(270); // (600 - 60) / 2
    await page.getByTestId("align-panel").screenshot({ path: "test-results/align-panel.png" });
  });

  test("Alt+drag makes a copy and leaves the original; plain drag still moves", async ({ page }) => {
    await blank(page);
    const id = await redRect(page);
    const x0 = (await L(page, id)).transform.x;
    await page.keyboard.down("Alt");
    const a = await clientOf(page, 200, 160), b = await clientOf(page, 300, 260);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect.poll(async () => (await layers(page)).length).toBe(2);
    expect((await L(page, id)).transform.x).toBe(x0);
    const copy = (await layers(page)).find((l) => l.id !== id)!;
    expect(copy.transform.x).toBe(x0 + 100);
    expect((await selected(page))).toEqual([copy.id]);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await layers(page)).length).toBe(1);
  });

  test("Ctrl+0 fits the screen and Ctrl+1 shows 100%", async ({ page }) => {
    await blank(page);
    await page.getByRole("button", { name: "확대" }).click();
    await expect(page.getByTestId("zoom-readout")).not.toHaveText("100%");
    await page.keyboard.press("Control+1");
    await expect(page.getByTestId("zoom-readout")).toHaveText("100%");
    await page.getByRole("button", { name: "확대" }).click();
    await page.getByRole("button", { name: "확대" }).click();
    await page.keyboard.press("Control+0");
    await expect.poll(async () => (await page.getByTestId("zoom-readout").innerText())).not.toBe("200%");
  });
});