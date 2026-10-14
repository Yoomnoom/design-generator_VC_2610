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

test.describe("selecting", () => {
  test("Ctrl+click toggles, Shift+click adds on the canvas, Ctrl+A selects all, Esc and a click on empty canvas clear", async ({ page }) => {
    const { a, b, r } = await scene(page);
    await click(page, A);
    await click(page, B, ["Control"]);
    expect(await selected(page)).toEqual([a, b]);
    await click(page, B, ["Control"]);
    expect(await selected(page)).toEqual([a]);
    await click(page, R, ["Shift"]);
    expect(await selected(page)).toEqual([a, r]);
    await page.keyboard.press("Control+a");
    expect((await selected(page)).sort()).toEqual([a, b, r].sort());
    await page.keyboard.press("Escape");
    expect(await selected(page)).toEqual([]);
    await click(page, A);
    await clickEmpty(page);
    expect(await selected(page)).toEqual([]);
  });

  test("Shift+click in the layer list selects the range from the last clicked layer, hidden and locked ones included; a locked one does not move", async ({ page }) => {
    const { a, b, r } = await scene(page);
    await page.getByRole("button", { name: /레이어 1 잠그기|잠그기/ }).last().click(); // lock the back layer (A)
    await page.getByRole("button", { name: /숨기기/ }).nth(1).click(); // hide the middle layer (B)
    const items = page.getByTestId("layer-item"); // front first: R, B, A
    await items.nth(0).click();
    await items.nth(2).click({ modifiers: ["Shift"] });
    expect((await selected(page)).sort()).toEqual([a, b, r].sort());
    const ax = await xOf(page, a);
    const rx = await xOf(page, r);
    await page.keyboard.press("ArrowRight"); // the arrow keys move the unlocked ones only
    await expect.poll(() => xOf(page, r)).toBe(rx + 1);
    expect(await xOf(page, a)).toBe(ax);
  });
});

test.describe("groups", () => {
  test("Ctrl+G groups the selection (one undo step); the panel shows a header with the layers under it; Ctrl+Shift+G releases", async ({ page }) => {
    const ids = await scene(page);
    const before = await editor(page);
    await groupAB(page, ids);
    expect((await editor(page)).past).toBe(before.past + 1);
    const [g] = await groups(page);
    expect(g.name).toBe("그룹 1");
    expect(await groupIdOf(page, ids.a)).toBe(g.id);
    expect(await groupIdOf(page, ids.b)).toBe(g.id);
    expect(await groupIdOf(page, ids.r)).toBeUndefined();
    await expect(page.getByTestId("group-row")).toHaveCount(1);
    await expect(page.locator('[data-in-group="true"]')).toHaveCount(2);
    await page.screenshot({ path: "test-results/groups-panel.png" });

    await page.keyboard.press("Control+Shift+g");
    await expect.poll(async () => (await groups(page)).length).toBe(0);
    await expect(page.getByTestId("group-row")).toHaveCount(0);
    expect((await layers(page)).length).toBe(3);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await groups(page)).length).toBe(1);
  });

  test("Ctrl+G is always taken by the editor, not the browser's find; with fewer than two layers it says so", async ({ page }) => {
    const { a } = await scene(page);
    await click(page, A);
    await page.keyboard.press("Control+g");
    await expect(page.getByText("두 개 이상")).toBeVisible();
    expect(await groups(page)).toEqual([]);
    expect(a).toBeTruthy();
    // with a text box focused the key is left alone
    await page.getByTestId("asset-tab-mine").click();
    await page.getByTestId("asset-save-name").focus();
    const prevented = await page.evaluate(() => {
      const ev = new KeyboardEvent("keydown", { key: "g", ctrlKey: true, bubbles: true, cancelable: true });
      document.activeElement!.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(prevented).toBe(false);
  });

  test("a click on a layer of a group selects the whole group and a drag moves it as one, one undo step", async ({ page }) => {
    const ids = await scene(page);
    await groupAB(page, ids);
    await clickEmpty(page);
    await click(page, A);
    expect((await selected(page)).sort()).toEqual([ids.a, ids.b].sort());
    const [ax, bx, rx] = [await xOf(page, ids.a), await xOf(page, ids.b), await xOf(page, ids.r)];
    const past = (await editor(page)).past;
    await drag(page, A, 40, 0);
    await expect.poll(() => xOf(page, ids.a)).toBe(ax + 40);
    expect(await xOf(page, ids.b)).toBe(bx + 40);
    expect(await xOf(page, ids.r)).toBe(rx); // not in the group
    expect((await editor(page)).past).toBe(past + 1);
    await page.keyboard.press("Control+z");
    expect(await xOf(page, ids.b)).toBe(bx);
  });

  test("in the panel: the header selects the group, a member row selects only that layer, folding hides the members, renaming works", async ({ page }) => {
    const ids = await scene(page);
    await groupAB(page, ids);
    await clickEmpty(page);
    await page.getByTestId("group-item").click();
    expect((await selected(page)).sort()).toEqual([ids.a, ids.b].sort());
    await page.locator(`[data-layer-id="${ids.a}"]`).click();
    expect(await selected(page)).toEqual([ids.a]);

    await page.getByTestId("group-toggle").click();
    await expect(page.locator('[data-in-group="true"]')).toHaveCount(0);
    await expect(page.getByTestId("group-row")).toHaveAttribute("data-folded", "true");
    await page.getByTestId("group-toggle").click();
    await expect(page.locator('[data-in-group="true"]')).toHaveCount(2);

    await page.getByTestId("group-rename").click();
    await page.getByTestId("group-rename-input").fill("Cards");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("group-item")).toContainText("Cards");
    expect((await groups(page))[0].name).toBe("Cards");
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await groups(page))[0].name).toBe("그룹 1");
  });

  test("duplicating a whole group makes a new group; deleting the layers dissolves a group with fewer than two", async ({ page }) => {
    const ids = await scene(page);
    await groupAB(page, ids);
    await page.getByTestId("group-item").click();
    await page.keyboard.press("Control+j");
    await expect.poll(async () => (await groups(page)).length).toBe(2);
    expect((await layers(page)).length).toBe(5);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await groups(page)).length).toBe(1);
    await page.locator(`[data-layer-id="${ids.a}"]`).click();
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await groups(page)).length).toBe(0);
    expect(await groupIdOf(page, ids.b)).toBeUndefined();
  });

  test("groups are saved and opened again, restored after a reload, and the PNG is the same as without groups", async ({ page }) => {
    const ids = await scene(page);
    const plain = await exportPngBytes(page);
    await groupAB(page, ids);
    expect((await exportPngBytes(page)).equals(plain)).toBe(true);
    const file = await saveProjectFile(page);
    expect(JSON.parse(file).project.version).toBe(12);
    expect(JSON.parse(file).project.screens[0].groups).toHaveLength(1);
    const before = await page.getByTestId("autosave-status").getAttribute("data-saved-at").then(Number);
    await openProjectFile(page, file);
    await expect.poll(async () => (await groups(page)).length).toBe(1);
    expect(await groupIdOf(page, ids.a)).toBeTruthy();
    expect((await exportPngBytes(page)).equals(plain)).toBe(true);

    await waitForAutosave(page, before); // a save made after the project was opened (it has the groups)
    await page.reload();
    await autosaveReady(page);
    await page.getByRole("button", { name: "복원" }).click();
    await expect.poll(async () => (await groups(page)).length).toBe(1);
    await expect(page.getByTestId("group-row")).toHaveCount(1);
  });

  test("while comparing, grouping does nothing", async ({ page }) => {
    const ids = await scene(page);
    await click(page, A);
    await click(page, B, ["Shift"]);
    await page.evaluate(() => (window as any).__slc.getState().setCompareMode("original"));
    await page.keyboard.press("Control+g");
    expect(await groups(page)).toEqual([]);
    await expect(page.getByTestId("group-make")).toBeDisabled();
    expect(ids.a).toBeTruthy();
  });

  test("a template's parts come in grouped, and a source saved from a group brings its group back", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("start-template-login").click();
    await expect.poll(async () => (await groups(page)).length).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId("group-row").first()).toBeVisible();
    await page.screenshot({ path: "test-results/groups-template.png" });
    await page.getByTestId("group-item").first().click();
    expect((await selected(page)).length).toBeGreaterThanOrEqual(2);
    await page.getByTestId("asset-tab-mine").click();
    await page.getByTestId("asset-save-name").fill("Field");
    await page.getByTestId("asset-save").click();
    await expect(page.getByTestId("my-asset")).toHaveCount(1);
    const before = (await groups(page)).length;
    await page.getByTestId("asset-insert").click();
    await expect.poll(async () => (await groups(page)).length).toBe(before + 1);
  });
});
