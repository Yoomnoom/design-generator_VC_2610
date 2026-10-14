import { Page, expect, test } from "@playwright/test";
import { CARD, CARD2, autosaveReady, clientOf, dragImageRect, drawShape, editor, exportPngBytes, openApp, openProjectFile, pageWithTwoCards, pickTool, saveProjectFile, uploadPng, waitForAutosave, zoomTo } from "./helpers";

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

const tool = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const pressed = (page: Page, name: string) => expect(tool(page, name)).toHaveAttribute("aria-pressed", "true");
const state = (page: Page) => page.evaluate(() => { const s = (window as any).__slc.getState(); return { tool: s.activeTool as string, selected: s.selectedLayerIds as string[], draw: s.drawStyle as { stroke: string; fill: string | null; strokeWidth: number }, zoom: s.view.zoom as number }; });

test.describe("Photoshop keys (the default preset)", () => {
  test("tool keys: M extracts, U cycles line, rectangle, ellipse, R is the finger, Shift+W the warp, I the eyedropper", async ({ page }) => {
    await scene(page);
    await click(page, A);
    await page.keyboard.press("m");
    await pressed(page, "영역 추출");
    for (const name of ["선", "사각형", "원", "선"]) {
      await page.keyboard.press("u");
      await pressed(page, name);
    }
    await page.keyboard.press("r");
    await pressed(page, "손가락");
    await page.keyboard.press("Shift+w");
    await pressed(page, "변형");
    await page.keyboard.press("i");
    await pressed(page, "스포이트");
    await page.keyboard.press("l"); // no function for L: nothing happens
    await pressed(page, "스포이트");
    await page.keyboard.press("v");
    await pressed(page, "선택");
  });

  test("Ctrl+J duplicates, Ctrl+D deselects, Ctrl+Shift+I inverts the selection", async ({ page }) => {
    const ids = await scene(page);
    await click(page, A);
    await page.keyboard.press("Control+j");
    await expect.poll(async () => (await layers(page)).length).toBe(4);
    await page.keyboard.press("Control+d");
    expect(await selected(page)).toEqual([]);
    await click(page, B);
    const chosen = await selected(page);
    expect(chosen).toEqual([ids.b]);
    await page.keyboard.press("Control+Shift+i");
    const s = await selected(page);
    expect(s).not.toContain(ids.b);
    expect(s.length).toBe(3); // the other three layers
  });

  test("X swaps the stroke and fill colours, D restores black and white, [ and ] change the size", async ({ page }) => {
    await scene(page);
    await page.evaluate(() => (window as any).__slc.getState().setDrawStyle({ stroke: "#ff0000", fill: "#00ff00", strokeWidth: 8 }));
    await page.keyboard.press("x");
    expect(await state(page)).toMatchObject({ draw: { stroke: "#00ff00", fill: "#ff0000" } });
    await page.keyboard.press("d");
    expect(await state(page)).toMatchObject({ draw: { stroke: "#000000", fill: "#ffffff" } });
    const w0 = (await state(page)).draw.strokeWidth;
    await page.keyboard.press("]");
    expect((await state(page)).draw.strokeWidth).toBeGreaterThan(w0);
    await page.keyboard.press("[");
    await page.keyboard.press("[");
    expect((await state(page)).draw.strokeWidth).toBeLessThan(w0 + 1);
  });

  test("Ctrl+] / Ctrl+[ move one step, Ctrl+Shift+] / [ go to the front and the back; each is one undo step", async ({ page }) => {
    const ids = await scene(page);
    const zOf = async (id: string) => (await page.evaluate((i) => (window as any).__slc.getState().history.present.screens[0].layers.find((l: any) => l.id === i).zIndex as number, id));
    await click(page, A);
    expect(await zOf(ids.a)).toBe(0);
    await page.keyboard.press("Control+]");
    expect(await zOf(ids.a)).toBe(1);
    await page.keyboard.press("Control+Shift+]");
    expect(await zOf(ids.a)).toBe(2);
    await page.keyboard.press("Control+[");
    expect(await zOf(ids.a)).toBe(1);
    await page.keyboard.press("Control+Shift+[");
    expect(await zOf(ids.a)).toBe(0);
    const past = (await editor(page)).past;
    await page.keyboard.press("Control+z");
    expect(await zOf(ids.a)).toBe(1);
    expect((await editor(page)).past).toBe(past - 1);
  });

  test("Ctrl+Alt+Z steps back like Ctrl+Z; Backspace deletes like Delete; Ctrl+= and Ctrl+- zoom; Ctrl+S saves", async ({ page }) => {
    await scene(page);
    await click(page, A);
    await page.keyboard.press("Control+j");
    await expect.poll(async () => (await layers(page)).length).toBe(4);
    await page.keyboard.press("Control+Alt+z");
    await expect.poll(async () => (await layers(page)).length).toBe(3);
    await click(page, R);
    await page.keyboard.press("Backspace");
    await expect.poll(async () => (await layers(page)).length).toBe(2);
    const z0 = (await state(page)).zoom;
    await page.keyboard.press("Control+=");
    await expect.poll(async () => (await state(page)).zoom).toBeGreaterThan(z0);
    await page.keyboard.press("Control+-");
    await page.keyboard.press("Control+-");
    await expect.poll(async () => (await state(page)).zoom).toBeLessThan(z0);
    const download = page.waitForEvent("download");
    await page.keyboard.press("Control+s");
    expect((await download).suggestedFilename()).toMatch(/\.slc\.json$/);
  });

  test("a Korean input method does not stop the keys: the physical key decides", async ({ page }) => {
    await scene(page);
    const fire = (init: Record<string, unknown>) => page.evaluate((i) => document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...(i as object) })), init);
    await fire({ key: "ㅠ", code: "KeyB" });
    await pressed(page, "브러시");
    await fire({ key: "Process", code: "KeyV" });
    await pressed(page, "선택");
    await fire({ key: "ㅎ", code: "KeyG", ctrlKey: true }); // Ctrl+G with the IME on
    await expect(page.getByText("두 개 이상")).toBeVisible();
    await fire({ key: "}", code: "BracketRight", ctrlKey: true, shiftKey: true });
    await expect(page.getByText("하나만 선택했을 때")).toBeVisible(); // Ctrl+Shift+] with no single layer chosen says so
  });

  test("in a text box the keys leave the box alone (Ctrl+Z is the box's own undo) and Ctrl+G is not taken", async ({ page }) => {
    await scene(page);
    await page.getByTestId("asset-tab-mine").click();
    await page.getByTestId("asset-save-name").focus();
    const result = await page.evaluate(() => {
      const out: Record<string, boolean> = {};
      for (const [name, init] of Object.entries({ undo: { key: "z", code: "KeyZ", ctrlKey: true }, group: { key: "g", code: "KeyG", ctrlKey: true }, brush: { key: "b", code: "KeyB" } })) {
        const ev = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
        document.activeElement!.dispatchEvent(ev);
        out[name] = ev.defaultPrevented;
      }
      return out;
    });
    expect(result).toEqual({ undo: false, group: false, brush: false });
    await pressed(page, "선택");
  });
});

test.describe("preset setting", () => {
  test("the window lists what Photoshop has that the app has not, and the browser-first keys; the preset is chosen there, kept after a reload, and the tooltips follow", async ({ page }) => {
    await scene(page);
    await expect(tool(page, "영역 추출")).toHaveAttribute("title", /\(M\)/);
    await page.getByTestId("open-shortcuts").click();
    await expect(page.getByTestId("preset-photoshop")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("shortcut-not-available")).toContainText("올가미");
    await expect(page.getByTestId("shortcut-not-available")).toContainText("마술봉");
    await expect(page.getByTestId("shortcut-browser-first")).toContainText("Ctrl+T");
    await expect(page.getByTestId("shortcut-browser-first")).toContainText("브라우저가 먼저 처리");
    await expect(page.getByTestId("shortcut-tool-line")).toContainText("없음");
    await page.getByTestId("shortcut-settings").screenshot({ path: "test-results/shortcut-presets.png" });
    await page.getByTestId("preset-legacy").click();
    await expect(page.getByTestId("shortcut-tool-rect")).toContainText("R");
    await expect(page.getByTestId("shortcut-duplicate")).toContainText("Ctrl+D");
    await page.getByTestId("shortcut-close").click();
    await expect(tool(page, "영역 추출")).toHaveAttribute("title", /\(R\)/);
    await page.keyboard.press("r");
    await pressed(page, "영역 추출");
    await page.reload();
    await page.getByTestId("open-shortcuts").click();
    await expect(page.getByTestId("preset-legacy")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("shortcut-tool-brush").click();
    await page.keyboard.press("q");
    await page.getByTestId("preset-photoshop").click(); // a preset change drops the individual change
    await expect(page.getByTestId("shortcut-tool-brush")).toContainText("B");
    await page.getByTestId("shortcut-reset").click();
    expect(await page.evaluate(() => localStorage.getItem("slc-shortcuts"))).toBeNull();
  });
});