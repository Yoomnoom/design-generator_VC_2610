import { Page, expect, test } from "@playwright/test";
import { CARD, CARD2, pngPixelAt, screenPixel, zoomTo as zoomTo2, autosaveReady, clientOf, dragImageRect, drawShape, editor, exportPngBytes, openApp, openProjectFile, pageWithTwoCards, pickTool, saveProjectFile, uploadPng, waitForAutosave, zoomTo } from "./helpers";

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

const L = async (page: Page, id: string) => (await layers(page)).find((l) => l.id === id)!;
/** drag from image point p to q with the mouse; keys held while dragging; `hold` leaves the button down */
async function pull(page: Page, p: { x: number; y: number }, q: { x: number; y: number }, o: { keys?: string[]; hold?: boolean } = {}) {
  const a = await clientOf(page, p.x, p.y);
  const b = await clientOf(page, q.x, q.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (const k of o.keys ?? []) await page.keyboard.down(k);
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  if (o.hold) return;
  await page.mouse.up();
  for (const k of [...(o.keys ?? [])].reverse()) await page.keyboard.up(k);
}
async function selectAB(page: Page, ids: { a: string; b: string }) {
  await click(page, A);
  await click(page, B, ["Shift"]);
  expect((await selected(page)).sort()).toEqual([ids.a, ids.b].sort());
}
// A (300..540 × 200..320) and B (700..900 × 200..300): their box is 300..900 × 200..320; handles: se = (900,320), e = (900,260), rotate = (600, 200 - 28)

test.describe("free transform of a selection", () => {
  test("dragging the corner scales both layers about the opposite corner, keeping their relative positions; one undo step", async ({ page }) => {
    const ids = await scene(page);
    await selectAB(page, ids);
    const a0 = await L(page, ids.a), b0 = await L(page, ids.b);
    const past = (await editor(page)).past;
    await pull(page, { x: 900, y: 320 }, { x: 750, y: 260 }); // x: 600 -> 450 wide (x0.75), y: 120 -> 60 (x0.5)
    await expect.poll(async () => (await L(page, ids.a)).transform.scaleX).toBeCloseTo(0.75, 2);
    const a1 = await L(page, ids.a), b1 = await L(page, ids.b);
    expect(a1.transform.scaleY).toBeCloseTo(0.5, 2);
    expect(a1.transform.x).toBeCloseTo(300, 1); // the pivot corner stays
    expect(b1.transform.x).toBeCloseTo(300 + (b0.transform.x - 300) * 0.75, 1); // B keeps its place relative to A
    expect(b1.transform.y).toBeCloseTo(200 + (b0.transform.y - 200) * 0.5, 1);
    expect(b1.transform.scaleX).toBeCloseTo(0.75, 2);
    expect((await editor(page)).past).toBe(past + 1);
    await page.screenshot({ path: "test-results/free-transform-multi.png" });
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await L(page, ids.b)).transform.x).toBe(b0.transform.x);
    expect((await L(page, ids.a)).transform.scaleX).toBe(a0.transform.scaleX);
  });

  test("Shift keeps the proportion, Alt scales about the centre, Esc while dragging cancels with no history", async ({ page }) => {
    const ids = await scene(page);
    await selectAB(page, ids);
    await pull(page, { x: 900, y: 320 }, { x: 750, y: 300 }, { keys: ["Shift"] });
    await expect.poll(async () => (await L(page, ids.a)).transform.scaleX).toBeGreaterThan(0);
    const a1 = await L(page, ids.a);
    expect(a1.transform.scaleX).toBeCloseTo(a1.transform.scaleY, 2);
    await page.keyboard.press("Control+z");
    await pull(page, { x: 900, y: 320 }, { x: 800, y: 280 }, { keys: ["Alt"] });
    const a2 = await L(page, ids.a), b2 = await L(page, ids.b);
    // about the centre (600, 260): the box shrinks equally on both sides
    expect(a2.transform.x).toBeGreaterThan(300);
    expect(b2.transform.x + 200 * b2.transform.scaleX).toBeLessThan(900);
    await page.keyboard.press("Control+z");
    const past = (await editor(page)).past;
    await pull(page, { x: 900, y: 320 }, { x: 700, y: 280 }, { hold: true });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect((await editor(page)).past).toBe(past);
    expect((await L(page, ids.a)).transform.scaleX).toBe(1);
  });

  test("the rotate handle turns the whole selection about its centre; Shift gives 15 degree steps", async ({ page }) => {
    const ids = await scene(page);
    await selectAB(page, ids);
    await pull(page, { x: 600, y: 172 }, { x: 900, y: 260 }); // from straight above the centre to the right of it: a quarter turn
    await expect.poll(async () => Math.round((await L(page, ids.a)).transform.rotation)).toBe(90);
    expect(Math.round((await L(page, ids.b)).transform.rotation)).toBe(90);
    await page.keyboard.press("Control+z");
    await pull(page, { x: 600, y: 172 }, { x: 720, y: 130 }, { keys: ["Shift"] });
    const r = (await L(page, ids.a)).transform.rotation;
    expect(Math.abs(r % 15)).toBeLessThan(0.01);
    expect(r).not.toBe(0);
  });

  test("the panel shows the selection's X, Y, width, height and a turn, and typing changes all of them together; the ratio can be locked", async ({ page }) => {
    const ids = await scene(page);
    await selectAB(page, ids);
    await expect(page.getByTestId("ft-w")).toHaveValue("600");
    await expect(page.getByTestId("ft-h")).toHaveValue("120");
    const a0 = await L(page, ids.a), b0 = await L(page, ids.b);
    await page.getByTestId("ft-w").fill("300");
    await page.getByTestId("ft-w").press("Enter");
    await expect.poll(async () => (await L(page, ids.b)).transform.scaleX).toBeCloseTo(0.5, 2);
    expect((await L(page, ids.b)).transform.scaleY).toBeCloseTo(0.5, 2); // locked ratio: the height followed
    expect((await L(page, ids.b)).transform.x).toBeCloseTo(a0.transform.x + (b0.transform.x - a0.transform.x) / 2, 1);
    await page.getByTestId("ft-lock").uncheck();
    await page.getByTestId("ft-h").fill("120");
    await page.getByTestId("ft-h").press("Enter");
    await expect.poll(async () => (await L(page, ids.a)).transform.scaleY).toBeGreaterThan(0.9);
    await page.getByTestId("ft-x").fill("50");
    await page.getByTestId("ft-x").press("Enter");
    await expect.poll(async () => (await L(page, ids.a)).transform.x).toBeCloseTo(50, 1);
    await page.getByTestId("ft-rot").fill("90");
    await page.getByTestId("ft-rot").press("Enter");
    await expect.poll(async () => Math.round((await L(page, ids.a)).transform.rotation)).toBe(90);
    await page.getByTestId("multi-panel").screenshot({ path: "test-results/free-transform-panel.png" });
  });

  test("one layer can use the same box with the button or Shift+T; Enter or Esc turns it off; the old handles are back after", async ({ page }) => {
    const ids = await scene(page);
    await click(page, A);
    await expect(page.getByTestId("ft-toggle")).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Shift+t");
    await expect(page.getByTestId("ft-toggle")).toHaveAttribute("aria-pressed", "true");
    await pull(page, { x: 540, y: 320 }, { x: 420, y: 280 }); // the box of card A alone: its south-east corner
    await expect.poll(async () => (await L(page, ids.a)).transform.scaleX).toBeCloseTo(0.5, 2);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("ft-toggle")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("rail-free-transform").click();
    await expect(page.getByTestId("rail-free-transform")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("rail-free-transform")).toHaveAttribute("aria-pressed", "false");
    expect((await selected(page)).length).toBe(1); // Esc ended the mode, it did not clear the selection
  });

  test("locked layers stay put with a notice; comparing shows no box; Shift+T with nothing selected says so", async ({ page }) => {
    const ids = await scene(page);
    await page.getByRole("button", { name: /레이어 1 잠그기/ }).click();
    await selectAB(page, ids);
    await pull(page, { x: 900, y: 320 }, { x: 750, y: 260 });
    await expect(page.getByText(/잠긴 레이어 1개/).first()).toBeVisible();
    expect((await L(page, ids.a)).transform.scaleX).toBe(1);
    await page.keyboard.press("Control+z");
    await page.evaluate(() => (window as any).__slc.getState().setCompareMode("original"));
    const past = (await editor(page)).past;
    await pull(page, { x: 900, y: 320 }, { x: 750, y: 260 });
    expect((await editor(page)).past).toBe(past);
    await page.evaluate(() => (window as any).__slc.getState().setCompareMode("off"));
    await clickEmpty(page);
    await page.keyboard.press("Shift+t");
    await expect(page.getByText("먼저 레이어를 선택하세요")).toBeVisible();
  });

  test("the result is saved and opened again, and the PNG is the same as before saving", async ({ page }) => {
    const ids = await scene(page);
    await selectAB(page, ids);
    await pull(page, { x: 900, y: 320 }, { x: 750, y: 260 });
    await expect.poll(async () => (await L(page, ids.a)).transform.scaleX).toBeCloseTo(0.75, 2);
    const before = await exportPngBytes(page);
    const file = await saveProjectFile(page);
    await openProjectFile(page, file);
    await expect.poll(async () => (await L(page, ids.b)).transform.scaleX).toBeCloseTo(0.75, 2);
    expect((await exportPngBytes(page)).equals(before)).toBe(true);
  });
});

for (const dpr of [1, 2]) {
  test.describe(`free transform: screen and PNG agree, zoom 200%, device pixel ratio ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });
    test("two shapes scaled and turned together look the same on screen and in the PNG", async ({ page }) => {
      await openApp(page);
      await page.getByTestId("start-blank").click();
      await page.getByTestId("canvas-width").fill("600");
      await page.getByTestId("canvas-height").fill("400");
      await page.getByTestId("canvas-create").click();
      await expect.poll(async () => (await editor(page)).screen).not.toBeNull();
      await page.getByTestId("asset-button-fill-rest").click(); // a group of four rounded shapes and a label
      await expect.poll(async () => (await layers(page)).length).toBe(4);
      await page.evaluate(() => { const s = (window as any).__slc.getState(); s.applyFreeTransform({ kind: "scale", sx: 1.5, sy: 1.5, pivot: { x: 0, y: 0 } }); s.applyFreeTransform({ kind: "rotate", degrees: 90, center: { x: 300, y: 200 } }); });
      await page.evaluate(() => (window as any).__slc.getState().selectLayer(null));
      await zoomTo(page, 2, 300, 200);
      const png = await exportPngBytes(page);
      const ls = await layers(page);
      expect(ls.every((l) => Math.round(l.transform.rotation) === 90)).toBe(true);
      // sample a grid of image pixels: each must agree to within a little anti-aliasing
      let worst = 0;
      for (let x = 250; x <= 350; x += 12) for (let y = 120; y <= 280; y += 16) {
        const p = await pngPixelAt(page, png, x, y);
        const s = await screenPixel(page, x, y);
        worst = Math.max(worst, ...p.map((v, i) => Math.abs(v - s[i])));
      }
      expect(worst).toBeLessThanOrEqual(40);
    });
  });
}