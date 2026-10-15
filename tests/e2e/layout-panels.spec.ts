import { Page, expect, test } from "@playwright/test";
import { CARD, clientOf, dragImageRect, editor, openApp, pageWithCard, pickTool, reloadAndDiscard, uploadPng, zoomTo } from "./helpers";

const SIZES = [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }];
const open = (page: Page, side: "left" | "right") => page.getByTestId(`panel-${side}`).getAttribute("data-open").then((v) => v === "true");
const colWidths = (page: Page) => page.getByTestId("main-grid").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").map((v) => Math.round(parseFloat(v))));
const stored = (page: Page) => page.evaluate(() => localStorage.getItem("slc-panels"));

test.describe("tool bar", () => {
  for (const size of SIZES) {
    test(`${size.width}×${size.height}: every tool is visible without scrolling, in groups, icons only`, async ({ page }) => {
      await page.setViewportSize(size);
      await openApp(page);
      const nav = page.getByTestId("tool-rail");
      const facts = await nav.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const buttons = [...el.querySelectorAll("button")].map((b) => {
          const q = b.getBoundingClientRect();
          return { name: b.textContent?.trim() ?? "", x: q.x, y: q.y, w: q.width, h: q.height, title: b.getAttribute("title") ?? "", textVisible: (b.querySelector("span") as HTMLElement).getBoundingClientRect().width > 2 };
        });
        return { box: r.toJSON(), scroll: el.scrollHeight, client: el.clientHeight, buttons };
      });
      expect(facts.scroll).toBeLessThanOrEqual(facts.client); // no scrolling
      expect(facts.buttons).toHaveLength(17);
      for (const b of facts.buttons) {
        expect(b.y).toBeGreaterThanOrEqual(facts.box.y);
        expect(b.y + b.h).toBeLessThanOrEqual(facts.box.y + facts.box.height);
        expect(b.x).toBeGreaterThanOrEqual(facts.box.x);
        expect(b.x + b.w).toBeLessThanOrEqual(facts.box.x + facts.box.width);
        expect(b.textVisible, b.name).toBe(false); // icons only; the name is the tooltip
        expect(b.title.length, b.name).toBeGreaterThan(10);
      }
      // no two buttons overlap
      for (let i = 0; i < facts.buttons.length; i++) for (let j = i + 1; j < facts.buttons.length; j++) {
        const a = facts.buttons[i], c = facts.buttons[j];
        expect(a.x + a.w <= c.x + 0.5 || c.x + c.w <= a.x + 0.5 || a.y + a.h <= c.y + 0.5 || c.y + c.h <= a.y + 0.5, `${a.name} / ${c.name}`).toBe(true);
      }
      expect(await page.locator('[data-testid^="tool-group-"]').count()).toBe(5);
      if (size.height === 720) await page.screenshot({ path: "test-results/tool-rail-1280.png" });
    });
  }

  test("choosing a tool: clicking, the key, and Tab all work, and the chosen one is marked", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    const pressed = () => page.getByTestId("tool-rail").locator('button[aria-pressed="true"]').evaluateAll((els) => els.map((e) => e.querySelector("span")?.textContent?.trim()));
    expect(await pressed()).toEqual(["선택"]);
    for (const [name, key] of [["브러시", "b"], ["손가락", "r"], ["스포이트", "i"], ["선택", "v"]] as const) {
      await page.keyboard.press(key);
      expect(await pressed()).toEqual([name]);
    }
    await pickTool(page, "유동화");
    expect(await pressed()).toEqual(["유동화"]);
    // Tab walks along the tool buttons (each is one stop) and Enter chooses
    await page.getByRole("button", { name: "선택", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "이동", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    expect(await pressed()).toEqual(["이동"]);
    const tip = await page.getByRole("button", { name: "브러시", exact: true }).getAttribute("title");
    expect(tip).toContain("(B)"); // the tooltip still carries the key
  });
});

test.describe("side panels", () => {
  test("fold and open by button and by key; the state is kept after a reload (this browser only)", async ({ page }) => {
    await openApp(page);
    expect(await open(page, "left")).toBe(true);
    expect(await colWidths(page)).toEqual([80, 248, expect.any(Number), 282]);
    await page.getByTestId("left-collapse").click();
    expect(await open(page, "left")).toBe(false);
    expect((await colWidths(page))[1]).toBe(26);
    await page.screenshot({ path: "test-results/panel-folded.png" });
    await page.getByTestId("left-expand").click();
    expect(await open(page, "left")).toBe(true);
    await page.keyboard.press("\\");
    expect(await open(page, "left")).toBe(false);
    await page.keyboard.press("Control+\\");
    expect(await open(page, "right")).toBe(false);
    expect((await colWidths(page))[3]).toBe(26);
    await reloadAndDiscard(page);
    expect(await open(page, "left")).toBe(false);
    expect(await open(page, "right")).toBe(false);
    expect(JSON.parse((await stored(page))!)).toMatchObject({ format: 1, left: { open: false }, right: { open: false } });
    await page.getByTestId("right-expand").click();
    await page.getByTestId("left-expand").click();
    expect(JSON.parse((await stored(page))!)).toMatchObject({ left: { open: true, width: 248 }, right: { open: true, width: 282 } }); // an explicit choice is kept, even when it equals what automatic would do
  });

  test("the shortcut is in the settings and can be changed", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "단축키" }).click();
    await expect(page.getByText("소스 패널 접기·펴기")).toBeVisible();
    await expect(page.getByText("레이어·속성 패널 접기·펴기")).toBeVisible();
  });

  test("drag the edge to change the width, limits hold, double-click restores the default, and it is kept after a reload", async ({ page }) => {
    await openApp(page);
    const edge = page.getByTestId("resize-left");
    const b = (await edge.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + 200);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 60, b.y + 200, { steps: 5 });
    await page.mouse.up();
    expect((await colWidths(page))[1]).toBe(308);
    await page.mouse.move(b.x + 60 + b.width / 2, b.y + 200);
    await page.mouse.down();
    await page.mouse.move(b.x + 900, b.y + 200, { steps: 5 });
    await page.mouse.up();
    expect((await colWidths(page))[1]).toBe(480); // the largest
    const edgeR = page.getByTestId("resize-right");
    const r = (await edgeR.boundingBox())!;
    await page.mouse.move(r.x + r.width / 2, r.y + 200);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width / 2 - 100, r.y + 200, { steps: 5 });
    await page.mouse.up();
    expect((await colWidths(page))[3]).toBe(382);
    const r2 = (await edgeR.boundingBox())!;
    await page.mouse.move(r2.x + r2.width / 2, r2.y + 200);
    await page.mouse.down();
    await page.mouse.move(2, r2.y + 200, { steps: 5 });
    await page.mouse.up();
    expect((await colWidths(page))[3]).toBe(520);
    await reloadAndDiscard(page);
    expect(await colWidths(page)).toEqual([80, 480, expect.any(Number), 520]);
    await page.getByTestId("resize-left").dblclick();
    await page.getByTestId("resize-right").dblclick();
    expect(await colWidths(page)).toEqual([80, 248, expect.any(Number), 282]);
    expect(await stored(page)).toBeNull();
  });

  test("a narrow window folds the panels by itself; they can be opened by hand", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await openApp(page);
    expect(await open(page, "left")).toBe(false);
    expect(await open(page, "right")).toBe(false);
    await page.getByTestId("left-expand").click();
    expect(await open(page, "left")).toBe(true);
    await page.screenshot({ path: "test-results/panel-narrow.png" });
  });

  test("the large source preview follows a wider panel and never covers it", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    const edge = (await page.getByTestId("resize-left").boundingBox())!;
    await page.mouse.move(edge.x + edge.width / 2, edge.y + 200);
    await page.mouse.down();
    await page.mouse.move(edge.x + 150, edge.y + 200, { steps: 5 });
    await page.mouse.up();
    const thumb = page.getByTestId("asset-thumb").nth(12);
    await thumb.scrollIntoViewIfNeeded();
    await expect(thumb).toHaveAttribute("data-state", "ready");
    await thumb.hover();
    const big = page.getByTestId("asset-big-preview");
    await expect(big).toBeVisible();
    const panel = (await page.getByTestId("panel-left").boundingBox())!;
    const box = (await big.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(panel.x + panel.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(720);
  });
});

/** extraction and moving land on the same image pixels however the panels are folded or resized */
async function coordinatesHold(page: Page, zoom: number) {
  await openApp(page);
  await uploadPng(page, pageWithCard());
  const steps: Array<() => Promise<void>> = [
    async () => void (await page.getByTestId("left-collapse").click()),
    async () => void (await page.getByTestId("right-collapse").click()),
    async () => {
      await page.getByTestId("left-expand").click();
      const e = (await page.getByTestId("resize-left").boundingBox())!;
      await page.mouse.move(e.x + e.width / 2, e.y + 300);
      await page.mouse.down();
      await page.mouse.move(e.x + 120, e.y + 300, { steps: 4 });
      await page.mouse.up();
    },
  ];
  let layers = 0;
  for (const step of steps) {
    await step();
    await zoomTo(page, zoom, CARD.x + CARD.width / 2, CARD.y + CARD.height / 2);
    await pickTool(page, "영역 추출");
    await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
    await expect.poll(async () => (await editor(page)).layers.length).toBe(++layers);
    const st = await editor(page);
    const l = st.layers[st.layers.length - 1];
    expect(l.crop).toEqual({ x: CARD.x, y: CARD.y, width: CARD.width, height: CARD.height });
    // moving: drag the layer by (30, 20) image pixels
    await pickTool(page, "선택");
    const from = await clientOf(page, CARD.x + 60, CARD.y + 50);
    const to = await clientOf(page, CARD.x + 90, CARD.y + 70);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 3 });
    await page.mouse.up();
    await expect.poll(async () => Math.round((await editor(page)).layers.find((x) => x.id === l.id)!.transform.x)).toBe(CARD.x + 30);
    expect(Math.round((await editor(page)).layers.find((x) => x.id === l.id)!.transform.y)).toBe(CARD.y + 20);
    await page.keyboard.press("Control+z"); // back, so the next round extracts from the same place
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await editor(page)).layers.length).toBe(layers - 1);
    layers--;
    await pickTool(page, "선택");
  }
}

test.describe("coordinates with folded and resized panels", () => {
  test("zoom 100%", async ({ page }) => coordinatesHold(page, 1));
  test("zoom 200%", async ({ page }) => coordinatesHold(page, 2));
  test.describe("DPR 2", () => {
    test.use({ deviceScaleFactor: 2 });
    test("zoom 200%", async ({ page }) => coordinatesHold(page, 2));
  });
});
