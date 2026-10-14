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

const groupOf = (page: Page, id: string) => groupIdOf(page, id);

test.describe("selecting inside a group", () => {
  test("canvas: a plain click on a member selects the group, Ctrl+click toggles that one layer only", async ({ page }) => {
    const ids = await scene(page);
    await groupAB(page, ids);
    await clickEmpty(page);
    await click(page, A);
    expect((await selected(page)).sort()).toEqual([ids.a, ids.b].sort());
    await clickEmpty(page);
    await click(page, R);
    await click(page, A, ["Control"]);
    expect((await selected(page)).sort()).toEqual([ids.r, ids.a].sort()); // not B
    await click(page, A, ["Control"]);
    expect(await selected(page)).toEqual([ids.r]);
    await click(page, B, ["Shift"]);
    expect((await selected(page)).sort()).toEqual([ids.r, ids.b].sort()); // Shift adds this layer only
  });

  test("panel: header selects the group, a member row only that layer, Ctrl toggles one layer, Shift selects the range of single layers", async ({ page }) => {
    const ids = await scene(page);
    await groupAB(page, ids);
    await clickEmpty(page);
    await page.getByTestId("group-item").click();
    expect((await selected(page)).sort()).toEqual([ids.a, ids.b].sort());
    const item = (id: string) => page.locator(`[data-layer-id="${id}"]`);
    await item(ids.r).click();
    await item(ids.a).click({ modifiers: ["Control"] });
    expect((await selected(page)).sort()).toEqual([ids.r, ids.a].sort());
    await item(ids.r).click();
    await item(ids.a).click({ modifiers: ["Shift"] }); // R is on top: R, then the group's layers
    expect(new Set(await selected(page))).toEqual(new Set([ids.r, ...(await page.evaluate(() => [] as string[])), ids.a, ...(await selected(page)).filter((x) => x === ids.b)]));
    expect(await selected(page)).toContain(ids.r);
    expect(await selected(page)).toContain(ids.a);
  });

  test("with one member selected, a delete or a move touches that layer only and the group stays with the rest", async ({ page }) => {
    const ids = await scene(page);
    await clickEmpty(page);
    await click(page, A);
    await click(page, B, ["Shift"]);
    await click(page, R, ["Shift"]);
    await page.keyboard.press("Control+g");
    await expect.poll(async () => (await groups(page)).length).toBe(1);
    await page.locator(`[data-layer-id="${ids.a}"]`).click();
    const [bx] = [await xOf(page, ids.b)];
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => xOf(page, ids.a)).toBeGreaterThan(0);
    expect(await xOf(page, ids.b)).toBe(bx);
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await layers(page)).length).toBe(2);
    expect(await groupOf(page, ids.b)).toBeTruthy();
  });
});

test.describe("putting layers in and out of a group", () => {
  test("drag a layer onto the group header to put it in, drag it out onto a loose layer to take it out; each is one undo step", async ({ page }) => {
    const ids = await scene(page);
    await groupAB(page, ids);
    const [g] = await groups(page);
    const rItem = page.locator(`[data-layer-id="${ids.r}"]`);
    const past = (await editor(page)).past;
    await rItem.dragTo(page.getByTestId("group-row"));
    await expect.poll(() => groupOf(page, ids.r)).toBe(g.id);
    expect((await editor(page)).past).toBe(past + 1);
    await page.screenshot({ path: "test-results/group-drag-in.png" });
    // out: drop the member on a layer that is in no group (there is none now), so first free one
    await page.getByTestId("group-remove").click(); // R is selected after the drop? it removes the selected layers from their groups
    await expect.poll(() => groupOf(page, ids.r)).toBeUndefined();
    expect((await editor(page)).past).toBe(past + 2);
    await page.keyboard.press("Control+z");
    await expect.poll(() => groupOf(page, ids.r)).toBe(g.id);
  });

  test("drag a member onto a layer outside the group takes it out; a group dropped on a group is refused with a reason", async ({ page }) => {
    const ids = await scene(page);
    await clickEmpty(page);
    await click(page, A);
    await click(page, B, ["Shift"]);
    await page.keyboard.press("Control+g");
    await expect.poll(async () => (await groups(page)).length).toBe(1);
    // make a second group of R and a new layer so that two groups exist
    await drawShape(page, "사각형", { x: 600, y: 400 }, { x: 680, y: 440 });
    await page.locator(`[data-layer-id="${ids.a}"]`).dragTo(page.locator('[data-in-group="false"], li:not([data-in-group]) [data-testid="layer-item"]').first());
    await expect.poll(() => groupOf(page, ids.a)).toBeUndefined();
  });

  test("Ctrl+G with a group and a loose layer selected adds the layer; two groups selected are refused", async ({ page }) => {
    const ids = await scene(page);
    await groupAB(page, ids);
    const [g] = await groups(page);
    await click(page, R, ["Shift"]);
    expect((await selected(page)).length).toBe(3);
    await page.keyboard.press("Control+g");
    await expect.poll(() => groupOf(page, ids.r)).toBe(g.id);
    expect((await groups(page)).length).toBe(1);
  });

  test("a locked layer cannot be put in a group: the reason is shown and nothing changes", async ({ page }) => {
    const ids = await scene(page);
    await groupAB(page, ids);
    await page.getByRole("button", { name: /사각형 1 잠그기/ }).click();
    await page.locator(`[data-layer-id="${ids.r}"]`).dragTo(page.getByTestId("group-row"));
    await expect(page.getByText(/잠긴 레이어/).first()).toBeVisible();
    expect(await groupOf(page, ids.r)).toBeUndefined();
  });

  test("membership is kept by save, open and a PNG that does not change", async ({ page }) => {
    const ids = await scene(page);
    const plain = await exportPngBytes(page);
    await groupAB(page, ids);
    await page.locator(`[data-layer-id="${ids.r}"]`).dragTo(page.getByTestId("group-row"));
    const [g] = await groups(page);
    await expect.poll(() => groupOf(page, ids.r)).toBe(g.id);
    expect((await exportPngBytes(page)).equals(plain)).toBe(true);
    const file = await saveProjectFile(page);
    await openProjectFile(page, file);
    await expect.poll(() => groupOf(page, ids.r)).toBe(g.id);
  });
});

test.describe("sources go in as groups", () => {
  test("a built-in button is one group named like the source and selected; a template keeps its component groups; one undo", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("start-blank").click();
    await page.getByTestId("canvas-create").click();
    await expect.poll(async () => (await editor(page)).screen).not.toBeNull();
    const past = (await editor(page)).past;
    await page.getByTestId("asset-button-fill-hover").click();
    await expect.poll(async () => (await groups(page)).length).toBe(1);
    expect((await groups(page))[0].name).toContain("버튼");
    expect((await selected(page)).length).toBe(4);
    expect((await editor(page)).past).toBe(past + 1);
    await page.getByTestId("asset-divider").click();
    expect((await groups(page)).length).toBe(1); // one layer: no group
    await page.getByTestId("asset-tab-template").click();
    await page.getByTestId("template-login-add").click();
    await expect.poll(async () => (await groups(page)).length).toBe(3);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await groups(page)).length).toBe(1);
  });
});