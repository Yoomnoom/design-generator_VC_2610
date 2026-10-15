import { Page, expect, test } from "@playwright/test";
import { CARD, dragImageRect, editor, openApp, pageWithCard, pickTool, uploadPng, zoomTo } from "./helpers";

const tab = (page: Page, id: "builtin" | "mine" | "template") => page.getByTestId(`asset-tab-${id}`).click();

/** how many pixels of a thumbnail canvas are drawn (alpha > 0): i.e. the source's own drawing; the grey ground is CSS, not pixels */
const inkOf = (page: Page, testId: string, nth = 0) =>
  page.getByTestId(testId).nth(nth).locator("canvas").evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 0) ink++;
    }
    return { ink, width: c.width, height: c.height };
  });

/** where the ink is in a canvas (bounding box of alpha > 0) and how it compares with another canvas drawn at another size: both are
 *  reduced to the same small grid over their ink boxes, composited on the same ground, and compared pixel by pixel */
const compareInk = (page: Page, smallUrl: string, bigUrl: string) =>
  page.evaluate(
    async ([a, b]) => {
      const load = (u: string) => new Promise<HTMLImageElement>((res) => { const i = new Image(); i.onload = () => res(i); i.src = u; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const box = (img: HTMLImageElement) => {
        const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
        const x = c.getContext("2d")!; x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
        for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) if (d[(y * c.width + xx) * 4 + 3] > 8) { x0 = Math.min(x0, xx); y0 = Math.min(y0, y); x1 = Math.max(x1, xx); y1 = Math.max(y1, y); }
        return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
      };
      const ba = box(ia), bb = box(ib);
      const G = 24;
      const grid = (img: HTMLImageElement, bx: { x: number; y: number; w: number; h: number }) => {
        const c = document.createElement("canvas"); c.width = G; c.height = G;
        const x = c.getContext("2d")!; x.fillStyle = "#eceef1"; x.fillRect(0, 0, G, G);
        x.imageSmoothingQuality = "high"; x.drawImage(img, bx.x, bx.y, bx.w, bx.h, 0, 0, G, G);
        return x.getImageData(0, 0, G, G).data;
      };
      const ga = grid(ia, ba), gb = grid(ib, bb);
      let sum = 0;
      for (let i = 0; i < ga.length; i += 4) for (let k = 0; k < 3; k++) sum += Math.abs(ga[i + k] - gb[i + k]);
      return { meanDiff: sum / (G * G * 3), aspectSmall: ba.w / ba.h, aspectBig: bb.w / bb.h, bigW: bb.w, bigH: bb.h };
    },
    [smallUrl, bigUrl],
  );

const bubbleFacts = (page: Page) =>
  page.getByTestId("asset-big-preview").evaluate((el) => {
    const r = el.getBoundingClientRect();
    let opacity = 1;
    for (let n: Element | null = el; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
    const aside = document.querySelector("[data-testid=asset-panel]")!.closest("aside")!.getBoundingClientRect();
    const canvas = el.querySelector("canvas")!;
    return {
      box: r.toJSON(), opacity, bg: getComputedStyle(el).backgroundColor, side: el.getAttribute("data-side"), parentIsBody: el.parentElement === document.body,
      asidePanel: aside.toJSON(), vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, canvasPx: canvas.width, canvasCss: canvas.getBoundingClientRect().width,
      text: (el as HTMLElement).innerText,
    };
  });


async function withLayer(page: Page) {
  await openApp(page);
  await uploadPng(page, pageWithCard());
  await zoomTo(page, 1, 600, 300);
  await pickTool(page, "영역 추출");
  await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
  await expect.poll(async () => (await editor(page)).layers.length).toBe(1);
}

test.describe("source previews", () => {
  test("built-in: every card shows a drawing, a button's three looks sit side by side in one card, and no label is cut off", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    const thumbs = page.getByTestId("asset-thumb");
    const count = await thumbs.count();
    expect(count).toBeGreaterThanOrEqual(12 + 4 + 5);
    // thumbnails are drawn as they come into view: scroll through the panel so each one is seen
    for (let i = 0; i < count; i++) {
      await thumbs.nth(i).scrollIntoViewIfNeeded();
      await expect(thumbs.nth(i)).toHaveAttribute("data-state", "ready");
      expect((await inkOf(page, "asset-thumb", i)).ink, `thumb ${i} has a drawing`).toBeGreaterThan(5);
    }
    const group = page.getByTestId("asset-button-group-fill");
    await group.scrollIntoViewIfNeeded();
    const boxes = await group.getByTestId("asset-thumb").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
    expect(boxes).toHaveLength(3);
    expect(boxes[0].y).toBeCloseTo(boxes[1].y, 0); // side by side
    expect(boxes[1].x).toBeGreaterThan(boxes[0].x + boxes[0].width - 1);
    // the three looks are drawn differently
    const sigs = await group.getByTestId("asset-thumb").locator("canvas").evaluateAll((cs) => cs.map((c) => (c as HTMLCanvasElement).toDataURL()));
    expect(new Set(sigs).size).toBe(3);
    // nothing is clipped: no card is wider than the panel
    const panel = await page.getByTestId("asset-panel").boundingBox();
    for (const b of await page.getByTestId("asset-panel").locator("button").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
      expect(b.x + b.width).toBeLessThanOrEqual(panel!.x + panel!.width + 1);
    }
    await page.getByTestId("asset-panel").screenshot({ path: "test-results/asset-preview-builtin.png" });
  });

  test("hovering a card shows a large, sharp, opaque preview card beside the panel with the name and size", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    const thumb = page.getByTestId("asset-thumb").nth(12); // the card
    await thumb.scrollIntoViewIfNeeded();
    await expect(thumb).toHaveAttribute("data-state", "ready");
    const smallUrl = await thumb.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL());
    const small = await thumb.locator("canvas").first().boundingBox();
    await thumb.hover();
    const big = page.getByTestId("asset-big-preview");
    await expect(big).toBeVisible();
    await expect(page.getByTestId("asset-big-size")).toHaveText(/^\d+×\d+$/);
    const f = await bubbleFacts(page);
    expect(f.parentIsBody).toBe(true); // not a child of the list card
    expect(f.opacity).toBe(1);
    expect(f.bg).toBe("rgb(255, 255, 255)");
    expect(f.side).toBe("right"); // the asset panel is the left-hand one: the card is on its canvas side
    expect(f.box.x).toBeGreaterThanOrEqual(f.asidePanel.x + f.asidePanel.width); // does not cover the list
    expect(f.box.x).toBeGreaterThanOrEqual(0);
    expect(f.box.y).toBeGreaterThanOrEqual(0);
    expect(f.box.y + f.box.height).toBeLessThanOrEqual(f.vh);
    expect(f.text).toContain((await thumb.getAttribute("title"))!); // the name
    expect(f.canvasCss).toBeGreaterThan(small!.width);
    expect(Math.abs(f.canvasPx - f.canvasCss * f.dpr)).toBeLessThanOrEqual(1); // one canvas pixel per device pixel: not stretched
    const bigUrl = await big.locator("canvas").evaluate((c: HTMLCanvasElement) => c.toDataURL());
    const cmp = await compareInk(page, smallUrl, bigUrl);
    expect(cmp.meanDiff).toBeLessThan(28); // the large picture shows the same drawing as the thumbnail (one grid cell is 1/24 of the shape)
    expect(Math.abs(cmp.aspectBig / cmp.aspectSmall - 1)).toBeLessThan(0.08);
    await page.screenshot({ path: "test-results/asset-preview-hover.png" });
    await page.mouse.move(5, 5);
    await expect(big).toHaveCount(0); // closes as soon as the pointer leaves
  });

  test("with no project the cards are disabled, and the large preview is still fully opaque", async ({ page }) => {
    await openApp(page);
    const thumb = page.getByTestId("asset-panel").getByTestId("asset-thumb").nth(12);
    await thumb.scrollIntoViewIfNeeded();
    await expect(thumb).toHaveAttribute("data-state", "ready");
    await thumb.hover();
    await expect(page.getByTestId("asset-big-preview")).toBeVisible();
    const f = await bubbleFacts(page);
    expect(f.opacity).toBe(1);
    expect(f.bg).toBe("rgb(255, 255, 255)");
    await page.screenshot({ path: "test-results/asset-preview-hover-disabled.png" });
  });

  test("a thin source (divider, underline) is a visible mark in the middle of its thumbnail", async ({ page }) => {
    await openApp(page);
    const panel = page.getByTestId("asset-panel");
    const divider = panel.getByTestId("asset-divider").getByTestId("asset-thumb");
    await divider.scrollIntoViewIfNeeded();
    await expect(divider).toHaveAttribute("data-state", "ready");
    const r = await divider.locator("canvas").evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      const rows = new Set<number>();
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) rows.add(Math.floor(i / 4 / c.width));
      return { rows: [...rows], height: c.height, cssHeight: c.getBoundingClientRect().height };
    });
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.cssHeight).toBeGreaterThanOrEqual(14); // minimum height
    const mid = r.height / 2;
    expect(Math.min(...r.rows)).toBeGreaterThan(mid - 3);
    expect(Math.max(...r.rows)).toBeLessThan(mid + 3); // in the middle
    const box = await divider.boundingBox();
    const canvas = await divider.locator("canvas").boundingBox();
    expect(Math.abs(canvas!.y + canvas!.height / 2 - (box!.y + box!.height / 2))).toBeLessThan(2); // centred in the card
  });

  test("a narrow window: the large preview still fits inside it", async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 560 });
    await openApp(page);
    await uploadPng(page, pageWithCard());
    const thumb = page.getByTestId("asset-thumb").nth(12);
    await thumb.scrollIntoViewIfNeeded();
    await expect(thumb).toHaveAttribute("data-state", "ready");
    await thumb.hover();
    await expect(page.getByTestId("asset-big-preview")).toBeVisible();
    const f = await bubbleFacts(page);
    expect(f.box.x).toBeGreaterThanOrEqual(0);
    expect(f.box.y).toBeGreaterThanOrEqual(0);
    expect(f.box.x + f.box.width).toBeLessThanOrEqual(f.vw);
    expect(f.box.y + f.box.height).toBeLessThanOrEqual(f.vh);
    await page.screenshot({ path: "test-results/asset-preview-hover-narrow.png" });
  });

  test("a card at the bottom edge of the panel: the preview stays inside the window", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    const thumbs = page.getByTestId("asset-thumb");
    const last = thumbs.nth((await thumbs.count()) - 1);
    await last.scrollIntoViewIfNeeded();
    await expect(last).toHaveAttribute("data-state", "ready");
    await last.hover();
    await expect(page.getByTestId("asset-big-preview")).toBeVisible();
    const f = await bubbleFacts(page);
    expect(f.box.y + f.box.height).toBeLessThanOrEqual(f.vh);
    expect(f.box.y).toBeGreaterThanOrEqual(0);
  });

  test("my sources and templates get the same card: opaque, beside the panel, with name and size", async ({ page }) => {
    await withLayer(page);
    await tab(page, "mine");
    await page.getByTestId("asset-save-name").fill("Blue card");
    await page.getByTestId("asset-save").click();
    const mine = page.getByTestId("my-asset-thumb");
    await expect(mine).toHaveAttribute("data-state", "ready");
    await mine.hover();
    await expect(page.getByTestId("asset-big-preview")).toBeVisible();
    let f = await bubbleFacts(page);
    expect(f.opacity).toBe(1);
    expect(f.text).toContain("Blue card");
    expect(f.box.x).toBeGreaterThanOrEqual(f.asidePanel.x + f.asidePanel.width);
    await page.screenshot({ path: "test-results/asset-preview-hover-mine.png" });
    await page.mouse.move(5, 5);
    await expect(page.getByTestId("asset-big-preview")).toHaveCount(0);
    await tab(page, "template");
    const t = page.getByTestId("asset-panel").getByTestId("template-login-thumb");
    await t.scrollIntoViewIfNeeded();
    await expect(t).toHaveAttribute("data-state", "ready");
    await t.hover();
    await expect(page.getByTestId("asset-big-preview")).toBeVisible();
    f = await bubbleFacts(page);
    expect(f.opacity).toBe(1);
    expect(f.box.y + f.box.height).toBeLessThanOrEqual(f.vh);
    await expect(page.getByTestId("asset-big-size")).toHaveText("390×844");
    await page.screenshot({ path: "test-results/asset-preview-hover-template.png" });
  });
  test("my sources: an empty list says so; saving adds a picture card; deleting removes it", async ({ page }) => {
    await withLayer(page);
    await tab(page, "mine");
    await expect(page.getByTestId("asset-empty")).toBeVisible();
    await page.getByTestId("asset-save-name").fill("Blue card");
    await page.getByTestId("asset-save").click();
    const thumb = page.getByTestId("my-asset-thumb");
    await expect(thumb).toHaveCount(1);
    await expect(thumb).toHaveAttribute("data-state", "ready");
    const ink = await inkOf(page, "my-asset-thumb");
    expect(ink.ink).toBeGreaterThan(50);
    await page.getByTestId("asset-panel").screenshot({ path: "test-results/asset-preview-mine.png" });
    await page.getByTestId("asset-delete").click();
    await expect(page.getByTestId("my-asset-thumb")).toHaveCount(0);
    await expect(page.getByTestId("asset-empty")).toBeVisible();
  });

  test("templates: each card shows the whole screen in the right proportions", async ({ page }) => {
    await openApp(page); // no project: templates still show
    await tab(page, "template");
    for (const id of ["login", "cards", "settings"]) {
      // the start screen shows the same thumbnails, so look inside the panel
      const t = page.getByTestId("asset-panel").getByTestId(`template-${id}-thumb`);
      await t.scrollIntoViewIfNeeded(); // drawn when it comes into view
      await expect(t).toHaveAttribute("data-state", "ready");
      const { ink, width, height } = await t.locator("canvas").first().evaluate((c: HTMLCanvasElement) => {
        const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) n++;
        return { ink: n, width: c.width, height: c.height };
      });
      expect(ink).toBeGreaterThan(100);
      expect(Math.abs(width / height - 390 / 844)).toBeLessThan(0.03);
    }
    await page.getByTestId("asset-panel").screenshot({ path: "test-results/asset-preview-templates.png" });
  });
});

test.describe("source previews: ground and narrow windows", () => {
  const ground = (page: Page, id: string) => page.getByTestId("asset-panel").getByTestId(`asset-${id}`).getByTestId("asset-thumb").evaluate((el) => ({ attr: el.getAttribute("data-ground"), bg: getComputedStyle(el).backgroundColor }));

  test("a bright source gets the dark ground, a dark one the light ground; the large preview uses the same ground; the pixels have none", async ({ page }) => {
    await openApp(page);
    for (const id of ["divider", "icon-plus"]) {
      const th = page.getByTestId("asset-panel").getByTestId(`asset-${id}`).getByTestId("asset-thumb");
      await th.scrollIntoViewIfNeeded();
      await expect(th).toHaveAttribute("data-state", "ready");
    }
    const bright = await ground(page, "divider"); // #d1d5db: a light line
    const dark = await ground(page, "icon-plus"); // #111827
    expect(bright.attr).toBe("#59616f");
    expect(bright.bg).toBe("rgb(89, 97, 111)");
    expect(dark.attr).toBe("#eceef1");
    expect(dark.bg).toBe("rgb(236, 238, 241)");
    for (const [id, want] of [["divider", "rgb(89, 97, 111)"], ["icon-plus", "rgb(236, 238, 241)"]] as const) {
      await page.getByTestId("asset-panel").getByTestId(`asset-${id}`).getByTestId("asset-thumb").hover();
      await expect(page.getByTestId("asset-big-preview")).toBeVisible();
      expect(await page.getByTestId("asset-big-preview").locator("[data-ground]").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(want);
      await page.mouse.move(5, 5);
      await expect(page.getByTestId("asset-big-preview")).toHaveCount(0);
    }
    // the ground is CSS only: the canvas itself is transparent outside the drawing
    const corner = await page.getByTestId("asset-panel").getByTestId("asset-divider").getByTestId("asset-thumb").locator("canvas").evaluate((c: HTMLCanvasElement) => Array.from(c.getContext("2d")!.getImageData(0, 0, 1, 1).data));
    expect(corner[3]).toBe(0);
    await page.getByTestId("asset-panel").screenshot({ path: "test-results/asset-preview-ground.png" });
  });

  for (const width of [760, 640]) {
    test(`a ${width}px window: the large preview lies beside the panel (not over the list), inside the window, and closes when the pointer leaves`, async ({ page }) => {
      await page.setViewportSize({ width, height: 600 });
      await openApp(page);
      await uploadPng(page, pageWithCard());
      for (const idx of [12, 0]) {
        const thumb = page.getByTestId("asset-thumb").nth(idx);
        await thumb.scrollIntoViewIfNeeded();
        await expect(thumb).toHaveAttribute("data-state", "ready");
        await thumb.hover();
        await expect(page.getByTestId("asset-big-preview")).toBeVisible();
        const f = await bubbleFacts(page);
        expect(f.side).not.toBe("over");
        expect(f.box.x).toBeGreaterThanOrEqual(f.asidePanel.x + f.asidePanel.width - 0.5); // does not overlap the list
        expect(f.box.y).toBeGreaterThanOrEqual(0);
        expect(f.box.x + f.box.width).toBeLessThanOrEqual(f.vw);
        expect(f.box.y + f.box.height).toBeLessThanOrEqual(f.vh);
        expect(f.opacity).toBe(1);
        const name = (await thumb.getAttribute("title"))!;
        expect(f.text.split(name).length - 1).toBe(1); // the name once, not doubled
        if (idx === 12) await page.screenshot({ path: `test-results/asset-preview-narrow-${width}.png` });
        await page.mouse.move(width - 3, 3);
        await expect(page.getByTestId("asset-big-preview")).toHaveCount(0);
      }
    });
  }
});
test.describe("source previews at device pixel ratio 2", () => {
  test.use({ deviceScaleFactor: 2 });
  test("the large preview has two canvas pixels per CSS pixel and matches the thumbnail's drawing", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    const thumb = page.getByTestId("asset-thumb").nth(12);
    await thumb.scrollIntoViewIfNeeded();
    await expect(thumb).toHaveAttribute("data-state", "ready");
    await thumb.hover();
    await expect(page.getByTestId("asset-big-preview")).toBeVisible();
    const f = await bubbleFacts(page);
    expect(f.dpr).toBe(2);
    expect(Math.abs(f.canvasPx - f.canvasCss * 2)).toBeLessThanOrEqual(1);
    expect(f.canvasPx).toBeGreaterThan(300);
    await page.screenshot({ path: "test-results/asset-preview-hover-dpr2.png" });
  });
});