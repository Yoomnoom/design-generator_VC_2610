import { Page, expect, test } from "@playwright/test";
import { CARD, CARD2, autosaveReady, clientOf, dragImageRect, drawShape, editor, openApp, openProjectFile, pageWithTwoCards, pickTool, reloadAndDiscard, saveProjectFile, uploadPng, waitForAutosave, zoomTo } from "./helpers";

/* three layers: card A (bitmap, 300..540 × 200..320), card B (bitmap, 700..900 × 200..300) and a rectangle R (vector, 320..400 × 340..380) */
const A = { x: CARD.x + CARD.width / 2, y: CARD.y + CARD.height / 2 };
const B = { x: CARD2.x + CARD2.width / 2, y: CARD2.y + CARD2.height / 2 };
const R = { x: 360, y: 360 };

type Layer = Awaited<ReturnType<typeof editor>>["layers"][number];
const layers = async (page: Page) => (await editor(page)).layers;
const selected = (page: Page) => page.evaluate(() => (window as any).__slc.getState().selectedLayerIds as string[]);
const at = async (page: Page, id: string) => {
  const l = (await layers(page)).find((x) => x.id === id) as Layer;
  return [l.transform.x, l.transform.y];
};
const setSnap = async (page: Page, on: boolean) => {
  const box = page.getByTestId("snap-toggle");
  if ((await box.isChecked()) !== on) await box.click();
  await expect(box).toBeChecked({ checked: on });
};

async function scene(page: Page, opts: { zoom?: number; centre?: { x: number; y: number }; snap?: boolean } = {}) {
  await openApp(page);
  await uploadPng(page, pageWithTwoCards());
  await zoomTo(page, 1, 600, 330);
  await pickTool(page, "영역 추출");
  await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
  await pickTool(page, "영역 추출"); // extracting switches to the select tool, so choose it again
  await dragImageRect(page, { x: CARD2.x, y: CARD2.y }, { x: CARD2.x + CARD2.width, y: CARD2.y + CARD2.height });
  await drawShape(page, "사각형", { x: 320, y: 340 }, { x: 400, y: 380 });
  await pickTool(page, "선택");
  await expect.poll(async () => (await layers(page)).length).toBe(3);
  const [a, b, r] = (await layers(page)).map((l) => l.id);
  await zoomTo(page, opts.zoom ?? 1, opts.centre?.x ?? 600, opts.centre?.y ?? 330);
  await setSnap(page, opts.snap ?? false); // the group tests are about the group, not about where it lands
  await deselect(page);
  return { a, b, r };
}
async function deselect(page: Page) {
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
async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number, o: { hold?: boolean; alt?: boolean; shift?: boolean } = {}) {
  const a = await clientOf(page, from.x, from.y);
  const b = await clientOf(page, from.x + dx, from.y + dy);
  if (o.shift) await page.keyboard.down("Shift");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  if (o.alt) await page.keyboard.down("Alt");
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  if (o.hold) return;
  await page.mouse.up();
  if (o.alt) await page.keyboard.up("Alt");
  if (o.shift) await page.keyboard.up("Shift");
}
const guides = (page: Page) => page.evaluate(() => (window as any).__slc.getState().snapGuides as { x1: number; y1: number; x2: number; y2: number; kind: string; label?: string }[]);

test.describe("choosing several layers", () => {
  test("Shift+click on the canvas adds a layer to the selection and takes it out again; the panel counts them", async ({ page }) => {
    const { a, b, r } = await scene(page);
    await click(page, A);
    expect(await selected(page)).toEqual([a]);
    await click(page, B, ["Shift"]);
    expect(await selected(page)).toEqual([a, b]);
    await click(page, R, ["Control"]);
    expect(await selected(page)).toEqual([a, b, r]);
    await expect(page.getByTestId("multi-note")).toContainText("3개 선택됨");
    await expect(page.getByTestId("multi-panel")).toContainText("선택 레이어 3개");
    await click(page, B, ["Shift"]);
    expect(await selected(page)).toEqual([a, r]);
    await expect(page.locator('[data-testid="layer-item"][aria-current="true"]')).toHaveCount(2);
  });

  test("a plain click on a member of the selection narrows it to that layer; a plain click on empty canvas clears it", async ({ page }) => {
    const { a, b } = await scene(page);
    await click(page, A);
    await click(page, B, ["Shift"]);
    await click(page, B);
    expect(await selected(page)).toEqual([b]);
    await click(page, A);
    await click(page, B, ["Shift"]);
    await deselect(page);
    expect(await selected(page)).toEqual([]);
    expect(a).not.toBe(b);
  });

  test("the layer list does the same with Shift or Ctrl; a plain click chooses one", async ({ page }) => {
    const { a, b, r } = await scene(page);
    const items = page.getByTestId("layer-item"); // front first: R, B, A
    await items.nth(2).click();
    expect(await selected(page)).toEqual([a]);
    await items.nth(1).click({ modifiers: ["Shift"] });
    expect(await selected(page)).toEqual([a, b]);
    await items.nth(0).click({ modifiers: ["Control"] });
    expect(await selected(page)).toEqual([a, b, r]);
    await items.nth(1).click({ modifiers: ["Control"] });
    expect(await selected(page)).toEqual([a, r]);
    await items.nth(1).click();
    expect(await selected(page)).toEqual([b]);
  });

  test("Ctrl+A selects every layer; typing in a field keeps Ctrl+A for the field", async ({ page }) => {
    const { a, b, r } = await scene(page);
    await page.keyboard.press("Control+a");
    expect(await selected(page)).toEqual([a, b, r]);
    await deselect(page);
    await click(page, A);
    await page.getByTestId("prop-name").focus();
    await page.keyboard.press("Control+a"); // selects the text in the name field, not the layers
    expect(await selected(page)).toEqual([a]);
  });

  test("with several chosen: no resize handles, no property fields, and duplicate / order / copy are off", async ({ page }) => {
    await scene(page);
    await click(page, A);
    await expect(page.getByTestId("prop-x")).toBeVisible();
    await click(page, B, ["Shift"]);
    await expect(page.getByTestId("prop-x")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "복제" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "앞으로" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "뒤로" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "삭제" })).toBeEnabled();
    const before = (await editor(page)).past;
    await page.keyboard.press("Control+d");
    await expect(page.getByTestId("notice")).toContainText("복제할 수 없습니다");
    await page.keyboard.press("Control+c");
    await expect(page.getByTestId("notice")).toContainText("복사할 수 없습니다");
    expect((await layers(page)).length).toBe(3);
    expect((await editor(page)).past).toBe(before);
    // handles: the transformer holds no node, so a corner of the layer is not a handle
    const handles = await page.evaluate(() => {
      const Konva = (window as any).Konva;
      const tr = Konva?.stages?.[0]?.find("Transformer")[0];
      return tr ? tr.nodes().length : 0;
    });
    expect(handles).toBe(0);
  });
});

for (const [dpr, zoom] of [[1, 1], [1, 2], [2, 2]] as const) {
  test.describe(`dragging a selection, devicePixelRatio ${dpr}, zoom ${zoom * 100}%`, () => {
    test.use({ deviceScaleFactor: dpr });
    test("dragging one of the selected layers moves all of them by the same image distance, as one undo step", async ({ page }) => {
      const { a, b, r } = await scene(page, { zoom, centre: { x: 450, y: 290 } });
      await click(page, A);
      await click(page, R, ["Shift"]);
      const [ax, ay] = await at(page, a);
      const [rx, ry] = await at(page, r);
      const [bx, by] = await at(page, b);
      const before = (await editor(page)).past;
      await drag(page, A, 21, 13);
      expect(await at(page, a)).toEqual([ax + 21, ay + 13]);
      expect(await at(page, r)).toEqual([rx + 21, ry + 13]);
      expect(await at(page, b)).toEqual([bx, by]);
      expect((await editor(page)).past).toBe(before + 1);
      expect(await selected(page)).toEqual([a, r]);
      await page.keyboard.press("Control+z");
      expect(await at(page, a)).toEqual([ax, ay]);
      expect(await at(page, r)).toEqual([rx, ry]);
      await page.keyboard.press("Control+Shift+z");
      expect(await at(page, r)).toEqual([rx + 21, ry + 13]);
    });
  });
}

test.describe("moving a selection", () => {
  test("while dragging, the other selected layers are shown moving along, and nothing is stored until the drop", async ({ page }) => {
    const { a, r } = await scene(page);
    await click(page, A);
    await click(page, R, ["Shift"]);
    const [rx, ry] = await at(page, r);
    const before = (await editor(page)).past;
    await drag(page, A, 30, 20, { hold: true });
    expect(await at(page, r)).toEqual([rx, ry]); // not stored yet
    expect((await editor(page)).past).toBe(before);
    const preview = await page.evaluate(() => (window as any).__slc.getState().dragPreview as { layerId: string; x: number; y: number } | null);
    expect(preview?.layerId).toBe(a);
    // the rectangle (an outline, 3 px red) is drawn 30 × 20 px away from where it was: red on its new left edge, page grey on the old one
    const px = async (p: { x: number; y: number }) => {
      const c = await clientOf(page, p.x, p.y);
      return page.evaluate(([cx, cy]) => {
        const canvas = document.querySelector(".konvajs-content canvas") as HTMLCanvasElement;
        const box = canvas.getBoundingClientRect();
        const k = canvas.width / box.width;
        return Array.from(canvas.getContext("2d")!.getImageData(Math.round(((cx as number) - box.left) * k), Math.round(((cy as number) - box.top) * k), 1, 1).data);
      }, [c.x, c.y]);
    };
    await page.waitForTimeout(200); // let the canvas draw the frame after the last move
    const newEdge = await px({ x: 320 + 30, y: 340 + 20 + 20 }); // the new left edge, halfway down
    const oldEdge = await px({ x: 320, y: 340 + 20 }); // the old left edge, now empty page
    expect(newEdge.slice(0, 3)).not.toEqual([240, 240, 240]); // the red line and its blue selection outline are both on the new edge
    expect(oldEdge.slice(0, 3)).toEqual([240, 240, 240]);
    await page.mouse.up();
    expect((await editor(page)).past).toBe(before + 1);
  });

  test("a locked layer in the selection stays where it is; the others move", async ({ page }) => {
    const { a, r } = await scene(page);
    await page.locator('[data-testid="layer-item"]').nth(0).locator("xpath=..").getByRole("button", { name: /잠그기$/ }).click(); // R is first (front)
    await click(page, A);
    await click(page, R, ["Shift"]);
    const [rx, ry] = await at(page, r);
    const [ax, ay] = await at(page, a);
    await drag(page, A, 15, 10);
    expect(await at(page, a)).toEqual([ax + 15, ay + 10]);
    expect(await at(page, r)).toEqual([rx, ry]);
  });

  test("Shift-dragging a layer that was in the selection takes it out and does not move it", async ({ page }) => {
    const { a, r } = await scene(page);
    await click(page, A);
    await click(page, R, ["Shift"]);
    const [rx, ry] = await at(page, r);
    await drag(page, R, 25, 25, { shift: true });
    expect(await at(page, r)).toEqual([rx, ry]);
    expect(await selected(page)).toEqual([a]);
  });

  test("dragging a layer that is not selected moves only that layer and selects it", async ({ page }) => {
    const { a, b, r } = await scene(page);
    await click(page, A);
    await click(page, R, ["Shift"]);
    const [bx, by] = await at(page, b);
    const [ax, ay] = await at(page, a);
    await drag(page, B, -20, 15);
    expect(await at(page, b)).toEqual([bx - 20, by + 15]);
    expect(await at(page, a)).toEqual([ax, ay]);
    expect(await selected(page)).toEqual([b]);
    expect(r).toBeTruthy();
  });

  test("the arrow keys move every selected layer: 1 px, Shift 10 px, a burst is one undo step", async ({ page }) => {
    const { a, b, r } = await scene(page);
    await page.keyboard.press("Control+a");
    const start = await Promise.all([a, b, r].map((id) => at(page, id)));
    const before = (await editor(page)).past;
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+ArrowDown");
    for (const [i, id] of [a, b, r].entries()) expect(await at(page, id)).toEqual([start[i][0] + 1, start[i][1] + 20]);
    expect((await editor(page)).past).toBe(before + 1);
    await page.keyboard.press("Control+z");
    for (const [i, id] of [a, b, r].entries()) expect(await at(page, id)).toEqual(start[i]);
  });

  test("nothing moves, by drag or by key, while comparing", async ({ page }) => {
    const { a, r } = await scene(page);
    await click(page, A);
    await click(page, R, ["Shift"]);
    const pa = await at(page, a);
    await page.evaluate(() => (window as any).__slc.getState().setCompareMode("split"));
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Delete");
    expect(await at(page, a)).toEqual(pa);
    expect((await layers(page)).length).toBe(3);
    await page.evaluate(() => (window as any).__slc.getState().setCompareMode("off"));
    expect(r).toBeTruthy();
  });
});

test.describe("deleting a selection", () => {
  test("Delete removes every chosen layer as one undo step; undo brings them back, in order", async ({ page }) => {
    const { a, b, r } = await scene(page);
    await click(page, A);
    await click(page, R, ["Shift"]);
    const before = (await editor(page)).past;
    await page.keyboard.press("Delete");
    expect((await layers(page)).map((l) => l.id)).toEqual([b]);
    expect((await editor(page)).past).toBe(before + 1);
    expect(await selected(page)).toEqual([]);
    await page.keyboard.press("Control+z");
    expect((await layers(page)).map((l) => l.id)).toEqual([a, b, r]);
  });

  test("the Delete button does the same; a locked layer is kept and the reason is shown", async ({ page }) => {
    const { a, b, r } = await scene(page);
    await page.locator('[data-testid="layer-item"]').nth(1).locator("xpath=..").getByRole("button", { name: /잠그기$/ }).click(); // B
    await page.keyboard.press("Control+a");
    await page.getByRole("button", { name: "삭제" }).click();
    expect((await layers(page)).map((l) => l.id)).toEqual([b]);
    expect(await selected(page)).toEqual([b]);
    await expect(page.locator("body")).toContainText("잠긴 레이어 1개는 삭제되지 않았습니다");
    expect([a, r].every((id) => id)).toBe(true);
  });
});

test.describe("snapping", () => {
  test("a layer dragged near another's edge snaps onto it: aligned, exactly, and a guide is drawn while dragging and gone after the drop", async ({ page }) => {
    const { a, b } = await scene(page, { snap: true });
    const [bx, by] = await at(page, b);
    await click(page, A);
    // B is at x 700..900, y 200..300; A is 240 × 120 at (300, 200): drag so A's top is 3 px below B's top and its right edge 8 px left of B's left
    await drag(page, A, 700 - 8 - 240 + 3 - 300, 3, { hold: true });
    const g = await guides(page);
    expect(g.length).toBeGreaterThan(0);
    expect(g.some((x) => x.kind === "gap" && x.label === "8")).toBe(true);
    // the guide is on the canvas (pink), not only in the store
    const pink = await page.evaluate(() => {
      const canvas = document.querySelector(".konvajs-content canvas") as HTMLCanvasElement;
      const d = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i] - d[i + 1] > 60 && d[i + 2] - d[i + 1] > 20) n++; // pinkish: the guide, anti-aliased on grey
      return n;
    });
    expect(pink).toBeGreaterThan(30);
    await page.mouse.up();
    expect(await at(page, a)).toEqual([700 - 8 - 240, by]); // the gap is exactly 8 and the tops line up
    expect(await guides(page)).toEqual([]);
    expect(bx).toBe(700);
  });

  test("a layer dragged near the frame's edge snaps to the edge", async ({ page }) => {
    const { a } = await scene(page, { snap: true, zoom: 1, centre: { x: 400, y: 330 } });
    await click(page, A);
    await drag(page, A, -300 + 4, 0);
    expect((await at(page, a))[0]).toBe(0);
  });

  test("Alt turns it off for that drag; the switch turns it off for good; hidden layers are not snapped to", async ({ page }) => {
    const { a, b } = await scene(page, { snap: true });
    await click(page, A);
    const target = 700 - 8 - 240 + 3 - 300;
    await drag(page, A, target, 3, { alt: true });
    expect(await at(page, a)).toEqual([300 + target, 203]); // exactly where the mouse put it
    await page.keyboard.press("Control+z");
    await setSnap(page, false);
    await drag(page, A, target, 3);
    expect(await at(page, a)).toEqual([300 + target, 203]);
    await page.keyboard.press("Control+z");
    await setSnap(page, true);
    await page.locator('[data-testid="layer-item"]').nth(1).locator("xpath=..").getByRole("button", { name: /숨기기$/ }).click(); // B hidden
    await drag(page, A, target, 3);
    expect(await at(page, a)).toEqual([300 + target, 203]); // nothing visible to snap to there
    expect(b).toBeTruthy();
  });

  test("a group snaps as one box: it is the group's outer edge that meets the line, even when it belongs to a layer that is not the one dragged", async ({ page }) => {
    const { a, r } = await scene(page, { snap: true, zoom: 1, centre: { x: 400, y: 330 } });
    await click(page, A);
    await click(page, R, ["Shift"]);
    const [rx] = await at(page, r);
    // R is the layer under the mouse; A (300) is the group's left edge. Moving 296 px left puts A 4 px from the frame's edge but R at 24 px:
    // only the group as one box is near a line.
    await drag(page, R, -300 + 4, 0);
    expect((await at(page, a))[0]).toBe(0);
    expect((await at(page, r))[0]).toBe(rx - 300); // R went along by the same distance
  });
  test("zoomed in, the reach is 6 screen pixels: 3 image pixels at 200%", async ({ page }) => {
    const { a } = await scene(page, { snap: true, zoom: 2, centre: { x: 450, y: 290 } });
    await click(page, A);
    await drag(page, A, -300 + 2, 0); // 2 image px from the frame's edge: within 3
    expect((await at(page, a))[0]).toBe(0);
    await page.keyboard.press("Control+z");
    await drag(page, A, -300 + 5, 0); // 5 image px: out of reach at 200%
    expect((await at(page, a))[0]).toBe(5);
  });

  test("the snap switch is shown, on by default", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithTwoCards());
    await expect(page.getByTestId("snap-toggle")).toBeChecked();
  });
});

test.describe("saved and restored", () => {
  test("the places after a group move survive project save/open and the temporary save; the selection is not saved", async ({ page }) => {
    const { a, b, r } = await scene(page);
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    const placed = await Promise.all([a, b, r].map((id) => at(page, id)));
    await autosaveReady(page);
    await waitForAutosave(page);
    const text = await saveProjectFile(page);
    await reloadAndDiscard(page);
    await openProjectFile(page, text);
    await expect.poll(async () => (await layers(page)).length).toBe(3);
    expect(await Promise.all([a, b, r].map((id) => at(page, id)))).toEqual(placed);
    expect(await selected(page)).toEqual([]);
    await waitForAutosave(page);
    await page.reload();
    await expect(page.getByTestId("restore-dialog")).toBeVisible();
    await page.getByRole("button", { name: "복원", exact: true }).click();
    await expect.poll(async () => (await layers(page)).length).toBe(3);
    expect(await Promise.all([a, b, r].map((id) => at(page, id)))).toEqual(placed);
  });
});

test.describe("many layers", () => {
  test("a hundred layers: select all, move them together and delete them, with the time each takes (measurement)", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithTwoCards());
    const t = await page.evaluate(() => {
      const st = () => (window as any).__slc.getState();
      const t0 = performance.now();
      for (let i = 0; i < 100; i++) st().addVectorLayer({ kind: "rect", width: 40, height: 30, stroke: "#112233", strokeWidth: 2, fill: "#ffcc00" }, 20 + (i % 10) * 60, 20 + Math.floor(i / 10) * 50);
      const add = performance.now() - t0;
      const t1 = performance.now();
      st().selectAllLayers();
      const selectAll = performance.now() - t1;
      const first = st().history.present.screens[0].layers[0];
      const t2 = performance.now();
      st().previewLayerDrag(first.id, first.transform.x + 25, first.transform.y + 15);
      st().commitLayerDrag();
      const move = performance.now() - t2;
      const t3 = performance.now();
      st().nudgeLayers(st().selectedLayerIds, 1, 1);
      const nudge = performance.now() - t3;
      const t4 = performance.now();
      st().undo();
      const undo = performance.now() - t4;
      const t5 = performance.now();
      const deleted = st().deleteSelectedLayers();
      const del = performance.now() - t5;
      return { add, selectAll, move, nudge, undo, del, deleted, left: st().history.present.screens[0].layers.length };
    });
    expect(t.deleted).toBe(100);
    expect(t.left).toBe(0);
    console.log(`MEASURE 100 layers: add ${t.add.toFixed(0)} ms, select all ${t.selectAll.toFixed(1)} ms, group move (drop) ${t.move.toFixed(1)} ms, group nudge ${t.nudge.toFixed(1)} ms, undo ${t.undo.toFixed(1)} ms, delete all ${t.del.toFixed(1)} ms`);
    expect(t.move).toBeLessThan(250);
    expect(t.del).toBeLessThan(250);
  });

  test("dragging one of a hundred selected layers stays smooth (frame gaps while dragging, measurement)", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithTwoCards());
    await page.evaluate(() => {
      const st = () => (window as any).__slc.getState();
      for (let i = 0; i < 100; i++) st().addVectorLayer({ kind: "rect", width: 40, height: 30, stroke: "#112233", strokeWidth: 2, fill: "#ffcc00" }, 20 + (i % 10) * 60, 20 + Math.floor(i / 10) * 50);
      st().selectAllLayers();
    });
    await zoomTo(page, 1, 320, 240);
    await page.evaluate(() => {
      const w = window as any;
      w.__gaps = [];
      let last = performance.now();
      const tick = () => {
        const now = performance.now();
        w.__gaps.push(now - last);
        last = now;
        w.__raf = requestAnimationFrame(tick);
      };
      w.__raf = requestAnimationFrame(tick);
    });
    const c = await clientOf(page, 40, 35);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    for (let i = 1; i <= 30; i++) await page.mouse.move(c.x + i * 4, c.y + i * 2);
    const during = await page.evaluate(() => (window as any).__slc.getState().dragPreview);
    await page.mouse.up();
    const gaps = await page.evaluate(() => {
      const w = window as any;
      cancelAnimationFrame(w.__raf);
      const g = (w.__gaps as number[]).slice(1);
      return { frames: g.length, max: Math.round(Math.max(...g)), avg: Math.round((g.reduce((s, v) => s + v, 0) / g.length) * 10) / 10 };
    });
    expect(during).not.toBeNull();
    console.log(`MEASURE dragging 100 selected layers (snap on): ${gaps.frames} frames, average gap ${gaps.avg} ms, longest ${gaps.max} ms`);
  });
});
