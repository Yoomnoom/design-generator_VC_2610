import { expect, test } from "@playwright/test";
import { CARD, PAGE, clientOf, dragClient, drawShape, drawStyleOf, editor, exportPngBytes, panelNames, pickTool, pngPixelAt, readPngSize, screenPixel } from "./helpers";
import { GRAY, GREEN, RED, deselect, diff, setup, useFill, vector } from "./shape-helpers";

test.describe("drawing a rectangle", () => {
  test("a drag makes a vector layer with the chosen colours, as one undo step; the tool returns to select", async ({ page }) => {
    await setup(page);
    await pickTool(page, "사각형");
    await expect(page.getByTestId("draw-style")).toBeVisible();
    await useFill(page, "#00aa00");
    await page.getByTestId("draw-width").fill("6");
    await page.getByTestId("draw-width").press("Enter");
    await expect.poll(async () => (await drawStyleOf(page)).strokeWidth).toBe(6);

    const past = (await editor(page)).past;
    await drawShape(page, "사각형", { x: 600, y: 500 }, { x: 800, y: 600 });
    const layer = await vector(page);
    expect(layer.content).toEqual({ kind: "rect", width: 200, height: 100, stroke: "#e5322d", strokeWidth: 6, fill: "#00aa00" });
    expect(layer).toMatchObject({ name: "사각형 1", transform: { x: 600, y: 500, scaleX: 1, scaleY: 1, rotation: 0 } });
    expect(layer.imageId).toBeUndefined(); // a description, not pixels
    expect((await editor(page)).past).toBe(past + 1);
    expect(await panelNames(page)).toEqual(["사각형 1"]);
    await expect(page.getByRole("button", { name: "선택", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("vector-thumb")).toBeVisible();

    await page.keyboard.press("Control+z");
    expect((await editor(page)).layers).toHaveLength(0);
  });

  test("the PNG and the screen agree: fill inside, outline on the edge, soft half pixels, the page untouched outside", async ({ page }) => {
    await setup(page);
    await pickTool(page, "사각형");
    await useFill(page, "#00aa00");
    await drawShape(page, "사각형", { x: 600, y: 500 }, { x: 800, y: 600 });
    await deselect(page);
    const png = await exportPngBytes(page);
    expect(readPngSize(png)).toMatchObject({ width: PAGE.width, height: PAGE.height });

    const probes: [string, number, number, number[]][] = [
      ["inside", 700, 550, GREEN],
      ["on the outline (its centre line)", 600, 550, RED], // 3 wide, centred on x = 600: pixels 599, 600, 601 are solid
      ["on the outline, bottom edge", 700, 600, RED],
      ["outside", 500, 550, GRAY],
      ["outside, above", 700, 480, GRAY],
    ];
    for (const [what, x, y, want] of probes) {
      expect(diff(await pngPixelAt(page, png, x, y), want), `PNG ${what}`).toBeLessThanOrEqual(2);
      expect(diff(await screenPixel(page, x, y), want), `screen ${what}`).toBeLessThanOrEqual(3);
    }
    // the half-covered pixel at the outline's outer edge (x = 598: the stroke reaches 598.5) is a mix of red and page
    const half = await pngPixelAt(page, png, 598, 550);
    expect(half[1]).toBeGreaterThan(RED[1] + 20);
    expect(half[1]).toBeLessThan(GRAY[1] - 20);
  });

  test("a click, or a drag too small to see, makes nothing", async ({ page }) => {
    await setup(page);
    await pickTool(page, "사각형");
    const c = await clientOf(page, 700, 550);
    await page.mouse.click(c.x, c.y);
    await dragClient(page, c, { x: c.x + 1, y: c.y + 30 });
    expect(await editor(page)).toMatchObject({ layers: [], past: 0 });
  });
});

test.describe("drawing an ellipse and a line", () => {
  test("an ellipse fills its curve, leaves the corners of its box alone, and has soft edge pixels in the PNG", async ({ page }) => {
    await setup(page);
    await pickTool(page, "원");
    await useFill(page, "#00aa00");
    await drawShape(page, "원", { x: 600, y: 450 }, { x: 800, y: 650 });
    await deselect(page);
    expect((await vector(page)).content).toMatchObject({ kind: "ellipse", width: 200, height: 200 });
    const png = await exportPngBytes(page);
    expect(diff(await pngPixelAt(page, png, 700, 550), GREEN)).toBeLessThanOrEqual(2);
    expect(diff(await pngPixelAt(page, png, 604, 454), GRAY)).toBeLessThanOrEqual(2); // a corner of the box: outside the curve
    expect(diff(await screenPixel(page, 604, 454), GRAY)).toBeLessThanOrEqual(3);
    let soft = 0;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const px = await pngPixelAt(page, png, 700 + Math.cos(a) * 101.5, 550 + Math.sin(a) * 101.5);
      if (diff(px, GRAY) > 6 && diff(px, RED) > 6) soft++;
    }
    expect(soft).toBeGreaterThan(5);
  });

  test("a line follows the diagonal it was dragged along, in both directions, and is page-coloured away from it", async ({ page }) => {
    await setup(page);
    await drawShape(page, "선", { x: 600, y: 450 }, { x: 800, y: 550 }); // down-right
    await drawShape(page, "선", { x: 600, y: 700 }, { x: 800, y: 600 }); // up-right
    const [down, up] = (await editor(page)).layers.map((l) => l.content);
    expect(down).toMatchObject({ kind: "line", direction: "down", width: 200, height: 100 });
    expect(up).toMatchObject({ kind: "line", direction: "up", width: 200, height: 100 });
    await deselect(page);
    const png = await exportPngBytes(page);
    for (const [x, y, want] of [[700, 500, RED], [700, 650, RED], [700, 450, GRAY], [700, 700, GRAY], [650, 660, GRAY]] as [number, number, number[]][]) {
      expect(diff(await pngPixelAt(page, png, x, y), want), `PNG (${x}, ${y})`).toBeLessThanOrEqual(2);
      expect(diff(await screenPixel(page, x, y), want), `screen (${x}, ${y})`).toBeLessThanOrEqual(3);
    }
  });

  test("a straight horizontal line still has a box, can be selected and is drawn", async ({ page }) => {
    await setup(page);
    await drawShape(page, "선", { x: 600, y: 550 }, { x: 800, y: 550 });
    expect((await vector(page)).content).toMatchObject({ width: 200, height: 1, strokeWidth: 3 });
    await deselect(page);
    const png = await exportPngBytes(page);
    expect(diff(await pngPixelAt(page, png, 700, 550), RED)).toBeLessThanOrEqual(40);
    expect(diff(await pngPixelAt(page, png, 700, 546), GRAY)).toBeLessThanOrEqual(2);
  });

  test("a line never takes a width of 0", async ({ page }) => {
    await setup(page);
    await pickTool(page, "선");
    await page.getByTestId("draw-width").fill("0");
    await page.getByTestId("draw-width").press("Enter");
    await drawShape(page, "선", { x: 600, y: 450 }, { x: 800, y: 550 });
    expect((await vector(page)).content.strokeWidth).toBeGreaterThanOrEqual(1);
  });
});

test.describe("the eyedropper", () => {
  test("it reads the colour of the finished picture and makes it the drawing colour", async ({ page }) => {
    await setup(page);
    await pickTool(page, "스포이트");
    const c = await clientOf(page, CARD.x + 100, CARD.y + 60);
    await page.mouse.click(c.x, c.y);
    await expect.poll(async () => (await drawStyleOf(page)).stroke).toBe("#0000ff");
    expect((await editor(page)).past).toBe(0); // reading a colour is not an edit
    const g = await clientOf(page, 900, 600);
    await page.mouse.click(g.x, g.y);
    await expect.poll(async () => (await drawStyleOf(page)).stroke).toBe("#f0f0f0");
  });

  test("it can set the fill colour instead, and sees a shape drawn on top (the render result, not the source)", async ({ page }) => {
    await setup(page);
    await pickTool(page, "사각형");
    await useFill(page, "#00aa00");
    await drawShape(page, "사각형", { x: 600, y: 500 }, { x: 800, y: 600 });
    await pickTool(page, "스포이트");
    await page.getByRole("button", { name: "→ 채움" }).click();
    expect((await drawStyleOf(page)).pickTarget).toBe("fill");
    const c = await clientOf(page, 700, 550);
    await page.mouse.click(c.x, c.y);
    await expect.poll(async () => (await drawStyleOf(page)).fill).toBe("#00aa00");
    expect((await drawStyleOf(page)).stroke).toBe("#e5322d");
  });

  test("a hidden layer is not seen by it", async ({ page }) => {
    await setup(page);
    await pickTool(page, "사각형");
    await useFill(page, "#00aa00");
    await drawShape(page, "사각형", { x: 600, y: 500 }, { x: 800, y: 600 });
    await page.getByRole("button", { name: /숨기기/ }).click();
    await pickTool(page, "스포이트");
    const c = await clientOf(page, 700, 550);
    await page.mouse.click(c.x, c.y);
    await expect.poll(async () => (await drawStyleOf(page)).stroke).toBe("#f0f0f0");
  });

  test("a transparent pixel is refused with a message instead of picking black", async ({ page }) => {
    await setup(page, 1, { x: 200, y: 150 });
    await pickTool(page, "스포이트");
    const before = await drawStyleOf(page);
    const c = await clientOf(page, 4, 4); // the capture's transparent corner
    await page.mouse.click(c.x, c.y);
    await expect(page.getByTestId("notice")).toContainText("투명");
    expect(await drawStyleOf(page)).toEqual(before);
  });

  for (const dpr of [1, 2]) {
    test.describe(`at 200% zoom, devicePixelRatio ${dpr}`, () => {
      test.use({ deviceScaleFactor: dpr });
      test("it reads the pixel under the cursor on either side of an edge, exactly", async ({ page }) => {
        await setup(page, 2, { x: CARD.x + 120, y: CARD.y + 60 });
        await pickTool(page, "스포이트");
        for (const [x, want] of [[CARD.x + 0.25, "#0000ff"], [CARD.x - 0.25, "#f0f0f0"], [CARD.x + CARD.width - 0.25, "#0000ff"], [CARD.x + CARD.width + 0.25, "#f0f0f0"]] as [number, string][]) {
          const c = await clientOf(page, x, CARD.y + 60);
          await page.mouse.click(c.x, c.y);
          await expect.poll(async () => (await drawStyleOf(page)).stroke, { message: `colour at x = ${x}` }).toBe(want);
          await page.evaluate(() => (window as any).__slc.getState().setDrawStyle({ stroke: "#123456" })); // so the next read has to change it
        }
      });
    });
  }
});
