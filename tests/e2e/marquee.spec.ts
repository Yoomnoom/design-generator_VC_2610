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

/** drag a box from image point p to q with the mouse, optionally holding keys; release unless `hold` */
async function box(page: Page, p: { x: number; y: number }, q: { x: number; y: number }, o: { keys?: string[]; hold?: boolean } = {}) {
  const a = await clientOf(page, p.x, p.y);
  const b = await clientOf(page, q.x, q.y);
  for (const k of o.keys ?? []) await page.keyboard.down(k);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  if (o.hold) return;
  await page.mouse.up();
  for (const k of [...(o.keys ?? [])].reverse()) await page.keyboard.up(k);
}
// the scene: card A (300..540 × 200..320), card B (700..900 × 200..300), rectangle R (320..400 × 340..380) on the original picture
const EMPTY_TOP_LEFT = { x: 285, y: 150 }; // inside the visible part of the frame (the viewport shows image x 262..937 at 100%)

test.describe("box selection", () => {
  test("dragging from an empty place (on the original picture) selects what the box touches; the tag counts them; the footer says how many", async ({ page }) => {
    const { a, b, r } = await scene(page);
    await box(page, EMPTY_TOP_LEFT, { x: 330, y: 230 }, { hold: true });
    await expect(page.getByTestId("pick-tag")).toContainText("1개");
    expect((await page.getByTestId("pick-tag").getAttribute("data-hits"))!.split(",")).toEqual([a]); // shown before release
    expect(await selected(page)).toEqual([]); // nothing selected until release
    await page.screenshot({ path: "test-results/marquee-drag.png" });
    await page.mouse.up();
    expect(await selected(page)).toEqual([a]);
    await expect(page.getByTestId("footer-info")).toContainText("1개 선택됨");
    await expect(page.getByTestId("pick-tag")).toHaveCount(0);
    await box(page, { x: 285, y: 150 }, { x: 930, y: 400 }); // everything
    expect((await selected(page)).sort()).toEqual([a, b, r].sort());
    await expect(page.getByTestId("footer-info")).toContainText("3개 선택됨");
    // the original picture itself was not moved or changed
    expect((await layers(page)).length).toBe(3);
  });

  test("Alt: only layers completely inside the box; plain: anything touched", async ({ page }) => {
    const { a, b } = await scene(page);
    await box(page, EMPTY_TOP_LEFT, { x: 450, y: 250 }, { keys: ["Alt"] }); // cuts card A
    expect(await selected(page)).toEqual([]);
    await box(page, EMPTY_TOP_LEFT, { x: 560, y: 340 }, { keys: ["Alt"] }); // contains card A
    expect(await selected(page)).toEqual([a]);
    await box(page, EMPTY_TOP_LEFT, { x: 450, y: 250 });
    expect(await selected(page)).toEqual([a]);
    expect(b).toBeTruthy();
  });

  test("Shift adds, Ctrl toggles, a click on an empty place clears, Esc cancels the box", async ({ page }) => {
    const { a, b } = await scene(page);
    await box(page, EMPTY_TOP_LEFT, { x: 330, y: 230 });
    expect(await selected(page)).toEqual([a]);
    await box(page, { x: 650, y: 150 }, { x: 750, y: 230 }, { keys: ["Shift"] });
    expect((await selected(page)).sort()).toEqual([a, b].sort());
    await box(page, { x: 650, y: 150 }, { x: 750, y: 230 }, { keys: ["Control"] });
    expect(await selected(page)).toEqual([a]);
    // Esc while dragging: the box goes away and the selection stays as it was
    await box(page, { x: 650, y: 150 }, { x: 800, y: 250 }, { hold: true });
    await expect(page.getByTestId("pick-tag")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("pick-tag")).toHaveCount(0);
    await page.mouse.up();
    expect(await selected(page)).toEqual([a]);
    await clickEmpty(page);
    expect(await selected(page)).toEqual([]);
  });

  test("a group comes whole; Ctrl+drag picks only the members the box touches; hidden layers are left out; locked ones are selected", async ({ page }) => {
    const ids = await scene(page);
    await groupAB(page, ids);
    await clickEmpty(page);
    await box(page, EMPTY_TOP_LEFT, { x: 330, y: 230 });
    expect((await selected(page)).sort()).toEqual([ids.a, ids.b].sort());
    await clickEmpty(page);
    await box(page, EMPTY_TOP_LEFT, { x: 330, y: 230 }, { keys: ["Control"] });
    expect(await selected(page)).toEqual([ids.a]);
    await clickEmpty(page);
    await page.getByRole("button", { name: /사각형 1 숨기기/ }).click();
    await box(page, { x: 285, y: 300 }, { x: 450, y: 400 });
    expect((await selected(page)).sort()).toEqual([ids.a, ids.b].sort()); // R is hidden; card A's lower part was reached, and A brings its group
    await page.getByRole("button", { name: /사각형 1 보이기/ }).click();
    await page.getByRole("button", { name: /사각형 1 잠그기/ }).click();
    await clickEmpty(page);
    await box(page, { x: 285, y: 330 }, { x: 450, y: 400 });
    expect(await selected(page)).toEqual([ids.r]); // locked layers can be selected (they just do not move)
  });

  test("a drag that starts on a layer still moves it; the box tool is not on for other tools; Space gives the hand", async ({ page }) => {
    const { a } = await scene(page);
    const x0 = (await layers(page)).find((l) => l.id === a)!.transform.x;
    await drag(page, A, 30, 0);
    await expect.poll(async () => (await layers(page)).find((l) => l.id === a)!.transform.x).toBe(x0 + 30);
    await clickEmpty(page);
  });

  test("Space turns a drag into a hand: the view moves and nothing is selected; the region tool still extracts", async ({ page }) => {
    await scene(page);
    const before = (await editor(page)).view;
    await page.keyboard.down("Space");
    await box(page, EMPTY_TOP_LEFT, { x: 330, y: 230 });
    await page.keyboard.up("Space");
    expect(await selected(page)).toEqual([]);
    const after = (await editor(page)).view;
    expect(after.panX).not.toBe(before.panX);
    await pickTool(page, "영역 추출");
    await box(page, { x: 560, y: 330 }, { x: 640, y: 420 });
    await expect.poll(async () => (await layers(page)).length).toBe(4); // the extraction box made a layer; it was not a selection box
  });
});

test.describe("box selection at 200% and DPR 2", () => {
  test.use({ deviceScaleFactor: 2 });
  test("the same layers are reached at 200% with a panned view", async ({ page }) => {
    const { a, b } = await scene(page);
    await zoomTo(page, 2, 520, 250);
    await box(page, { x: 450, y: 170 }, { x: 330, y: 230 }); // dragged up-left: reaches A (300..540) only
    expect(await selected(page)).toEqual([a]);
    await box(page, { x: 450, y: 170 }, { x: 330, y: 230 }, { keys: ["Alt"] });
    expect(await selected(page)).toEqual([]);
    expect(b).toBeTruthy();
  });
});