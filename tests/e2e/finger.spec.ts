import { Page, expect, test } from "@playwright/test";
import { CARD, PAGE, clientOf, dragImageRect, editor, exportPngBytes, idbRecord, openApp, openProjectFile, pageWithCard, pickTool, pngPixelAt, saveProjectFile, sourceHash, uploadPng, zoomTo } from "./helpers";

type Pt = { x: number; y: number };

const layerRaw = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => {
    const s = (window as any).__slc.getState();
    const l = s.history.present.screens[0].layers[0];
    const raw = s.images.get(l.imageId).raw;
    const i = ((py as number) * raw.width + (px as number)) * 4;
    return Array.from(raw.data.slice(i, i + 4)) as number[];
  }, [x, y] as const);
const layerImageId = (page: Page) => page.evaluate(() => (window as any).__slc.getState().history.present.screens[0].layers[0].imageId as string);
const layerHash = (page: Page) =>
  page.evaluate(async () => {
    const s = (window as any).__slc.getState();
    if (!s.history) return ""; // nothing loaded yet (waiting for a restore)
    const raw = s.images.get(s.history.present.screens[0].layers[0].imageId).raw;
    const digest = await crypto.subtle.digest("SHA-256", raw.data);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  });
const notice = (page: Page) => page.evaluate(() => (window as any).__slc.getState().notice as string | null);
const setStyle = (page: Page, style: { size?: number; strength?: number; softness?: number }) => page.evaluate((st) => (window as any).__slc.getState().setFingerStyle(st), style);

async function withLayer(page: Page, zoom = 1) {
  await openApp(page);
  await uploadPng(page, pageWithCard());
  await zoomTo(page, 1, 600, 300);
  await pickTool(page, "영역 추출");
  await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
  await expect.poll(async () => (await editor(page)).layers.length).toBe(1);
  await zoomTo(page, zoom, CARD.x + CARD.width / 2, CARD.y + CARD.height / 2);
}
const toFrame = (t: { x: number; y: number; scaleX: number; scaleY: number; rotation: number }, p: Pt): Pt => {
  const r = (t.rotation * Math.PI) / 180;
  const sx = p.x * t.scaleX, sy = p.y * t.scaleY;
  return { x: t.x + Math.cos(r) * sx - Math.sin(r) * sy, y: t.y + Math.sin(r) * sx + Math.cos(r) * sy };
};
const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];

test.describe("finger tool", () => {
  test("F opens the tool; dragging from the red marker smears red along the stroke, as one undo step with a new picture; the screenshot is untouched", async ({ page }) => {
    await withLayer(page);
    const sourceBefore = await sourceHash(page);
    const idBefore = await layerImageId(page);
    const hashBefore = await layerHash(page);
    const past = (await editor(page)).past;
    await page.keyboard.press("r");
    await expect(page.getByTestId("finger-panel")).toBeVisible();
    await setStyle(page, { size: 20, strength: 100, softness: 0 });

    // (10, 10) of the card is inside the red marker; drag right along y = 10
    await dragImageRect(page, { x: CARD.x + 10, y: CARD.y + 10 }, { x: CARD.x + 200, y: CARD.y + 10 });
    expect((await editor(page)).past).toBe(past + 1);
    const idAfter = await layerImageId(page);
    expect(idAfter).not.toBe(idBefore);
    expect(await layerRaw(page, 150, 10)).toEqual(RED); // smeared well past the marker (which ends at x = 20)
    expect(await layerRaw(page, 150, 60)).toEqual(BLUE); // out of the brush's reach
    expect(await layerRaw(page, 230, 10)).toEqual(BLUE); // beyond the end of the stroke
    expect(await sourceHash(page)).toBe(sourceBefore); // the screenshot is never changed

    await page.keyboard.press("Control+z");
    expect(await layerImageId(page)).toBe(idBefore);
    expect(await layerHash(page)).toBe(hashBefore);
    await page.keyboard.press("Control+Shift+z");
    expect(await layerImageId(page)).toBe(idAfter);
    expect(await layerRaw(page, 150, 10)).toEqual(RED);
  });

  test("a click or a stroke that does not move changes nothing and records nothing", async ({ page }) => {
    await withLayer(page);
    await pickTool(page, "손가락");
    const idBefore = await layerImageId(page), past = (await editor(page)).past;
    const a = await clientOf(page, CARD.x + 10, CARD.y + 10);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 0.4, a.y);
    await page.mouse.up();
    expect(await layerImageId(page)).toBe(idBefore);
    expect((await editor(page)).past).toBe(past);
  });

  test("while the pointer is down the live picture is drawn from a working copy, not stored; the layer's own bitmap is replaced only on release", async ({ page }) => {
    await withLayer(page);
    await pickTool(page, "손가락");
    await setStyle(page, { size: 20, strength: 100, softness: 0 });
    const idBefore = await layerImageId(page), past = (await editor(page)).past;
    const a = await clientOf(page, CARD.x + 10, CARD.y + 10), b = await clientOf(page, CARD.x + 160, CARD.y + 10);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, a.y, { steps: 6 });
    await page.mouse.move(b.x, b.y, { steps: 6 });
    // not recorded yet, the stored picture is as it was, but the canvas already shows the smear
    expect(await layerImageId(page)).toBe(idBefore);
    expect((await editor(page)).past).toBe(past);
    expect(await layerRaw(page, 100, 10)).toEqual(BLUE);
    const shown = await page.evaluate(([cx, cy]) => {
      const canvas = document.querySelector(".konvajs-content canvas") as HTMLCanvasElement;
      const box = canvas.getBoundingClientRect();
      const d = canvas.getContext("2d")!.getImageData(Math.round((cx - box.left) * (canvas.width / box.width)), Math.round((cy - box.top) * (canvas.width / box.width)), 1, 1).data;
      return Array.from(d);
    }, [(await clientOf(page, CARD.x + 100, CARD.y + 10)).x, (await clientOf(page, CARD.x + 100, CARD.y + 10)).y]);
    expect(shown.slice(0, 3)).toEqual([255, 0, 0]);
    await page.mouse.up();
    expect(await layerImageId(page)).not.toBe(idBefore);
    expect((await editor(page)).past).toBe(past + 1);
  });

  test("refused, with the reason shown: no selection, a locked layer, a vector layer; and nothing happens while comparing", async ({ page }) => {
    await withLayer(page);
    await pickTool(page, "손가락");
    const drag = () => dragImageRect(page, { x: CARD.x + 10, y: CARD.y + 10 }, { x: CARD.x + 150, y: CARD.y + 10 });
    const past = (await editor(page)).past;
    await page.evaluate(() => { const s = (window as any).__slc.getState(); s.selectLayer(null); });
    // with nothing chosen a drag that starts on a picture takes that layer (so it works at once); one over the bare capture says why not
    await dragImageRect(page, { x: CARD.x + 10, y: CARD.y + 220 }, { x: CARD.x + 150, y: CARD.y + 220 });
    expect(await notice(page)).toContain("원본 스크린샷");
    await page.evaluate(() => { const s = (window as any).__slc.getState(); s.setNotice(null); const id = s.history.present.screens[0].layers[0].id; s.selectLayer(id); s.setLayerLocked(id, true); });
    const pastLocked = (await editor(page)).past;
    await drag();
    expect(await notice(page)).toContain("잠긴");
    expect((await editor(page)).past).toBe(pastLocked);
    await page.evaluate(() => { const s = (window as any).__slc.getState(); s.setNotice(null); s.setLayerLocked(s.history.present.screens[0].layers[0].id, false); });
    await page.evaluate(() => (window as any).__slc.getState().setCompareMode("original"));
    await drag();
    expect(await notice(page)).toBeNull();
    await page.evaluate(() => (window as any).__slc.getState().setCompareMode("off"));
    expect(past).toBeLessThan((await editor(page)).past + 1);
    const idStill = await layerRaw(page, 100, 10);
    expect(idStill).toEqual(BLUE);
    await page.evaluate(() => { const s = (window as any).__slc.getState(); s.addVectorLayer({ kind: "rect", width: 60, height: 40, stroke: "#e5322d", strokeWidth: 3, fill: null }, 100, 500); });
    await pickTool(page, "손가락");
    await dragImageRect(page, { x: 110, y: 510 }, { x: 150, y: 520 });
    expect(await notice(page)).toContain("이미지(비트맵)");
  });

  test("after the stroke the canvas and the exported PNG show the same smeared picture", async ({ page }) => {
    await withLayer(page);
    await pickTool(page, "손가락");
    await setStyle(page, { size: 24, strength: 80, softness: 40 });
    await dragImageRect(page, { x: CARD.x + 10, y: CARD.y + 10 }, { x: CARD.x + 190, y: CARD.y + 40 });
    const png = await exportPngBytes(page);
    for (const [x, y] of [[60, 14], [120, 26], [180, 38], [100, 70], [230, 100]] as const) {
      const c = await clientOf(page, CARD.x + x + 0.5, CARD.y + y + 0.5);
      const canvasPixel = await page.evaluate(([cx, cy]) => {
        const canvas = document.querySelector(".konvajs-content canvas") as HTMLCanvasElement;
        const box = canvas.getBoundingClientRect();
        const scale = canvas.width / box.width;
        return Array.from(canvas.getContext("2d")!.getImageData(Math.floor((cx - box.left) * scale), Math.floor((cy - box.top) * scale), 1, 1).data);
      }, [c.x, c.y]);
      const exported = await pngPixelAt(page, png, CARD.x + x, CARD.y + y);
      for (let k = 0; k < 3; k++) expect(Math.abs(canvasPixel[k] - exported[k])).toBeLessThanOrEqual(1);
    }
  });

  test("saving and opening the project keeps the result; so does the temporary save", async ({ page }) => {
    await withLayer(page);
    await pickTool(page, "손가락");
    await setStyle(page, { size: 20, strength: 100, softness: 0 });
    await dragImageRect(page, { x: CARD.x + 10, y: CARD.y + 10 }, { x: CARD.x + 200, y: CARD.y + 10 });
    const smeared = await layerHash(page);
    const text = await saveProjectFile(page);
    await openProjectFile(page, text);
    await expect.poll(() => layerHash(page)).toBe(smeared);
    expect(await layerRaw(page, 150, 10)).toEqual(RED);
    // temporary save: wait until the stored copy names the picture on screen, then reload and restore
    const id = await layerImageId(page);
    await expect
      .poll(async () => ((await idbRecord(page)) as any)?.project?.screens?.[0]?.layers?.[0]?.imageId, { timeout: 20000 })
      .toBe(id);
    await expect(page.getByTestId("autosave-status")).toHaveAttribute("data-saving", "no");
    await page.reload();
    await page.getByRole("button", { name: "복원" }).click();
    await expect.poll(() => layerHash(page)).toBe(smeared);
    expect(PAGE.width).toBe(1200);
  });
});

test.describe("finger tool: rotated, zoomed 200%, at devicePixelRatio 2", () => {
  test.use({ deviceScaleFactor: 2 });
  test("the pointer lands on the right bitmap pixels through a 30° turn", async ({ page }) => {
    await withLayer(page);
    await page.evaluate(([x, y]) => { const s = (window as any).__slc.getState(); s.transformLayer(s.selectedLayerIds[0], { x, y, scaleX: 1, scaleY: 1, rotation: 30 }); }, [CARD.x, CARD.y]);
    await zoomTo(page, 2, CARD.x + 100, CARD.y + 100);
    await pickTool(page, "손가락");
    await setStyle(page, { size: 16, strength: 100, softness: 0 });
    const t = { x: CARD.x, y: CARD.y, scaleX: 1, scaleY: 1, rotation: 30 };
    // along the bitmap's own x axis, from inside the red marker (10, 10) to (200, 10)
    const a = toFrame(t, { x: 10, y: 10 }), b = toFrame(t, { x: 200, y: 10 });
    await dragImageRect(page, a, b);
    expect(await layerRaw(page, 150, 10)).toEqual(RED);
    expect(await layerRaw(page, 100, 10)).toEqual(RED);
    expect(await layerRaw(page, 150, 50)).toEqual(BLUE); // the stroke ran along the bitmap's axis: 40 px away is untouched
    expect(await layerRaw(page, 100, 40)).toEqual(BLUE);
  });

  test("through a warp (here a plain shift) and a 2× scale", async ({ page }) => {
    await withLayer(page);
    await page.evaluate(([x, y]) => {
      const s = (window as any).__slc.getState();
      const id = s.selectedLayerIds[0];
      s.setLayerWarp(id, { kind: "quad", points: [{ x: 20, y: 0 }, { x: 260, y: 0 }, { x: 260, y: 120 }, { x: 20, y: 120 }] });
      s.transformLayer(id, { x, y, scaleX: 1, scaleY: 1, rotation: 0 });
    }, [CARD.x, CARD.y]);
    await zoomTo(page, 2, CARD.x + 120, CARD.y + 60);
    await pickTool(page, "손가락");
    await setStyle(page, { size: 16, strength: 100, softness: 0 });
    await dragImageRect(page, { x: CARD.x + 20 + 10, y: CARD.y + 10 }, { x: CARD.x + 20 + 200, y: CARD.y + 10 });
    expect(await layerRaw(page, 150, 10)).toEqual(RED);
    expect(await layerRaw(page, 150, 60)).toEqual(BLUE);
  });
});