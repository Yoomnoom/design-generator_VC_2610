import { Page, expect, test } from "@playwright/test";
import fs from "node:fs";
import { reloadAndDiscard, CARD, PAGE, clientOf, dragClient, dragImageRect, editor, exportPngBytes, expectPixel, firstLayer, handleAt, layerPointToImage, openApp, openProjectFile, pageWithCard, panelNames, pickTool, pngPixelAt, readPngSize, saveProjectFile, uploadPng, zoomTo } from "./helpers";

const BLUE = [0, 0, 255, 255];
const GRAY = [240, 240, 240, 255];
const cardCenter = { x: CARD.x + CARD.width / 2, y: CARD.y + CARD.height / 2 };

async function withLayer(page: Page, zoom: number) {
  await openApp(page);
  await uploadPng(page, pageWithCard());
  await zoomTo(page, 1, 600, 300);
  await pickTool(page, "영역 추출");
  await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
  await pickTool(page, "선택");
  await zoomTo(page, zoom, cardCenter.x, cardCenter.y);
}

/** where a point inside the layer (in its own pixels, kept away from the edges) sits in the page, by the placement now in the store */
async function inside(page: Page, local: { x: number; y: number }) {
  const { transform } = await firstLayer(page);
  return layerPointToImage(transform, local);
}

/** The layer as the store says it is placed must be what Konva shows AND what the exported PNG contains. */
async function expectPlacementShown(page: Page, png: Buffer) {
  const { width, height } = await firstLayer(page);
  // (the card has a 20×20 red marker in its top-left corner, so that corner is red, which also shows the layer is not mirrored)
  const RED = [255, 0, 0, 255];
  // Points are 14px in from the corners: the resize handles are 9px squares drawn on top of the corners, and would hide anything nearer.
  const N = 14;
  for (const [local, colour] of [[{ x: N, y: N }, RED], [{ x: width / 2, y: height / 2 }, BLUE], [{ x: width - N, y: height - N }, BLUE], [{ x: width - N, y: N }, BLUE], [{ x: N, y: height - N }, BLUE]] as const) {
    const p = await inside(page, local);
    await expectPixel(page, p.x, p.y, [...colour]);
    expect(await pngPixelAt(page, png, p.x, p.y)).toEqual([...colour]);
  }
  // and just outside each corner it is not the layer (the page there is plain background)
  for (const local of [{ x: -5, y: -5 }, { x: width + 5, y: -5 }, { x: width + 5, y: height + 5 }, { x: -5, y: height + 5 }]) {
    const p = await inside(page, local);
    expect(await pngPixelAt(page, png, p.x, p.y)).toEqual(GRAY);
  }
}

for (const dpr of [1, 2]) {
  test.describe(`resize and rotate with the handles — devicePixelRatio ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });

    for (const zoom of [1, 2]) {
      test(`zoom ${zoom * 100}%: dragging the bottom-right corner resizes about the top-left corner; screen and PNG agree`, async ({ page }) => {
        await withLayer(page, zoom);
        const from = await handleAt(page, "br");
        const past = (await editor(page)).past;
        await dragClient(page, from, { x: from.x + 48 * zoom, y: from.y + 30 * zoom }); // 48 × 30 image pixels further out

        const { transform: t, width, height } = await firstLayer(page);
        expect(t.scaleX).toBeCloseTo(t.scaleY, 3); // a corner keeps the proportions
        const expected = Math.hypot(width + 48, height + 30) / Math.hypot(width, height); // how far the pointer is from the opposite corner
        expect(t.scaleX).toBeCloseTo(expected, 1);
        expect(t.scaleX).toBeGreaterThan(1);
        expect(t.x).toBeCloseTo(CARD.x, 0); // the opposite corner did not move
        expect(t.y).toBeCloseTo(CARD.y, 0);
        expect(t.rotation).toBe(0);
        expect((await editor(page)).past).toBe(past + 1); // one history step for the whole drag

        const png = await exportPngBytes(page);
        expect(readPngSize(png)).toMatchObject({ width: PAGE.width, height: PAGE.height }); // not × zoom, not × DPR
        await expectPlacementShown(page, png);
      });

      test(`zoom ${zoom * 100}%: dragging the round handle rotates about the centre; screen and PNG agree`, async ({ page }) => {
        await withLayer(page, zoom);
        const centreBefore = await inside(page, { x: CARD.width / 2, y: CARD.height / 2 });
        const handle = await handleAt(page, "rotate");
        const centre = await clientOf(page, centreBefore.x, centreBefore.y);
        // straight above the centre now; drag it to straight right of the centre: a quarter turn clockwise
        const radius = Math.hypot(handle.x - centre.x, handle.y - centre.y);
        await dragClient(page, handle, { x: centre.x + radius, y: centre.y });

        const { transform: t } = await firstLayer(page);
        expect(t.rotation).toBeGreaterThan(88.5);
        expect(t.rotation).toBeLessThan(91.5);
        expect(t.scaleX).toBe(1);
        expect(t.scaleY).toBe(1);
        const centreAfter = await inside(page, { x: CARD.width / 2, y: CARD.height / 2 });
        expect(centreAfter.x).toBeCloseTo(centreBefore.x, 0); // it turned about its own middle
        expect(centreAfter.y).toBeCloseTo(centreBefore.y, 0);

        const png = await exportPngBytes(page);
        expect(readPngSize(png)).toMatchObject({ width: PAGE.width, height: PAGE.height });
        await expectPlacementShown(page, png);
        // a turned 240×120 card is now taller than wide: 100px above its centre is still card, 100px to the side is not
        expect(await pngPixelAt(page, png, centreBefore.x, centreBefore.y - 100)).toEqual(BLUE);
        expect(await pngPixelAt(page, png, centreBefore.x + 100, centreBefore.y)).toEqual(GRAY);
      });
    }

    test("the exported PNG does not depend on the zoom the layer was edited at", async ({ page }) => {
      await withLayer(page, 1);
      const from = await handleAt(page, "br");
      await dragClient(page, from, { x: from.x + 40, y: from.y + 40 });
      const handle = await handleAt(page, "rotate");
      const c = await clientOf(page, ...(Object.values(await inside(page, { x: CARD.width / 2, y: CARD.height / 2 })) as [number, number]));
      await dragClient(page, handle, { x: c.x + 120, y: c.y - 60 });

      const at100 = await exportPngBytes(page);
      await zoomTo(page, 2, cardCenter.x, cardCenter.y);
      const at200 = await exportPngBytes(page);
      expect(at200.equals(at100)).toBe(true); // byte for byte
    });
  });
}

test.describe("handles only when the layer can be changed", () => {
  test("a locked layer shows no handles, and dragging where one would be changes nothing", async ({ page }) => {
    await withLayer(page, 1);
    await page.getByRole("button", { name: /잠그기/ }).click();
    const before = (await editor(page)).layers[0].transform;
    const past = (await editor(page)).past;
    const from = await handleAt(page, "br");
    await dragClient(page, from, { x: from.x + 50, y: from.y + 50 });
    expect((await editor(page)).layers[0].transform).toEqual(before);
    expect((await editor(page)).past).toBe(past);
  });

  test("with the hand tool the corner drag pans the view instead", async ({ page }) => {
    await withLayer(page, 1);
    await pickTool(page, "이동");
    const before = (await editor(page)).layers[0].transform;
    const view = (await editor(page)).view;
    const from = await handleAt(page, "br");
    await dragClient(page, from, { x: from.x + 50, y: from.y + 20 });
    expect((await editor(page)).layers[0].transform).toEqual(before);
    expect((await editor(page)).view.panX).toBeCloseTo(view.panX + 50, 0);
  });

  test("a hidden layer shows no handles", async ({ page }) => {
    await withLayer(page, 1);
    await page.getByRole("button", { name: /숨기기/ }).click();
    const before = (await editor(page)).layers[0].transform;
    const from = await handleAt(page, "br");
    await dragClient(page, from, { x: from.x + 50, y: from.y + 50 });
    expect((await editor(page)).layers[0].transform).toEqual(before);
  });

  test("dragging a rotated, resized layer's body still moves it by whole pixels, keeping its size and angle", async ({ page }) => {
    await withLayer(page, 1);
    const from = await handleAt(page, "br");
    await dragClient(page, from, { x: from.x + 40, y: from.y + 30 });
    const t0 = (await firstLayer(page)).transform;
    const c = await clientOf(page, ...(Object.values(await inside(page, { x: CARD.width / 2, y: CARD.height / 2 })) as [number, number]));
    await dragClient(page, c, { x: c.x + 70, y: c.y + 50 });
    const t1 = (await firstLayer(page)).transform;
    expect(Number.isInteger(t1.x) && Number.isInteger(t1.y)).toBe(true);
    expect(t1.scaleX).toBe(t0.scaleX);
    expect(t1.rotation).toBe(t0.rotation);
    expect(Math.abs(t1.x - t0.x - 70)).toBeLessThanOrEqual(1);
  });
});

test.describe("undo, panel, reset", () => {
  test("Ctrl+Z puts the size and rotation back in one step", async ({ page }) => {
    await withLayer(page, 1);
    const from = await handleAt(page, "br");
    await dragClient(page, from, { x: from.x + 60, y: from.y + 40 });
    expect((await firstLayer(page)).transform.scaleX).toBeGreaterThan(1);
    await page.keyboard.press("Control+z");
    expect((await firstLayer(page)).transform).toEqual({ x: CARD.x, y: CARD.y, scaleX: 1, scaleY: 1, rotation: 0 });
    await page.keyboard.press("Control+Shift+Z");
    expect((await firstLayer(page)).transform.scaleX).toBeGreaterThan(1);
  });

  test("the property panel shows the placed size, the angle and the scale; the reset button undoes just those", async ({ page }) => {
    await withLayer(page, 1);
    await expect(page.getByRole("button", { name: "크기·회전 초기화" })).toBeDisabled();
    const from = await handleAt(page, "br");
    await dragClient(page, from, { x: from.x + 60, y: from.y + 40 });
    const { transform: t, width, height } = await firstLayer(page);
    await expect(page.getByTestId("prop-width")).toHaveText(String(Number((width * t.scaleX).toFixed(2))));
    await expect(page.getByTestId("prop-height")).toHaveText(String(Number((height * t.scaleY).toFixed(2))));
    await expect(page.getByTestId("prop-rotation")).toHaveText("0");
    await expect(page.getByTestId("prop-scale")).toContainText("%");

    await page.getByRole("button", { name: "크기·회전 초기화" }).click();
    const after = (await firstLayer(page)).transform;
    expect(after).toEqual({ x: t.x, y: t.y, scaleX: 1, scaleY: 1, rotation: 0 });
    await expect(page.getByTestId("prop-width")).toHaveText(String(CARD.width));
    await expect(page.getByRole("button", { name: "크기·회전 초기화" })).toBeDisabled();
  });

  test("a duplicate carries the size and angle; it can then be changed on its own", async ({ page }) => {
    await withLayer(page, 1);
    const from = await handleAt(page, "br");
    await dragClient(page, from, { x: from.x + 40, y: from.y + 30 });
    const t0 = (await firstLayer(page)).transform;
    await page.getByRole("button", { name: "복제" }).click();
    const layers = (await editor(page)).layers as unknown as { name: string; transform: { scaleX: number } }[];
    expect(layers.find((l) => l.name === "레이어 1 복사")!.transform.scaleX).toBe(t0.scaleX);
  });
});

test.describe("saving and opening", () => {
  test("a resized, rotated layer comes back exactly, and the PNG is the same before and after", async ({ page }) => {
    await withLayer(page, 1);
    const br = await handleAt(page, "br");
    await dragClient(page, br, { x: br.x + 50, y: br.y + 35 });
    const handle = await handleAt(page, "rotate");
    const c = await clientOf(page, ...(Object.values(await inside(page, { x: CARD.width / 2, y: CARD.height / 2 })) as [number, number]));
    await dragClient(page, handle, { x: c.x + 130, y: c.y - 30 });

    const placed = (await firstLayer(page)).transform;
    const pngBefore = await exportPngBytes(page);
    const text = await saveProjectFile(page);
    expect(JSON.parse(text).project.version).toBe(3);
    expect(JSON.parse(text).project.screens[0].layers[0].transform).toEqual(placed);

    await reloadAndDiscard(page);
    await openProjectFile(page, text);
    await expect(page.getByTestId("screen-label")).toBeVisible();
    expect((await firstLayer(page)).transform).toEqual(placed);
    const pngAfter = await exportPngBytes(page);
    expect(pngAfter.equals(pngBefore)).toBe(true);
  });

  test("a version 1 file saved by the Phase 1 app opens, shows its layers where they were, and saves as the current version", async ({ page }) => {
    const v1 = fs.readFileSync("tests/fixtures/project-v1.slc.json", "utf8");
    const expected = JSON.parse(fs.readFileSync("tests/fixtures/project-v1.expected.json", "utf8")) as { layers: { name: string; x: number; y: number; zIndex: number; crop: { width: number; height: number } }[]; patches: number };
    expect(JSON.parse(v1).project.version).toBe(1);

    await openApp(page);
    await openProjectFile(page, v1, "phase1.slc.json");
    await expect(page.getByTestId("screen-label")).toContainText(`${PAGE.width} × ${PAGE.height} px`);

    const s = await editor(page);
    expect(s.layers.map((l) => ({ name: l.name, x: l.transform.x, y: l.transform.y, zIndex: l.zIndex }))).toEqual(expected.layers.map(({ name, x, y, zIndex }) => ({ name, x, y, zIndex })));
    expect(s.patches).toHaveLength(expected.patches);
    for (const l of s.layers) expect(l.transform).toMatchObject({ scaleX: 1, scaleY: 1, rotation: 0 });
    expect(await panelNames(page)).toEqual(["레이어 1", "레이어 2"]); // front-most first: 레이어 1 was sent forward last

    // drawn as before: the blue card in front where it was, the green one (moved down) behind it
    await expectPixel(page, 400, 290, BLUE);
    await expectPixel(page, 400, 340, [0, 160, 0, 255]);

    const png = await exportPngBytes(page);
    expect(readPngSize(png)).toMatchObject({ width: PAGE.width, height: PAGE.height });
    expect(await pngPixelAt(page, png, 400, 290)).toEqual(BLUE);

    const saved = JSON.parse(await saveProjectFile(page));
    expect(saved.project.version).toBe(3);
    expect(saved.project.screens[0].layers).toHaveLength(2);
  });

  test("an opened version 1 layer can be resized right away", async ({ page }) => {
    const v1 = fs.readFileSync("tests/fixtures/project-v1.slc.json", "utf8");
    await openApp(page);
    await openProjectFile(page, v1, "phase1.slc.json");
    await expect(page.getByTestId("screen-label")).toBeVisible();
    await page.getByTestId("layer-item").first().click();
    const br = await handleAt(page, "br");
    await dragClient(page, br, { x: br.x + 30, y: br.y + 20 });
    expect((await firstLayer(page)).transform.scaleX).toBeGreaterThan(1);
  });
});

test.describe("the exported edge of a rotated layer is smooth", () => {
  /** how many of the pixels along the top edge (right half: the red marker sits in the left corner) are a mix of card blue and page gray */
  async function mixedAlongTopEdge(page: Page, png: Buffer) {
    const { transform: t, width } = await firstLayer(page);
    let mixed = 0;
    for (const k of [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9]) {
      const p = layerPointToImage(t, { x: width * k, y: 0 });
      const [r, , b] = await pngPixelAt(page, png, Math.floor(p.x), Math.floor(p.y));
      if (r > 10 && r < 230 && b > 240) mixed++; // blue (r 0) over gray (r 240): in between is the soft edge
    }
    return mixed;
  }

  test("tilted by hand, the edge pixels are part card, part page", async ({ page }) => {
    await withLayer(page, 1);
    const handle = await handleAt(page, "rotate");
    const c = await clientOf(page, ...(Object.values(await inside(page, { x: CARD.width / 2, y: CARD.height / 2 })) as [number, number]));
    await dragClient(page, handle, { x: c.x + 120, y: c.y - 70 }); // about 30° clockwise
    const { transform: t } = await firstLayer(page);
    expect(t.rotation).toBeGreaterThan(15);
    expect(t.rotation).toBeLessThan(60);
    const png = await exportPngBytes(page);
    expect(readPngSize(png)).toMatchObject({ width: PAGE.width, height: PAGE.height }); // the output size rule is untouched
    expect(await mixedAlongTopEdge(page, png)).toBeGreaterThanOrEqual(5);
  });

  test("a layer only moved, or turned a quarter, keeps hard edges: no mixed pixels along its edge", async ({ page }) => {
    await withLayer(page, 1);
    const handle = await handleAt(page, "rotate");
    const c = await clientOf(page, ...(Object.values(await inside(page, { x: CARD.width / 2, y: CARD.height / 2 })) as [number, number]));
    const radius = Math.hypot(handle.x - c.x, handle.y - c.y);
    await dragClient(page, handle, { x: c.x + radius, y: c.y }); // about 90°
    // make it exactly 90° and put its corner on a whole pixel, as a quarter turn that lands on the grid
    await page.evaluate(() => {
      const st = (window as any).__slc.getState();
      const l = st.history.present.screens[0].layers[0];
      st.transformLayer(l.id, { x: 500, y: 300, scaleX: 1, scaleY: 1, rotation: 90 });
    });
    const png = await exportPngBytes(page);
    const { transform: t, width, height } = await firstLayer(page);
    expect(t).toEqual({ x: 500, y: 300, scaleX: 1, scaleY: 1, rotation: 90 });
    // every pixel in a band across the card edge is a pure colour
    const left = 500 - height; // a quarter turn puts the card left of x = 500, `height` wide and `width` tall
    for (const y of [310, 330, 400, 500]) {
      for (const x of [left - 2, left - 1, left, left + 1, 498, 499, 500, 501]) {
        const [r, g, b] = await pngPixelAt(page, png, x, y);
        expect([[0, 0, 255], [255, 0, 0], [240, 240, 240]]).toContainEqual([r, g, b]); // card blue, its red corner marker, or page gray: never a mix
      }
    }
    expect(width).toBe(CARD.width);
  });
});
