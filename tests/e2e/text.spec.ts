import { Page, expect, test } from "@playwright/test";
import {
  GRAY, autosaveReady, clientOf, dragClient, editor, exportPngBytes, handleAt, openApp, openProjectFile, pageWithCard, panelNames, pickTool, readPngSize, reloadAndDiscard, saveProjectFile, setColorInput, uploadPng, waitForAutosave,
  zoomTo, PAGE, blank, encodePng,
} from "./helpers";
import { deselect } from "./shape-helpers";

/** a place on the page away from the card, with room around it at 200% */
const AT = { x: 720, y: 430 };
const WORDS = "Hello 한글 Text\nSecond line gy";

async function setupText(page: Page, zoom = 1) {
  await openApp(page);
  await uploadPng(page, pageWithCard());
  await zoomTo(page, zoom, AT.x, AT.y);
}
const textLayer = async (page: Page) => (await editor(page)).layers.find((l) => l.content?.kind === "text")!;
const activeTool = (page: Page) => page.evaluate(() => (window as any).__slc.getState().activeTool as string);

/** the text tool: click a point, type, then leave with Ctrl+Enter (or another way) */
async function typeBox(page: Page, at: { x: number; y: number }, words: string, finish: "ctrl-enter" | "escape" | "click-away" | "none" = "ctrl-enter") {
  await pickTool(page, "텍스트");
  const c = await clientOf(page, at.x, at.y);
  await page.mouse.click(c.x, c.y);
  const box = page.getByTestId("text-editor");
  await expect(box).toBeVisible();
  await expect(box).toBeFocused();
  const lines = words.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) await page.keyboard.press("Enter"); // a plain Enter is a new line
    if (lines[i]) await page.keyboard.type(lines[i]);
  }
  if (finish === "ctrl-enter") await page.keyboard.press("Control+Enter");
  else if (finish === "escape") await page.keyboard.press("Escape");
  else if (finish === "click-away") {
    await page.waitForTimeout(350); // a person does not leave within a quarter second
    await page.getByRole("button", { name: "선택", exact: true }).click();
  }
}

test.describe("the text tool", () => {
  test("click, type, Ctrl+Enter makes a text layer at the clicked pixel, selected, as one undo step; undo removes it", async ({ page }) => {
    await setupText(page);
    const past = (await editor(page)).past;
    await typeBox(page, AT, WORDS);
    const layer = await textLayer(page);
    expect(layer.content).toMatchObject({ kind: "text", text: WORDS, fontSize: 32, color: "#222222", align: "left", width: 240 });
    expect(layer.transform).toMatchObject({ x: AT.x, y: AT.y, scaleX: 1, scaleY: 1, rotation: 0 });
    expect((await editor(page)).selected).toEqual([layer.id]);
    expect((await editor(page)).past).toBe(past + 1);
    expect(await panelNames(page)).toEqual(["텍스트 1"]);
    expect(await activeTool(page)).toBe("select");
    await expect(page.getByTestId("text-editor")).toHaveCount(0);
    await page.keyboard.press("Control+z");
    expect((await editor(page)).layers).toHaveLength(0);
    await page.keyboard.press("Control+Shift+z");
    expect((await textLayer(page)).content.text).toBe(WORDS);
  });

  test("Escape, and a box with nothing in it, make nothing and leave no undo step", async ({ page }) => {
    await setupText(page);
    const past = (await editor(page)).past;
    await typeBox(page, AT, "gone", "escape");
    await expect(page.getByTestId("text-editor")).toHaveCount(0);
    await typeBox(page, AT, "", "ctrl-enter");
    await typeBox(page, AT, "   ", "ctrl-enter");
    expect((await editor(page)).layers).toHaveLength(0);
    expect((await editor(page)).past).toBe(past);
  });

  test("clicking somewhere else commits too, and the next click then starts the next box", async ({ page }) => {
    await setupText(page);
    await typeBox(page, AT, "first", "click-away");
    await expect.poll(async () => (await editor(page)).layers.length).toBe(1);
    await typeBox(page, { x: AT.x, y: AT.y + 80 }, "second");
    expect((await editor(page)).layers.map((l) => l.content.text)).toEqual(["first", "second"]);
    expect(await panelNames(page)).toEqual(["텍스트 2", "텍스트 1"]);
  });

  test("clicking the canvas elsewhere while a box is open commits it where it was, and opens no second box", async ({ page }) => {
    await setupText(page);
    await pickTool(page, "텍스트");
    const first = await clientOf(page, AT.x, AT.y);
    await page.mouse.click(first.x, first.y);
    await expect(page.getByTestId("text-editor")).toBeFocused();
    await page.keyboard.type("stays here");
    await page.waitForTimeout(350);
    const elsewhere = await clientOf(page, AT.x + 40, AT.y + 150);
    await page.mouse.click(elsewhere.x, elsewhere.y);
    await expect.poll(async () => (await editor(page)).layers.length).toBe(1);
    await expect(page.getByTestId("text-editor")).toHaveCount(0);
    const layer = await textLayer(page);
    expect(layer.content.text).toBe("stays here");
    expect(layer.transform).toMatchObject({ x: AT.x, y: AT.y });
  });
  test("a focus loss in the first instants (the click that opened the box taking the focus back) does not close it; one a moment later does", async ({ page }) => {
    await setupText(page);
    // opened and blurred inside one page task, so how slow the test runner is cannot push the blur past the settling time
    const outcome = await page.evaluate(async ([x, y]) => {
      (window as any).__slc.getState().beginTextEdit({ x, y });
      let el: HTMLTextAreaElement | null = null;
      for (let i = 0; i < 60 && !(el = document.querySelector('[data-testid="text-editor"]')); i++) await new Promise((r) => requestAnimationFrame(r));
      if (!el) return "no editor";
      await new Promise((r) => requestAnimationFrame(r)); // the box has taken the focus
      el.blur();
      await new Promise((r) => setTimeout(r, 60));
      return document.activeElement === el ? "kept" : "lost";
    }, [AT.x, AT.y]);
    expect(outcome).toBe("kept");
    await page.keyboard.type("still here");
    await page.waitForTimeout(350);
    await page.evaluate(() => (document.activeElement as HTMLElement).blur()); // later: the user leaving
    await expect.poll(async () => (await editor(page)).layers.length).toBe(1);
    await expect(page.getByTestId("text-editor")).toHaveCount(0);
    expect((await textLayer(page)).content.text).toBe("still here");
  });
  test("while typing, letters are letters: no tool changes, no deleting layers, arrow keys move the cursor and not a layer", async ({ page }) => {
    await setupText(page);
    await typeBox(page, AT, "first");
    const before = (await textLayer(page)).transform;
    await pickTool(page, "텍스트");
    const c = await clientOf(page, AT.x, AT.y + 120);
    await page.mouse.click(c.x, c.y);
    await expect(page.getByTestId("text-editor")).toBeFocused();
    await page.keyboard.type("vbrmloeit"); // every one of these is a tool key
    await page.keyboard.press("Delete");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("X");
    expect(await activeTool(page)).toBe("text");
    expect(await page.getByTestId("text-editor").inputValue()).toBe("vbrmloeiXt");
    await page.keyboard.press("Control+Enter");
    expect((await editor(page)).layers).toHaveLength(2); // the first box is still there
    expect((await editor(page)).layers[0].transform).toEqual(before);
    expect((await editor(page)).layers[1].content.text).toBe("vbrmloeiXt");
  });

  test("a long text wraps to the box width, and the box is as tall as its lines", async ({ page }) => {
    await setupText(page);
    await typeBox(page, AT, "word ".repeat(40).trim());
    const { content } = await textLayer(page);
    expect(content.width).toBe(240);
    expect(content.height).toBeGreaterThan(41.6 * 3); // several lines of 32 × 1.3
    expect(Math.round((content.height / 41.6) * 100) % 100).toBe(0); // a whole number of lines
  });

  test("a text box shows a thumbnail of its words in the layer list", async ({ page }) => {
    await setupText(page);
    await typeBox(page, AT, WORDS);
    await expect(page.getByTestId("layer-item").first().getByTestId("vector-thumb")).toBeVisible();
  });
});

test.describe("editing an existing text box", () => {
  test("double-click (select tool) opens it with its words; changing them is one undo step", async ({ page }) => {
    await setupText(page);
    await typeBox(page, AT, "old words");
    const { id } = { id: (await textLayer(page)).id };
    await deselect(page);
    const past = (await editor(page)).past;
    const c = await clientOf(page, AT.x + 20, AT.y + 15);
    await page.mouse.dblclick(c.x, c.y);
    const box = page.getByTestId("text-editor");
    await expect(box).toBeVisible();
    await expect(box).toHaveValue("old words");
    await expect(box).toBeFocused();
    expect((await editor(page)).selected).toEqual([id]);
    await page.keyboard.type(" and more");
    await page.keyboard.press("Control+Enter");
    expect((await textLayer(page)).content.text).toBe("old words and more");
    expect((await editor(page)).past).toBe(past + 1);
    await page.keyboard.press("Control+z");
    expect((await textLayer(page)).content.text).toBe("old words");
  });

  test("clearing the words and leaving keeps the old words; Escape drops what was typed", async ({ page }) => {
    await setupText(page);
    await typeBox(page, AT, "keep me");
    const open = async () => {
      const c = await clientOf(page, AT.x + 20, AT.y + 15);
      await page.mouse.dblclick(c.x, c.y);
      await expect(page.getByTestId("text-editor")).toBeFocused();
    };
    const past = (await editor(page)).past;
    await open();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Delete");
    await page.keyboard.press("Control+Enter");
    expect((await textLayer(page)).content.text).toBe("keep me");
    await open();
    await page.keyboard.type("lost");
    await page.keyboard.press("Escape");
    expect((await textLayer(page)).content.text).toBe("keep me");
    expect((await editor(page)).past).toBe(past);
  });

  test("a locked box does not open, and neither does any box while comparing", async ({ page }) => {
    await setupText(page);
    await typeBox(page, AT, "stay");
    const dbl = async () => {
      const c = await clientOf(page, AT.x + 20, AT.y + 15);
      await page.mouse.dblclick(c.x, c.y);
      await page.waitForTimeout(150);
    };
    await page.getByRole("button", { name: /잠그기$/ }).click();
    await dbl();
    await expect(page.getByTestId("text-editor")).toHaveCount(0);
    await page.getByRole("button", { name: /잠금 해제$/ }).click();
    await page.evaluate(() => (window as any).__slc.getState().setCompareMode("split"));
    await dbl();
    await expect(page.getByTestId("text-editor")).toHaveCount(0);
    await page.evaluate(() => (window as any).__slc.getState().setCompareMode("off"));
    await dbl();
    await expect(page.getByTestId("text-editor")).toBeVisible();
  });

  test("the text tool does nothing while comparing", async ({ page }) => {
    await setupText(page);
    await pickTool(page, "텍스트");
    await page.evaluate(() => (window as any).__slc.getState().setCompareMode("original"));
    const c = await clientOf(page, AT.x, AT.y);
    await page.mouse.click(c.x, c.y);
    await page.waitForTimeout(150);
    await expect(page.getByTestId("text-editor")).toHaveCount(0);
  });
});

test.describe("the property panel for a text box", () => {
  test("size, colour, alignment and words each change the box as one undo step, and undo puts them back", async ({ page }) => {
    await setupText(page);
    await typeBox(page, AT, "panel test words that wrap");
    const h0 = (await textLayer(page)).content.height;
    let past = (await editor(page)).past;

    await page.getByTestId("text-size").fill("48");
    await page.getByTestId("text-size").press("Enter");
    await expect.poll(async () => (await textLayer(page)).content.fontSize).toBe(48);
    expect((await textLayer(page)).content.height).toBeGreaterThan(h0); // bigger letters, more lines
    expect((await editor(page)).past).toBe(past + 1);
    past += 1;

    await setColorInput(page, "text-color", "#cc3300");
    await expect.poll(async () => (await textLayer(page)).content.color).toBe("#cc3300");
    expect((await editor(page)).past).toBe(past + 1);
    past += 1;

    await page.getByTestId("text-align-center").click();
    expect((await textLayer(page)).content.align).toBe("center");
    await expect(page.getByTestId("text-align-center")).toHaveAttribute("aria-pressed", "true");
    expect((await editor(page)).past).toBe(past + 1);
    past += 1;

    const body = page.getByTestId("text-content");
    await body.fill("changed in the panel");
    await body.blur();
    await expect.poll(async () => (await textLayer(page)).content.text).toBe("changed in the panel");
    expect((await editor(page)).past).toBe(past + 1);

    // one undo per change, newest first: after each, that one change is gone and the later ones are still undone
    for (const gone of [{ text: "panel test words that wrap" }, { align: "left" }, { color: "#222222" }, { fontSize: 32 }]) {
      await page.keyboard.press("Control+z");
      await expect.poll(async () => (await textLayer(page)).content).toMatchObject(gone);
    }
    expect((await textLayer(page)).content).toMatchObject({ fontSize: 32, color: "#222222", align: "left", text: "panel test words that wrap" });
  });
  test("typing in the panel changes nothing until the field is left; Escape puts the old words back; empty words are refused", async ({ page }) => {
    await setupText(page);
    await typeBox(page, AT, "stay as I am");
    const past = (await editor(page)).past;
    const body = page.getByTestId("text-content");
    await body.fill("half-typed");
    expect((await textLayer(page)).content.text).toBe("stay as I am");
    await body.press("Escape");
    await expect(body).toHaveValue("stay as I am");
    await body.fill("");
    await body.blur();
    await expect(body).toHaveValue("stay as I am");
    expect((await editor(page)).past).toBe(past);
  });

  test("a font size outside 4–400 is brought into range", async ({ page }) => {
    await setupText(page);
    await typeBox(page, AT, "size");
    await page.getByTestId("text-size").fill("1000");
    await page.getByTestId("text-size").press("Enter");
    await expect.poll(async () => (await textLayer(page)).content.fontSize).toBe(400);
    await page.getByTestId("text-size").fill("1");
    await page.getByTestId("text-size").press("Enter");
    await expect.poll(async () => (await textLayer(page)).content.fontSize).toBe(4);
  });

  test("while the text tool is on, the style of the next box can be set, and it is used", async ({ page }) => {
    await setupText(page);
    await pickTool(page, "텍스트");
    await expect(page.getByTestId("text-style")).toBeVisible();
    await page.getByTestId("newtext-size").fill("60");
    await page.getByTestId("newtext-size").press("Enter");
    await page.getByTestId("newtext-align-right").click();
    await setColorInput(page, "newtext-color", "#0033cc");
    await typeBox(page, AT, "styled");
    expect((await textLayer(page)).content).toMatchObject({ fontSize: 60, align: "right", color: "#0033cc" });
  });

  test("locked: the fields are off; the panel cannot change the box", async ({ page }) => {
    await setupText(page);
    await typeBox(page, AT, "locked words");
    await page.getByRole("button", { name: /잠그기$/ }).click();
    for (const id of ["text-size", "text-color", "text-align-left", "text-content"]) await expect(page.getByTestId(id)).toBeDisabled();
  });
});

test.describe("resizing and turning a text box", () => {
  test("the side handle changes the width; the height follows the lines; the letters keep their size", async ({ page }) => {
    await setupText(page);
    await typeBox(page, AT, "a handle test with several words in it");
    const before = await textLayer(page);
    const grab = await clientOf(page, before.transform.x + before.content.width, before.transform.y + before.content.height / 2);
    await dragClient(page, grab, { x: grab.x + 100, y: grab.y });
    await expect.poll(async () => Math.round((await textLayer(page)).content.width)).toBeGreaterThanOrEqual(before.content.width + 90);
    const after = await textLayer(page);
    expect(after.content.width).toBeLessThanOrEqual(before.content.width + 110);
    expect(after.content.fontSize).toBe(32);
    expect(after.transform).toMatchObject({ scaleX: 1, scaleY: 1 });
    expect(after.content.height).toBeLessThan(before.content.height); // wider: fewer lines
    await page.keyboard.press("Control+z");
    expect((await textLayer(page)).content.width).toBe(before.content.width);
  });

  test("the rotation handle turns it; words and size stay", async ({ page }) => {
    await setupText(page);
    await typeBox(page, AT, "turn me");
    const grab = await handleAt(page, "rotate");
    await dragClient(page, grab, { x: grab.x + 120, y: grab.y + 40 });
    await expect.poll(async () => Math.abs((await textLayer(page)).transform.rotation)).toBeGreaterThan(10);
    expect((await textLayer(page)).content).toMatchObject({ text: "turn me", fontSize: 32, width: 240 });
  });
});

test.describe("hidden, saved and restored", () => {
  test("a hidden text box is not in the PNG; shown again it is", async ({ page }) => {
    await setupText(page);
    await typeBox(page, AT, "HIDE ME");
    await page.getByRole("button", { name: /숨기기$/ }).click();
    const hidden = await exportPngBytes(page);
    const hiddenInk = await inkIn(page, hidden, { x: AT.x, y: AT.y, width: 240, height: 45 });
    expect(hiddenInk.sum).toBe(0);
    await page.getByRole("button", { name: /보이기$/ }).click();
    const shown = await exportPngBytes(page);
    expect((await inkIn(page, shown, { x: AT.x, y: AT.y, width: 240, height: 45 })).sum).toBeGreaterThan(1000);
  });

  test("the box, its words and its angle survive a project save and open, and the automatic save", async ({ page }) => {
    await setupText(page);
    await typeBox(page, AT, WORDS);
    await page.getByTestId("text-size").fill("27.5");
    await page.getByTestId("text-size").press("Enter");
    await page.getByTestId("text-align-right").click();
    await page.evaluate(() => {
      const st = (window as any).__slc.getState();
      const l = st.history.present.screens[0].layers[0];
      st.transformLayer(l.id, { x: l.transform.x, y: l.transform.y, scaleX: 1, scaleY: 1, rotation: 12.5 });
    });
    const saved = await textLayer(page);
    expect(saved.content).toMatchObject({ fontSize: 27.5, align: "right" });
    await autosaveReady(page);
    await waitForAutosave(page);
    const text = await saveProjectFile(page);
    expect(JSON.parse(text).project.version).toBe(5);

    await reloadAndDiscard(page);
    await openProjectFile(page, text);
    await expect.poll(async () => (await editor(page)).layers.length).toBe(1);
    expect(await textLayer(page)).toEqual(saved);

    await waitForAutosave(page);
    await page.reload();
    await expect(page.getByTestId("restore-dialog")).toBeVisible();
    await page.getByRole("button", { name: "복원", exact: true }).click();
    await expect.poll(async () => (await editor(page)).layers.length).toBe(1);
    expect(await textLayer(page)).toEqual(saved);
  });

  test("a version 4 project (saved before text boxes existed) opens, and a text box can be added to it", async ({ page }) => {
    const fs = await import("node:fs");
    await openApp(page);
    await openProjectFile(page, fs.readFileSync("tests/fixtures/project-v4.slc.json", "utf8"));
    await expect.poll(async () => (await editor(page)).layers.length).toBe(3);
    await zoomTo(page, 1, AT.x, AT.y);
    await typeBox(page, AT, "added later");
    expect((await editor(page)).layers).toHaveLength(4);
    expect(JSON.parse(await saveProjectFile(page)).project.version).toBe(5);
  });

  test("the PNG keeps the size of the capture, with the text in it", async ({ page }) => {
    await setupText(page);
    await typeBox(page, AT, WORDS);
    const png = await exportPngBytes(page);
    expect(readPngSize(png)).toMatchObject({ width: PAGE.width, height: PAGE.height });
    expect((await inkIn(page, png, { x: AT.x, y: AT.y, width: 240, height: 90 })).sum).toBeGreaterThan(1000);
  });
});

/** how much of a region of a PNG differs from the page grey, summed (0 = nothing there but background) */
async function inkIn(page: Page, png: Buffer, r: { x: number; y: number; width: number; height: number }) {
  return page.evaluate(
    async ([b64, region, bg]) => {
      const rg = region as { x: number; y: number; width: number; height: number };
      const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0))]), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
      const g = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d")!;
      g.drawImage(bmp, 0, 0);
      const d = g.getImageData(rg.x, rg.y, rg.width, rg.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += (Math.abs(d[i] - (bg as number)) + Math.abs(d[i + 1] - (bg as number)) + Math.abs(d[i + 2] - (bg as number))) / 3;
      return { sum };
    },
    [png.toString("base64"), r, GRAY[0]] as const,
  );
}

/* ---- screen against PNG ----------------------------------------------------------------------------------------------------------
 * The canvas and the export draw the same text with the same function, but on different pixel grids (zoom, devicePixelRatio) and, for
 * the export, through a bitmap. This measures how far apart the two results are: each image pixel's "ink" (distance from the page grey)
 * is read from the canvas (averaged over the screen pixels that cover it) and from the PNG, and the two ink maps are compared. */
type Measure = { centroidDx: number; centroidDy: number; bboxDx: number[]; inkRatio: number; meanAbs: number; inkPixels: number };

async function measure(page: Page, png: Buffer, region: { x: number; y: number; width: number; height: number }): Promise<Measure> {
  return page.evaluate(
    async ([b64, r, bg]) => {
      const rg = r as { x: number; y: number; width: number; height: number };
      const st = (window as any).__slc.getState();
      const screen = st.history.present.screens[0];
      const view = st.view as { zoom: number; panX: number; panY: number };
      const canvas = document.querySelector(".konvajs-content canvas") as HTMLCanvasElement;
      const box = canvas.getBoundingClientRect();
      const vbox = document.querySelector('[data-testid="viewport"]')!.getBoundingClientRect();
      const k = canvas.width / box.width;
      const g = canvas.getContext("2d")!;
      const BG = bg as number;
      const ink = (rgb: number[]) => (Math.abs(rgb[0] - BG) + Math.abs(rgb[1] - BG) + Math.abs(rgb[2] - BG)) / 3 / 255;

      const screenMap = new Float64Array(rg.width * rg.height);
      const screenData = g.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let y = 0; y < rg.height; y++)
        for (let x = 0; x < rg.width; x++) {
          const cx0 = (vbox.left + view.panX + (screen.x + rg.x + x) * view.zoom - box.left) * k;
          const cy0 = (vbox.top + view.panY + (screen.y + rg.y + y) * view.zoom - box.top) * k;
          const n = Math.max(1, Math.round(view.zoom * k));
          let sum = 0;
          let count = 0;
          for (let j = 0; j < n; j++)
            for (let i = 0; i < n; i++) {
              const px = Math.round(cx0) + i;
              const py = Math.round(cy0) + j;
              if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
              const o = (py * canvas.width + px) * 4;
              sum += ink([screenData[o], screenData[o + 1], screenData[o + 2]]);
              count++;
            }
          screenMap[y * rg.width + x] = count ? sum / count : 0;
        }

      const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0))]), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
      const pg = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d")!;
      pg.drawImage(bmp, 0, 0);
      const pd = pg.getImageData(rg.x, rg.y, rg.width, rg.height).data;
      const pngMap = new Float64Array(rg.width * rg.height);
      for (let i = 0; i < pngMap.length; i++) pngMap[i] = ink([pd[i * 4], pd[i * 4 + 1], pd[i * 4 + 2]]);

      const stats = (m: Float64Array) => {
        let s = 0, sx = 0, sy = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
        for (let y = 0; y < rg.height; y++)
          for (let x = 0; x < rg.width; x++) {
            const v = m[y * rg.width + x];
            s += v;
            sx += v * x;
            sy += v * y;
            if (v > 0.25) {
              n++;
              x0 = Math.min(x0, x);
              y0 = Math.min(y0, y);
              x1 = Math.max(x1, x);
              y1 = Math.max(y1, y);
            }
          }
        return { s, cx: s ? sx / s : 0, cy: s ? sy / s : 0, bbox: [x0, y0, x1, y1], n };
      };
      const a = stats(screenMap);
      const b = stats(pngMap);
      let abs = 0;
      for (let i = 0; i < pngMap.length; i++) abs += Math.abs(screenMap[i] - pngMap[i]);
      return {
        centroidDx: a.cx - b.cx,
        centroidDy: a.cy - b.cy,
        bboxDx: a.bbox.map((v, i) => v - b.bbox[i]),
        inkRatio: a.s / b.s,
        meanAbs: abs / pngMap.length,
        inkPixels: b.n,
      };
    },
    [png.toString("base64"), region, GRAY[0]] as const,
  );
}

for (const dpr of [1, 2]) {
  test.describe(`screen against PNG, devicePixelRatio ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });
    for (const zoom of [1, 2]) {
      for (const rotation of [0, 15]) {
        test(`zoom ${zoom * 100}%, turned ${rotation}°: the text is where the PNG has it (measurement)`, async ({ page }) => {
          await setupText(page);
          await typeBox(page, AT, "Hello 한글 Text 123\nSecond line gy,;");
          await page.evaluate((rot) => {
            const st = (window as any).__slc.getState();
            const l = st.history.present.screens[0].layers[0];
            st.transformLayer(l.id, { x: l.transform.x, y: l.transform.y, scaleX: 1, scaleY: 1, rotation: rot });
          }, rotation);
          await deselect(page);
          // a whole-pixel pan, so every image pixel covers whole screen pixels and the comparison is not about alignment
          await page.evaluate(
            ([z, cx, cy]) => {
              const st = (window as any).__slc.getState();
              const box = document.querySelector('[data-testid="viewport"]')!.getBoundingClientRect();
              const s = st.history.present.screens[0];
              st.setView({ zoom: z, panX: Math.round(box.width / 2 - (s.x + cx) * z), panY: Math.round(box.height / 2 - (s.y + cy) * z) });
            },
            [zoom, AT.x + 100, AT.y + 40],
          );
          const png = await exportPngBytes(page);
          const region = { x: AT.x - 40, y: AT.y - 40, width: 340, height: 160 };
          const m = await measure(page, png, region);
          console.log(`MEASURE text screen vs PNG dpr=${dpr} zoom=${zoom * 100}% rotation=${rotation}: centroid dx=${m.centroidDx.toFixed(3)} dy=${m.centroidDy.toFixed(3)} px, bbox diff [x0,y0,x1,y1]=${m.bboxDx.join(",")} px, ink ratio ${m.inkRatio.toFixed(3)}, mean |diff| ${m.meanAbs.toFixed(4)}, ink pixels ${m.inkPixels}`);
          expect(m.inkPixels).toBeGreaterThan(200); // there is text to compare
          expect(Math.abs(m.centroidDx)).toBeLessThan(0.5);
          expect(Math.abs(m.centroidDy)).toBeLessThan(0.5);
          for (const d of m.bboxDx) expect(Math.abs(d)).toBeLessThanOrEqual(2);
          expect(m.inkRatio).toBeGreaterThan(0.9);
          expect(m.inkRatio).toBeLessThan(1.1);
        });
      }
    }
  });
}

/* ---- large captures ---- */
for (const [w, h] of [[4000, 3000], [8000, 6000]] as const) {
  test(`text on a ${w} × ${h} capture: adding twenty boxes, editing one, and exporting (measurement)`, async ({ page }) => {
    test.setTimeout(240_000);
    await openApp(page);
    await page.getByTestId("file-input").setInputFiles({ name: "big.png", mimeType: "image/png", buffer: encodePng(blank(w, h, [240, 240, 240, 255])) });
    await expect(page.getByTestId("screen-label")).toContainText(`${w} × ${h}`, { timeout: 120_000 });
    const t = await page.evaluate(([W, H]) => {
      const st = (window as any).__slc.getState();
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) st.addTextLayer(`Box ${i}: 한글과 English, a longer line that has to wrap inside the box`, 100 + (i % 5) * 600, 100 + Math.floor(i / 5) * 500, 480);
      const add = performance.now() - t0;
      const id = (window as any).__slc.getState().history.present.screens[0].layers[0].id; // a fresh read: `st` is the state from before the adds
      const t1 = performance.now();
      st.setTextContent(id, { text: "edited " + "words ".repeat(30), fontSize: 40 });
      return { add, edit: performance.now() - t1, W, H };
    }, [w, h]);
    await expect.poll(async () => (await editor(page)).layers.length).toBe(20);
    await page.waitForTimeout(500);
    const t0 = Date.now();
    const png = await exportPngBytes(page);
    const exportMs = Date.now() - t0;
    expect(readPngSize(png)).toMatchObject({ width: w, height: h });
    const ink = await inkIn(page, png, { x: 100, y: 100, width: 480, height: 200 });
    expect(ink.sum).toBeGreaterThan(1000);
    console.log(`MEASURE text on ${w}x${h}: 20 boxes added in ${t.add.toFixed(0)} ms (${(t.add / 20).toFixed(1)} ms each), one edit (re-wrap, re-fit) ${t.edit.toFixed(1)} ms, PNG export with 20 text boxes ${exportMs} ms (${(png.length / 1048576).toFixed(1)} MB file)`);
  });
}