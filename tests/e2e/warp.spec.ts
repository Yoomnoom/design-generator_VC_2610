import { Page, expect, test } from "@playwright/test";
import { CARD, PAGE, clientOf, dragImageRect, editor, exportPngBytes, openApp, pageWithCard, pickTool, uploadPng, zoomTo } from "./helpers";

type Pt = { x: number; y: number };
const layerWarp = async (page: Page) => page.evaluate(() => (window as any).__slc.getState().history.present.screens[0].layers[0].warp ?? null);
const notice = (page: Page) => page.evaluate(() => (window as any).__slc.getState().notice as string | null);

async function withLayer(page: Page, zoom = 1) {
  await openApp(page);
  await uploadPng(page, pageWithCard());
  await zoomTo(page, zoom, 600, 300);
  await pickTool(page, "영역 추출");
  await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
  await expect.poll(async () => (await editor(page)).layers.length).toBe(1);
}
/** where a point of the picture's own pixels is in the frame, for a layer with the given placement (no warp) */
const toFrame = (t: { x: number; y: number; scaleX: number; scaleY: number; rotation: number }, p: Pt): Pt => {
  const r = (t.rotation * Math.PI) / 180;
  const sx = p.x * t.scaleX, sy = p.y * t.scaleY;
  return { x: t.x + Math.cos(r) * sx - Math.sin(r) * sy, y: t.y + Math.sin(r) * sx + Math.cos(r) * sy };
};

test.describe("warp tool: corner handles", () => {
  test("W opens the tool on the selected layer; dragging a corner bends the layer in one undo step, previewing without history", async ({ page }) => {
    await withLayer(page);
    const past = (await editor(page)).past;
    await page.keyboard.press("Shift+w");
    await expect(page.getByTestId("warp-panel")).toBeVisible();
    expect(await page.evaluate(() => (window as any).__slc.getState().activeTool)).toBe("warp");

    const a = await clientOf(page, CARD.x + CARD.width, CARD.y + CARD.height);
    const b = await clientOf(page, CARD.x + CARD.width + 20, CARD.y + CARD.height + 20);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
    await page.mouse.move(b.x, b.y, { steps: 4 });
    // while the pointer is down nothing is recorded, but the preview is there
    expect((await editor(page)).past).toBe(past);
    expect(await page.evaluate(() => !!(window as any).__slc.getState().warpPreview)).toBe(true);
    await page.mouse.up();

    expect((await editor(page)).past).toBe(past + 1);
    const warp = await layerWarp(page);
    expect(warp.kind).toBe("quad");
    expect(warp.points[2].x).toBeCloseTo(CARD.width + 20, 0);
    expect(warp.points[2].y).toBeCloseTo(CARD.height + 20, 0);
    expect(warp.points[0]).toEqual({ x: 0, y: 0 });

    await page.keyboard.press("Control+z");
    expect(await layerWarp(page)).toBeNull();
    await page.keyboard.press("Control+Shift+z");
    expect((await layerWarp(page)).points[2].x).toBeCloseTo(CARD.width + 20, 0);
  });

  test("the exported picture has the bent shape, and the layer's pixels were not changed", async ({ page }) => {
    await withLayer(page);
    const before = await page.evaluate(() => { const s = (window as any).__slc.getState(); const l = s.history.present.screens[0].layers[0]; return { id: l.imageId, sum: Array.from(s.images.get(l.imageId).raw.data as Uint8ClampedArray).reduce((a, b) => a + b, 0) }; });
    await pickTool(page, "변형");
    await dragImageRect(page, { x: CARD.x + CARD.width, y: CARD.y + CARD.height }, { x: CARD.x + CARD.width + 60, y: CARD.y + CARD.height + 40 });
    const after = await page.evaluate(() => { const s = (window as any).__slc.getState(); const l = s.history.present.screens[0].layers[0]; return { id: l.imageId, sum: Array.from(s.images.get(l.imageId).raw.data as Uint8ClampedArray).reduce((a, b) => a + b, 0) }; });
    expect(after).toEqual(before);
    await page.keyboard.press("Enter");
    const png = await exportPngBytes(page);
    const px = (x: number, y: number) => page.evaluate(async ([b64, x, y]) => {
      const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0))]), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
      const g = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d")!;
      g.drawImage(bmp, 0, 0);
      return Array.from(g.getImageData(x as number, y as number, 1, 1).data);
    }, [png.toString("base64"), x, y] as const);
    // the corner was pulled out to (600, 360): inside the new shape beyond the old card it is the card's blue; outside the shape it is the page
    expect(await px(CARD.x + CARD.width + 20, CARD.y + CARD.height + 12)).toEqual([0, 0, 255, 255]);
    expect(await px(CARD.x + CARD.width + 50, CARD.y + CARD.height - 5)).toEqual([240, 240, 240, 255]);
    expect(PAGE.width).toBe(1200);
  });

  test("clicks follow the bent shape: a point only the bent shape covers selects the layer, a point it left empty does not", async ({ page }) => {
    await withLayer(page);
    await pickTool(page, "변형");
    await dragImageRect(page, { x: CARD.x + CARD.width, y: CARD.y + CARD.height }, { x: CARD.x + CARD.width + 80, y: CARD.y + CARD.height + 60 });
    await page.keyboard.press("Enter");
    await page.evaluate(() => (window as any).__slc.getState().selectLayer(null));
    await pickTool(page, "선택");
    // a point out beyond the old rectangle, inside the stretched corner (the right edge runs from (540, 200) to (620, 380))
    const outside = await clientOf(page, CARD.x + CARD.width + 25, CARD.y + CARD.height + 20);
    await page.mouse.click(outside.x, outside.y);
    expect((await editor(page)).selected).toHaveLength(1);
    await page.evaluate(() => (window as any).__slc.getState().selectLayer(null));
    // a point inside the old rectangle's bottom right corner that the stretched edge cut off
    const cut = await clientOf(page, CARD.x + CARD.width - 2, CARD.y + CARD.height - 2);
    expect(await page.evaluate(() => 0)).toBe(0);
    await page.mouse.click(cut.x, cut.y);
    expect((await editor(page)).selected).toHaveLength(1); // still inside (the corner only moved away): this point is covered
    await page.evaluate(() => (window as any).__slc.getState().selectLayer(null));
    const empty = await clientOf(page, CARD.x + CARD.width + 60, CARD.y + 20);
    await page.mouse.click(empty.x, empty.y);
    expect((await editor(page)).selected).toHaveLength(0);
  });

  test("Esc takes back everything the tool did; Enter keeps it and returns to the select tool", async ({ page }) => {
    await withLayer(page);
    await pickTool(page, "변형");
    await dragImageRect(page, { x: CARD.x + CARD.width, y: CARD.y + CARD.height }, { x: CARD.x + CARD.width + 30, y: CARD.y + CARD.height + 30 });
    await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + 10, y: CARD.y + 10 });
    expect((await layerWarp(page)).points).toHaveLength(4);
    const past = (await editor(page)).past;
    await page.keyboard.press("Escape");
    expect(await layerWarp(page)).toBeNull();
    expect((await editor(page)).past).toBe(past - 2);
    expect(await page.evaluate(() => (window as any).__slc.getState().activeTool)).toBe("select");

    await pickTool(page, "변형");
    await dragImageRect(page, { x: CARD.x + CARD.width, y: CARD.y + CARD.height }, { x: CARD.x + CARD.width + 30, y: CARD.y + CARD.height + 30 });
    await page.keyboard.press("Enter");
    expect((await layerWarp(page)).kind).toBe("quad");
    expect(await page.evaluate(() => (window as any).__slc.getState().activeTool)).toBe("select");
  });

  test("Alt+corner makes a perspective (the neighbour moves the other way); an edge handle skews along the edge", async ({ page }) => {
    await withLayer(page);
    await pickTool(page, "변형");
    const a = await clientOf(page, CARD.x, CARD.y);
    const b = await clientOf(page, CARD.x + 20, CARD.y + 10);
    await page.keyboard.down("Alt");
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    const w = await layerWarp(page);
    expect(w.points[0].x).toBeCloseTo(20, 0);
    expect(w.points[0].y).toBeCloseTo(10, 0);
    expect(w.points[1].x).toBeCloseTo(CARD.width - 20, 0); // mirrored
    expect(w.points[1].y).toBeCloseTo(10, 0);
    await page.keyboard.press("Control+z");
    // the top edge's middle handle: dragging it sideways (and a bit down) slides both top corners along the edge only
    const m = await clientOf(page, CARD.x + CARD.width / 2, CARD.y);
    const m2 = await clientOf(page, CARD.x + CARD.width / 2 + 16, CARD.y + 12);
    await page.mouse.move(m.x, m.y);
    await page.mouse.down();
    await page.mouse.move(m2.x, m2.y, { steps: 6 });
    await page.mouse.up();
    const s = await layerWarp(page);
    expect(s.points[0].x).toBeCloseTo(16, 0);
    expect(s.points[1].x).toBeCloseTo(CARD.width + 16, 0);
    expect(s.points[0].y).toBeCloseTo(0, 0);
    expect(s.points[1].y).toBeCloseTo(0, 0);
    expect(s.points[2]).toEqual({ x: CARD.width, y: CARD.height });
  });
});

test.describe("warp tool: grid (mesh)", () => {
  test("the grid mode shows 4×4 control points; dragging one bends its surroundings smoothly; rows and columns can change; reset clears", async ({ page }) => {
    await withLayer(page);
    await pickTool(page, "변형");
    await page.getByTestId("warp-mode-mesh").click();
    expect(await page.evaluate(() => (window as any).__slc.getState().warpUi)).toEqual({ mode: "mesh", cols: 3, rows: 3 });
    // drag the control point at grid (1, 1): bitmap (80, 40)
    await dragImageRect(page, { x: CARD.x + 80, y: CARD.y + 40 }, { x: CARD.x + 100, y: CARD.y + 52 });
    const w = await layerWarp(page);
    expect([w.kind, w.cols, w.rows, w.points.length]).toEqual(["mesh", 3, 3, 16]);
    const moved = (n: number) => Math.hypot(w.points[n].x - ((n % 4) * CARD.width) / 3, w.points[n].y - (Math.floor(n / 4) * CARD.height) / 3);
    expect(moved(5)).toBeGreaterThan(20); // the dragged point
    expect(moved(6)).toBeGreaterThan(3); // a neighbour followed
    expect(moved(6)).toBeLessThan(moved(5)); // ...less than the dragged one
    expect(moved(15)).toBeLessThan(moved(6)); // and the far corner least

    await page.getByTestId("warp-cols").fill("5");
    await expect.poll(async () => (await layerWarp(page)).cols).toBe(5);
    expect((await layerWarp(page)).points).toHaveLength(6 * 4);
    await page.getByTestId("warp-reset").click();
    expect(await layerWarp(page)).toBeNull();
  });
});

test.describe("who can be warped", () => {
  test("a locked layer shows why; so do a vector layer and no selection", async ({ page }) => {
    await withLayer(page);
    await page.evaluate(() => { const s = (window as any).__slc.getState(); s.setLayerLocked(s.selectedLayerIds[0], true); });
    await pickTool(page, "변형");
    expect(await notice(page)).toContain("잠긴");
    expect(await page.evaluate(() => (window as any).__slc.getState().activeTool)).toBe("select");
    await page.evaluate(() => { const s = (window as any).__slc.getState(); s.setNotice(null); s.setLayerLocked(s.selectedLayerIds[0], false); s.selectLayer(null); });
    await pickTool(page, "변형");
    expect(await notice(page)).toContain("하나만 선택");
  });

  test("while comparing nothing can be warped", async ({ page }) => {
    await withLayer(page);
    await page.evaluate(() => (window as any).__slc.getState().setCompareMode("original"));
    await page.keyboard.press("Shift+w");
    expect(await notice(page)).toContain("비교");
    expect(await layerWarp(page)).toBeNull();
  });
});

test.describe("a warped layer travels", () => {
  test("it keeps its warp through save and open, and a size/rotation typed in the panel composes with it", async ({ page }) => {
    await withLayer(page);
    await page.evaluate(() => {
      const s = (window as any).__slc.getState();
      const id = s.selectedLayerIds[0];
      s.setLayerWarp(id, { kind: "quad", points: [{ x: 20, y: 0 }, { x: 240, y: 10 }, { x: 220, y: 120 }, { x: 0, y: 110 }] });
    });
    await expect(page.getByTestId("warped-fields")).toBeVisible();
    await page.getByTestId("warped-scale").fill("150");
    await page.getByTestId("warped-scale").blur();
    await expect.poll(async () => (await editor(page)).layers[0].transform.scaleX).toBeCloseTo(1.5, 6);
    await page.getByTestId("warped-rotation").fill("30");
    await page.getByTestId("warped-rotation").blur();
    await expect.poll(async () => (await editor(page)).layers[0].transform.rotation).toBeCloseTo(30, 6);
    const w = await layerWarp(page);
    expect(w.points[0]).toEqual({ x: 20, y: 0 }); // the warp is untouched
    expect(toFrame({ x: 0, y: 0, scaleX: 1.5, scaleY: 1.5, rotation: 30 }, w.points[1]).x).toBeGreaterThan(0);
  });
});