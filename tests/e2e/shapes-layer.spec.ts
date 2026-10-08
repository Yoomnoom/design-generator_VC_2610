import { Page, expect, test } from "@playwright/test";
import {
  PAGE, autosaveReady, blank, clientOf, dragClient, drawShape, drawStyleOf, editor, encodePng, exportPngBytes, firstLayer, handleAt, konvaPixels, openProjectFile, panelNames, pickTool, pngPixelAt, readPngSize,
  reloadAndDiscard, saveProjectFile, screenPixel, setColorInput, waitForAutosave, zoomTo,
} from "./helpers";
import { GRAY, GREEN, deselect, diff, setup, useFill, vector } from "./shape-helpers";

async function withRect(page: Page, zoom = 1) {
  await setup(page, zoom);
  await pickTool(page, "사각형");
  await useFill(page, "#00aa00");
  await drawShape(page, "사각형", { x: 600, y: 500 }, { x: 800, y: 600 });
}

test.describe("a shape is a layer like the others", () => {
  test("its colours and width are changed in the property panel, one undo step each; dragging inside the picker adds none", async ({ page }) => {
    await withRect(page);
    await expect(page.getByTestId("vector-section")).toBeVisible();
    const past = (await editor(page)).past;
    await setColorInput(page, "vec-fill", "#112233", { settle: false }); // dragging inside the picker
    await setColorInput(page, "vec-fill", "#223344", { settle: false });
    expect((await editor(page)).past).toBe(past);
    await setColorInput(page, "vec-fill", "#334455"); // it settles
    expect((await editor(page)).past).toBe(past + 1);
    expect((await vector(page)).content.fill).toBe("#334455");

    await page.getByTestId("vec-width").fill("12");
    expect((await editor(page)).past).toBe(past + 1); // typing is not an edit
    await page.getByTestId("vec-width").press("Enter");
    expect((await editor(page)).past).toBe(past + 2);
    expect((await vector(page)).content.strokeWidth).toBe(12);

    await page.getByTestId("vec-width").fill("40");
    await page.getByTestId("vec-width").press("Escape");
    await expect(page.getByTestId("vec-width")).toHaveValue("12");
    expect((await editor(page)).past).toBe(past + 2);

    await page.keyboard.press("Control+z");
    expect((await vector(page)).content.strokeWidth).toBe(3);
    await expect(page.getByTestId("vec-width")).toHaveValue("3"); // the panel follows undo
  });

  test("outline and fill can each be switched off, but not both", async ({ page }) => {
    await withRect(page);
    await page.getByTestId("vec-fill-none").check();
    expect((await vector(page)).content.fill).toBeNull();
    await page.getByTestId("vec-stroke-none").click(); // would leave nothing to draw: refused
    expect((await vector(page)).content.stroke).toBe("#e5322d");
    await expect(page.getByTestId("vec-stroke-none")).not.toBeChecked();
    await page.getByTestId("vec-fill-none").uncheck();
    await page.getByTestId("vec-stroke-none").check(); // now the fill is back, so the outline may go
    expect((await vector(page)).content).toMatchObject({ stroke: null, fill: "#ffd84d" });
  });

  test("dragging moves it by whole pixels; Delete, Ctrl+D, rename, lock work on it", async ({ page }) => {
    await withRect(page);
    const c = await clientOf(page, 700, 550);
    await dragClient(page, c, { x: c.x + 50, y: c.y + 30 });
    expect((await vector(page)).transform).toMatchObject({ x: 650, y: 530 });

    await page.keyboard.press("Control+d");
    expect((await editor(page)).layers).toHaveLength(2);
    expect((await editor(page)).layers[1].transform).toMatchObject({ x: 666, y: 546 });
    await page.keyboard.press("Delete");
    expect((await editor(page)).layers).toHaveLength(1);

    await page.getByTestId("layer-item").click(); // the deleted copy was the selection: pick the original again
    await page.getByTestId("prop-name").fill("Frame");
    await page.getByTestId("prop-name").press("Enter");
    expect(await panelNames(page)).toEqual(["Frame"]);
    await page.getByRole("button", { name: /잠그기/ }).click();
    const d = await clientOf(page, 750, 580);
    await dragClient(page, d, { x: d.x + 80, y: d.y });
    expect((await vector(page)).transform).toMatchObject({ x: 650, y: 530 }); // locked: it did not move
    await page.keyboard.press("Delete");
    expect((await editor(page)).layers).toHaveLength(1);
    await expect(page.getByTestId("vec-width")).toBeDisabled(); // and its look is frozen too
  });

  test("a hidden shape is not in the PNG; shown again it is", async ({ page }) => {
    await withRect(page);
    await page.getByRole("button", { name: /숨기기/ }).click();
    const hidden = await exportPngBytes(page);
    expect(diff(await pngPixelAt(page, hidden, 700, 550), GRAY)).toBeLessThanOrEqual(2);
    await page.getByRole("button", { name: /보이기/ }).click();
    const shown = await exportPngBytes(page);
    expect(diff(await pngPixelAt(page, shown, 700, 550), GREEN)).toBeLessThanOrEqual(2);
  });

  test("stacking: forward and back change what is on top", async ({ page }) => {
    await withRect(page);
    await drawShape(page, "원", { x: 650, y: 450 }, { x: 850, y: 650 });
    expect(await panelNames(page)).toEqual(["원 1", "사각형 1"]);
    await page.getByRole("button", { name: "뒤로" }).click();
    expect(await panelNames(page)).toEqual(["사각형 1", "원 1"]);
  });

  test("resizing by a corner changes the box proportionally and keeps the stroke thickness; the layer's scale stays 1", async ({ page }) => {
    await withRect(page);
    const from = await handleAt(page, "br");
    await dragClient(page, from, { x: from.x + 100, y: from.y + 50 });
    const layer = await vector(page);
    expect(layer.content.strokeWidth).toBe(3);
    expect(layer.transform).toMatchObject({ scaleX: 1, scaleY: 1, rotation: 0, x: 600, y: 500 });
    expect(layer.content.width).toBeGreaterThan(230);
    expect(layer.content.width / layer.content.height).toBeCloseTo(2, 1);
    await expect(page.getByTestId("prop-width")).toHaveText(String(Number(layer.content.width.toFixed(2))));
    expect((await editor(page)).past).toBe(2); // the rectangle, and one resize however long the drag was
    await page.keyboard.press("Control+z");
    expect((await vector(page)).content).toMatchObject({ width: 200, height: 100 });
  });

  test("rotating by the handle turns it about its top-left corner; the PNG matches the screen inside it", async ({ page }) => {
    await withRect(page);
    const handle = await handleAt(page, "rotate");
    const { transform: t, width, height } = await firstLayer(page);
    const centre = await clientOf(page, t.x + width / 2, t.y + height / 2);
    const radius = Math.hypot(handle.x - centre.x, handle.y - centre.y);
    await dragClient(page, handle, { x: centre.x + radius, y: centre.y }); // a quarter turn
    const layer = await vector(page);
    expect(layer.transform.rotation).toBeGreaterThan(87);
    expect(layer.transform.rotation).toBeLessThan(93);
    expect(layer.content).toMatchObject({ width: 200, height: 100 });
    await deselect(page);
    const png = await exportPngBytes(page);
    const r = (layer.transform.rotation * Math.PI) / 180;
    const p = { x: layer.transform.x + Math.cos(r) * 60 - Math.sin(r) * 40, y: layer.transform.y + Math.sin(r) * 60 + Math.cos(r) * 40 };
    expect(diff(await pngPixelAt(page, png, p.x, p.y), GREEN)).toBeLessThanOrEqual(2);
    expect(diff(await screenPixel(page, Math.floor(p.x), Math.floor(p.y)), GREEN)).toBeLessThanOrEqual(3);
  });
});

test.describe("how closely the screen and the PNG agree (measurement)", () => {
  for (const dpr of [1, 2]) {
    test.describe(`devicePixelRatio ${dpr}`, () => {
      test.use({ deviceScaleFactor: dpr });
      test("a rotated, filled, outlined ellipse and a line: the screen's pixels against the PNG's over 100 sample points", async ({ page }) => {
        await setup(page);
        await pickTool(page, "원");
        await useFill(page, "#00aa00");
        await drawShape(page, "원", { x: 560, y: 440 }, { x: 800, y: 560 });
        await page.evaluate(() => {
          const st = (window as any).__slc.getState();
          st.transformLayer(st.selectedLayerIds[0], { x: 640, y: 420, scaleX: 1, scaleY: 1, rotation: 25 });
        });
        await drawShape(page, "선", { x: 500, y: 650 }, { x: 900, y: 700 });
        await deselect(page);
        const png = await exportPngBytes(page);
        const pts: { x: number; y: number }[] = [];
        for (let k = 0; k < 100; k++) pts.push({ x: 560 + ((k * 37) % 340), y: 400 + ((k * 53) % 330) });
        const screen = await konvaPixels(page, await Promise.all(pts.map((p) => clientOf(page, p.x + 0.5, p.y + 0.5))), true);
        let worst = 0;
        let over = 0;
        for (let i = 0; i < pts.length; i++) {
          const d = diff(screen[i], await pngPixelAt(page, png, pts[i].x, pts[i].y));
          worst = Math.max(worst, d);
          if (d > 24) over++;
        }
        console.log(`MEASURE screen vs PNG, DPR ${dpr}, zoom 100%: worst channel difference ${worst}, points over 24: ${over} of ${pts.length}`);
        expect(over).toBeLessThanOrEqual(2); // only a pixel exactly on an anti-aliased edge may differ visibly
      });
    });
  }
});

test.describe("with the rest of the app", () => {
  test("comparing blocks drawing: nothing is made, nothing is recorded", async ({ page }) => {
    await setup(page);
    await page.getByRole("group", { name: "원본 비교" }).getByRole("button", { name: "나란히", exact: true }).click();
    await pickTool(page, "사각형");
    const box = (await page.getByTestId("viewport").boundingBox())!;
    await dragClient(page, { x: box.x + 150, y: box.y + 200 }, { x: box.x + 300, y: box.y + 300 });
    expect(await editor(page)).toMatchObject({ layers: [], past: 0 });
  });

  test("while comparing, a shape's look cannot be edited either", async ({ page }) => {
    await setup(page);
    await drawShape(page, "사각형", { x: 600, y: 500 }, { x: 800, y: 600 });
    await page.getByRole("group", { name: "원본 비교" }).getByRole("button", { name: "원본", exact: true }).click();
    await expect(page.getByTestId("vec-width")).toBeDisabled();
    await expect(page.getByTestId("vec-stroke")).toBeDisabled();
  });

  test("L, M, O and I pick the tools, and are ignored while typing in a field", async ({ page }) => {
    await setup(page);
    for (const [key, name] of [["l", "선"], ["m", "사각형"], ["o", "원"], ["i", "스포이트"]] as const) {
      await page.keyboard.press(key);
      await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
    }
    await page.keyboard.press("m");
    await page.getByTestId("draw-width").focus();
    await page.keyboard.type("lo");
    await expect(page.getByRole("button", { name: "사각형", exact: true })).toHaveAttribute("aria-pressed", "true"); // typing "lo" did not switch tools
  });

  test("Ctrl+C on a shape puts its picture on the clipboard and Ctrl+V pastes it back as a shape, not as a bitmap", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await withRect(page);
    await page.keyboard.press("Control+c");
    await expect.poll(() => page.evaluate(() => !!(window as any).__slc.getState().layerClipboard?.hash)).toBe(true);
    const size = await page.evaluate(async () => {
      const item = (await navigator.clipboard.read())[0];
      const bmp = await createImageBitmap(await item.getType("image/png"));
      return [bmp.width, bmp.height];
    });
    expect(size).toEqual([200 + 4, 100 + 4]); // the box plus the 3px stroke's overhang (2px, rounded up), each side
    await page.keyboard.press("Control+v");
    await expect.poll(async () => (await editor(page)).layers.length).toBe(2);
    const pasted = (await editor(page)).layers[1];
    expect(pasted.content).toMatchObject({ kind: "rect", width: 200, height: 100 });
    expect(pasted.imageId).toBeUndefined();
    expect(pasted.transform).toMatchObject({ x: 616, y: 516 });
  });

  test("the project file holds the shape as a description at the current version, and opens again exactly", async ({ page }) => {
    await withRect(page);
    const before = await exportPngBytes(page);
    const text = await saveProjectFile(page);
    const file = JSON.parse(text);
    expect(file.project.version).toBe(5);
    expect(file.project.screens[0].layers[0].content).toMatchObject({ kind: "rect", fill: "#00aa00" });
    expect(Object.keys(file.images)).toHaveLength(1); // only the capture: the shape has no pixels of its own
    expect(text).not.toMatch(/blob:/);
    await reloadAndDiscard(page);
    await openProjectFile(page, text);
    await expect(page.getByTestId("screen-label")).toBeVisible();
    expect((await vector(page)).content).toMatchObject({ kind: "rect", width: 200, height: 100, fill: "#00aa00" });
    expect((await exportPngBytes(page)).equals(before)).toBe(true);
  });

  test("a shape survives a reload through the temporary save, with its lock", async ({ page }) => {
    await setup(page);
    await pickTool(page, "원");
    await useFill(page, "#00aa00");
    await drawShape(page, "원", { x: 600, y: 450 }, { x: 800, y: 650 });
    await page.getByRole("button", { name: /잠그기/ }).click();
    await expect.poll(async () => (await page.evaluate(() => (window as any).__slc.getState().snapshotProject())).screens[0].layers[0].locked).toBe(true);
    await waitForAutosave(page);
    await expect
      .poll(async () => {
        const rec = await page.evaluate(
          () => new Promise<any>((res) => { const o = indexedDB.open("screenshot-layer-canvas"); o.onsuccess = () => { const q = o.result.transaction("autosave").objectStore("autosave").get("current"); q.onsuccess = () => (o.result.close(), res(q.result)); }; }),
        );
        return rec?.project?.screens?.[0]?.layers?.[0]?.locked === true;
      })
      .toBe(true);
    const before = await exportPngBytes(page);
    await page.reload();
    await autosaveReady(page);
    await page.getByRole("button", { name: "복원" }).click();
    await expect(page.getByTestId("screen-label")).toBeVisible();
    expect(await vector(page)).toMatchObject({ locked: true, name: "원 1", content: { kind: "ellipse", width: 200, height: 200, fill: "#00aa00" } });
    expect((await exportPngBytes(page)).equals(before)).toBe(true);
  });

  test("a file saved by the previous version opens, and shapes can be drawn on it", async ({ page }) => {
    const fs = await import("node:fs");
    await setup(page);
    await reloadAndDiscard(page);
    await openProjectFile(page, fs.readFileSync("tests/fixtures/project-v2.slc.json", "utf8"), "old.slc.json");
    await expect(page.getByTestId("screen-label")).toBeVisible();
    expect((await editor(page)).layers).toHaveLength(2);
    await zoomTo(page, 1, 700, 500);
    await drawShape(page, "사각형", { x: 600, y: 450 }, { x: 750, y: 530 });
    expect((await editor(page)).layers).toHaveLength(3);
    expect(JSON.parse(await saveProjectFile(page)).project.version).toBe(5);
  });
});

test.describe("big images", () => {
  test("a shape on a 4000 × 3000 image: the colour picker and the export stay usable (measurement)", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/");
    await expect(page.getByTestId("viewport")).toBeVisible();
    await page.getByTestId("file-input").setInputFiles({ name: "big.png", mimeType: "image/png", buffer: encodePng(blank(4000, 3000, [240, 240, 240, 255])) });
    await expect(page.getByTestId("screen-label")).toContainText("4000 × 3000", { timeout: 90_000 });
    await zoomTo(page, 0.15, 2000, 1500);
    await drawShape(page, "사각형", { x: 1000, y: 1000 }, { x: 3000, y: 2000 });
    const t0 = Date.now();
    await pickTool(page, "스포이트");
    const c = await clientOf(page, 2000, 1500);
    await page.mouse.click(c.x, c.y);
    await expect.poll(async () => (await drawStyleOf(page)).stroke).toBe("#f0f0f0");
    const pick = Date.now() - t0;
    const t1 = Date.now();
    const png = await exportPngBytes(page);
    const exportMs = Date.now() - t1;
    expect(readPngSize(png)).toMatchObject({ width: 4000, height: 3000 });
    console.log(`MEASURE 4000x3000, one 2000x1000 rectangle: eyedropper click to colour ${pick} ms (includes a full render), PNG export ${exportMs} ms`);
    expect(pick).toBeLessThan(20_000);
  });
});
