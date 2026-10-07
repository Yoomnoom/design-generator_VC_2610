import { Page, expect, test } from "@playwright/test";
import fs from "node:fs";
import {
  CARD, GRAY, PAGE, blank, clientOf, dragImageRect, editor, encodePng, konvaPixel, openApp, pageWithCard, pickTool, readPngSize, splitPage, upload, uploadPng, zoomTo,
} from "./helpers";

const cardRect = { from: { x: CARD.x, y: CARD.y }, to: { x: CARD.x + CARD.width, y: CARD.y + CARD.height } };
const cardCenter = { x: CARD.x + CARD.width / 2, y: CARD.y + CARD.height / 2 };

/** exports through the dialog and returns the downloaded file's bytes */
async function exportPng(page: Page): Promise<Buffer> {
  await page.getByRole("button", { name: "PNG 내보내기" }).click();
  const download = page.waitForEvent("download");
  await page.getByTestId("export-save").click();
  const path = await (await download).path();
  await expect(page.getByTestId("export-done")).toBeVisible();
  return fs.readFileSync(path);
}

/** RGBA at (x, y) of a PNG, decoded by the browser itself */
const pngPixel = (page: Page, png: Buffer, x: number, y: number) =>
  page.evaluate(
    async ([b64, px, py]) => {
      const bytes = Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d")!;
      g.drawImage(bmp, 0, 0);
      return Array.from(g.getImageData(px as number, py as number, 1, 1).data);
    },
    [png.toString("base64"), x, y] as const,
  );

test.describe("upload and frame", () => {
  test("shows the empty state, then a frame at the uploaded image's own size", async ({ page }, info) => {
    await openApp(page);
    await expect(page.getByRole("heading", { name: "화면 캡처를 올려주세요" })).toBeVisible();
    await expect(page.getByRole("button", { name: "PNG 내보내기" })).toBeDisabled();

    await uploadPng(page, pageWithCard());
    const label = await page.getByTestId("screen-label").innerText();
    expect(label).toContain(`${PAGE.width} × ${PAGE.height} px`);
    expect(label).not.toContain("1440"); // the wireframe's example size is not hard-coded
    expect((await editor(page)).screen).toMatchObject({ width: PAGE.width, height: PAGE.height });
    await expect(page.getByTestId("source-name")).toHaveText("capture.png");
    await info.attach("frame", { body: await page.screenshot(), contentType: "image/png" });
  });

  test("a differently sized image gets its own label", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, blank(375, 812, GRAY));
    await expect(page.getByTestId("screen-label")).toContainText("375 × 812 px");
  });

  test("Konva really paints the screenshot (not just an empty canvas)", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    await expect(page.locator(".konvajs-content canvas").first()).toBeVisible();
    const card = await clientOf(page, cardCenter.x, cardCenter.y);
    const bg = await clientOf(page, 900, 600);
    expect((await konvaPixel(page, card.x, card.y)).rgba).toEqual([0, 0, 255, 255]);
    expect((await konvaPixel(page, bg.x, bg.y)).rgba).toEqual([240, 240, 240, 255]);
  });

  test("dropping a file onto the canvas loads it", async ({ page }) => {
    await openApp(page);
    const data = encodePng(pageWithCard()).toString("base64");
    const dt = await page.evaluateHandle(async (b64) => {
      const t = new DataTransfer();
      t.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], "dropped.png", { type: "image/png" }));
      return t;
    }, data);
    await page.locator("section").dispatchEvent("drop", { dataTransfer: dt });
    await expect(page.getByTestId("screen-label")).toContainText(`${PAGE.width} × ${PAGE.height}`);
    await expect(page.getByTestId("source-name")).toHaveText("dropped.png");
  });

  test("a file that is not PNG/JPG is refused with a message", async ({ page }) => {
    await openApp(page);
    await upload(page, { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hi") });
    await expect(page.locator("aside").getByRole("alert")).toContainText("PNG 또는 JPG");
    await expect(page.getByTestId("screen-label")).toHaveCount(0);
  });

  test("a corrupt PNG is refused with a message", async ({ page }) => {
    await openApp(page);
    await upload(page, { name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not really a png") });
    await expect(page.locator("aside").getByRole("alert")).toContainText("읽을 수 없습니다");
  });

  test("replacing an edited project asks first; cancelling keeps the work", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    await pickTool(page, "영역 추출");
    await dragImageRect(page, cardRect.from, cardRect.to);
    expect((await editor(page)).layers).toHaveLength(1);

    await upload(page, { name: "other.png", mimeType: "image/png", buffer: encodePng(blank(100, 100, GRAY)) });
    await expect(page.getByRole("alertdialog")).toContainText("other.png");
    await page.getByRole("button", { name: "취소", exact: true }).click();
    expect((await editor(page)).layers).toHaveLength(1);

    await upload(page, { name: "other.png", mimeType: "image/png", buffer: encodePng(blank(100, 100, GRAY)) });
    await page.getByRole("button", { name: "새로 불러오기" }).click();
    await expect(page.getByTestId("screen-label")).toContainText("100 × 100");
    expect((await editor(page)).layers).toHaveLength(0);
  });
});

test.describe("what is actually visible", () => {
  test("the size label is not hidden behind the zoom controls", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    const label = (await page.getByTestId("screen-label").boundingBox())!;
    const controls = (await page.getByRole("button", { name: "화면 맞춤" }).locator("..").boundingBox())!;
    const overlap = label.x < controls.x + controls.width && label.x + label.width > controls.x && label.y < controls.y + controls.height && label.y + label.height > controls.y;
    expect(overlap).toBe(false);
    const viewport = (await page.getByTestId("viewport").boundingBox())!;
    expect(label.y).toBeGreaterThanOrEqual(viewport.y); // and it is inside the canvas area
  });

  for (const zoom of [0.68, 1, 1.5, 2]) {
    test(`zoom ${zoom * 100}%: after the card is moved away, no hairline of the original is left at the old spot`, async ({ page }) => {
      await openApp(page);
      await uploadPng(page, pageWithCard());
      await zoomTo(page, zoom, cardCenter.x, cardCenter.y);
      await pickTool(page, "영역 추출");
      await dragImageRect(page, cardRect.from, cardRect.to);
      await pickTool(page, "선택");
      const grab = await clientOf(page, cardCenter.x, cardCenter.y);
      await page.mouse.move(grab.x, grab.y);
      await page.mouse.down();
      await page.mouse.move(grab.x + 120, grab.y + 260, { steps: 10 });
      await page.mouse.up();

      // every CSS pixel in and around the old spot, edges included, must be background gray: no blue, no red
      const tl = await clientOf(page, CARD.x, CARD.y);
      const br = await clientOf(page, CARD.x + CARD.width, CARD.y + CARD.height);
      const bad: string[] = [];
      for (let x = Math.floor(tl.x) - 3; x <= Math.ceil(br.x) + 3; x += 1) {
        for (const y of [Math.floor(tl.y) - 3, Math.floor(tl.y), Math.floor(br.y) - 1, Math.floor(br.y), Math.ceil(br.y) + 3]) {
          const [r, g, b] = (await konvaPixel(page, x, y)).rgba;
          if (Math.abs(r - 240) > 3 || Math.abs(g - 240) > 3 || Math.abs(b - 240) > 3) bad.push(`(${x},${y}) rgb(${r},${g},${b})`);
        }
      }
      expect(bad.slice(0, 5)).toEqual([]);
    });
  }
});

test.describe("EXIF orientation", () => {
  /** a 600×300 JPEG whose EXIF says "rotate 90°", so it must appear as 300×600 */
  const exifJpeg = (page: Page, orientation: number) =>
    page.evaluate(async (o) => {
      const c = new OffscreenCanvas(600, 300);
      const g = c.getContext("2d")!;
      g.fillStyle = "#0000ff";
      g.fillRect(0, 0, 600, 300);
      g.fillStyle = "#ff0000";
      g.fillRect(0, 0, 300, 150);
      const jpeg = new Uint8Array(await (await c.convertToBlob({ type: "image/jpeg", quality: 1 })).arrayBuffer());
      const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0];
      const len = exif.length + 2;
      const out = new Uint8Array([...jpeg.slice(0, 2), 0xff, 0xe1, len >> 8, len & 255, ...exif, ...jpeg.slice(2)]);
      let s = "";
      for (const b of out) s += String.fromCharCode(b);
      return btoa(s);
    }, orientation);

  for (const [orientation, w, h] of [[1, 600, 300], [6, 300, 600], [8, 300, 600], [3, 600, 300]] as const) {
    test(`orientation ${orientation}: frame label and exported PNG are both ${w} × ${h}`, async ({ page }) => {
      await openApp(page);
      const buffer = Buffer.from(await exifJpeg(page, orientation), "base64");
      await upload(page, { name: "photo.jpg", mimeType: "image/jpeg", buffer });
      await expect(page.getByTestId("screen-label")).toContainText(`${w} × ${h} px`);
      expect((await editor(page)).screen).toMatchObject({ width: w, height: h });

      await page.getByRole("button", { name: "PNG 내보내기" }).click();
      await expect(page.getByTestId("export-size")).toContainText(`${w} × ${h} px`);
      await page.getByRole("button", { name: "닫기" }).click();
      const png = await exportPng(page);
      expect(readPngSize(png)).toMatchObject({ width: w, height: h });
    });
  }
});

test.describe("zoom and pan", () => {
  test("Ctrl+wheel zooms around the cursor and keeps the image point under it", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    const at = await clientOf(page, cardCenter.x, cardCenter.y);
    const before = await editor(page);
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -300);
    await page.keyboard.up("Control");
    await expect.poll(async () => (await editor(page)).view.zoom).toBeGreaterThan(before.view.zoom);
    const after = await clientOf(page, cardCenter.x, cardCenter.y);
    expect(Math.abs(after.x - at.x)).toBeLessThan(1);
    expect(Math.abs(after.y - at.y)).toBeLessThan(1);
  });

  test("plain wheel pans without changing zoom", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    const before = (await editor(page)).view;
    await page.mouse.move(600, 400);
    await page.mouse.wheel(0, 120);
    await expect.poll(async () => (await editor(page)).view.panY).toBeLessThan(before.panY);
    expect((await editor(page)).view.zoom).toBe(before.zoom);
  });

  test("the hand tool drags the view", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    const before = (await editor(page)).view;
    await pickTool(page, "이동");
    await page.mouse.move(600, 400);
    await page.mouse.down();
    await page.mouse.move(660, 430, { steps: 5 });
    await page.mouse.up();
    const after = (await editor(page)).view;
    expect([Math.round(after.panX - before.panX), Math.round(after.panY - before.panY)]).toEqual([60, 30]);
    expect((await editor(page)).past).toBe(0); // moving the view is not an edit
  });

  test("the zoom buttons and fit work", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    const fit = (await editor(page)).view.zoom;
    await page.getByRole("button", { name: "확대" }).click();
    expect((await editor(page)).view.zoom).toBeCloseTo(fit * 1.2, 5);
    await page.getByRole("button", { name: "100%로 되돌리기" }).click();
    expect((await editor(page)).view.zoom).toBeCloseTo(1, 5);
    await page.getByRole("button", { name: "화면 맞춤" }).click();
    expect((await editor(page)).view.zoom).toBeCloseTo(fit, 5);
  });
});

/** the same flow at the two zoom levels the spec cares about, repeated under devicePixelRatio 1 and 2 */
for (const dpr of [1, 2]) {
  test.describe(`extract, move and export — devicePixelRatio ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });

    test("the canvas really runs at this devicePixelRatio", async ({ page }) => {
      await openApp(page);
      await uploadPng(page, pageWithCard());
      const k = await konvaPixel(page, 600, 300);
      expect(await page.evaluate(() => window.devicePixelRatio)).toBe(dpr);
      expect(k.scale).toBe(dpr);
      expect(k.backingWidth).toBe(Math.round(k.cssWidth * dpr));
    });

    for (const zoom of [1, 2]) {
      test(`zoom ${zoom * 100}%: the extracted rectangle is the dragged original pixels, exactly`, async ({ page }) => {
        await openApp(page);
        await uploadPng(page, pageWithCard());
        await zoomTo(page, zoom, cardCenter.x, cardCenter.y);
        await pickTool(page, "영역 추출");

        await dragImageRect(page, cardRect.from, cardRect.to, { release: false });
        await expect(page.getByTestId("marquee-tag")).toHaveText(`선택 영역 ${CARD.width} × ${CARD.height} px`); // the live preview
        await page.mouse.up();

        const s = await editor(page);
        expect(s.layers).toHaveLength(1);
        expect(s.layers[0].crop).toEqual(CARD);
        expect(s.layers[0].transform).toMatchObject({ x: CARD.x, y: CARD.y });
        expect(s.patches).toHaveLength(1);
        expect(s.patches[0]).toMatchObject({ rect: CARD, fill: "#f0f0f0" });
        expect(s.past).toBe(1); // layer + patch are one undo step
      });
    }

    test("zoom 200%: dragging a layer moves it by the matching original pixels, as one history step", async ({ page }) => {
      await openApp(page);
      await uploadPng(page, pageWithCard());
      await zoomTo(page, 2, cardCenter.x, cardCenter.y);
      await pickTool(page, "영역 추출");
      await dragImageRect(page, cardRect.from, cardRect.to);
      await pickTool(page, "선택");

      const from = await clientOf(page, cardCenter.x, cardCenter.y);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 50, from.y + 25, { steps: 10 });
      await page.mouse.move(from.x + 100, from.y + 50, { steps: 10 }); // 100 × 50 CSS px at 200% = 50 × 25 image px
      await expect.poll(async () => (await editor(page)).past).toBe(1); // nothing recorded while still dragging
      await page.mouse.up();

      const s = await editor(page);
      expect(s.layers[0].transform).toEqual({ x: CARD.x + 50, y: CARD.y + 25, scaleX: 1, scaleY: 1, rotation: 0 });
      expect(s.past).toBe(2); // extraction + one move, however many mouse events the drag had
      expect(s.selected).toEqual([s.layers[0].id]);
    });

    test("exported PNG is the original size with the card moved, its old spot filled, and transparency kept", async ({ page }, info) => {
      await openApp(page);
      await uploadPng(page, pageWithCard());
      await zoomTo(page, 2, cardCenter.x, cardCenter.y);
      await pickTool(page, "영역 추출");
      await dragImageRect(page, cardRect.from, cardRect.to);
      await pickTool(page, "선택");
      const from = await clientOf(page, cardCenter.x, cardCenter.y);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 200, from.y + 100, { steps: 12 }); // → +100, +50 image px
      await page.mouse.up();

      await page.getByRole("button", { name: "PNG 내보내기" }).click();
      await expect(page.getByTestId("export-size")).toContainText(`${PAGE.width} × ${PAGE.height} px`);
      await page.getByRole("button", { name: "닫기" }).click();
      const png = await exportPng(page);
      await info.attach(`export-dpr${dpr}.png`, { body: png, contentType: "image/png" });

      expect(readPngSize(png)).toEqual({ signature: [137, 80, 78, 71, 13, 10, 26, 10], width: PAGE.width, height: PAGE.height }); // not ×DPR, not ×zoom
      expect(await pngPixel(page, png, CARD.x + 100 + 100, CARD.y + 50 + 60)).toEqual([0, 0, 255, 255]); // card, at its new place
      expect(await pngPixel(page, png, CARD.x + 100 + 5, CARD.y + 50 + 5)).toEqual([255, 0, 0, 255]); // its red marker moved with it
      expect(await pngPixel(page, png, CARD.x + 30, CARD.y + 100)).toEqual([240, 240, 240, 255]); // old spot, now background
      expect(await pngPixel(page, png, 5, 5)).toEqual([0, 0, 0, 0]); // the source's transparent corner is still transparent
      expect(await pngPixel(page, png, 1100, 700)).toEqual([240, 240, 240, 255]);
    });
  });
}

test.describe("background that needs a human", () => {
  const across = { from: { x: 200, y: 100 }, to: { x: 400, y: 200 } }; // straddles the red | blue seam

  test("asks for a colour; cancelling extracts nothing at all", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, splitPage());
    await pickTool(page, "영역 추출");
    await dragImageRect(page, across.from, across.to);

    await expect(page.getByRole("dialog", { name: "배경색을 골라주세요" })).toBeVisible();
    expect(await editor(page)).toMatchObject({ pending: true, past: 0, layers: [], patches: [] });

    await page.getByRole("dialog").getByRole("button", { name: /취소/ }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await editor(page)).toMatchObject({ pending: false, past: 0, layers: [], patches: [] });
  });

  test("choosing a colour extracts, and the patch uses exactly that colour", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, splitPage());
    await pickTool(page, "영역 추출");
    await dragImageRect(page, across.from, across.to);
    await page.getByTestId("fill-color").fill("#00ff00");
    await page.getByRole("button", { name: "이 색으로 추출" }).click();

    const s = await editor(page);
    expect(s.layers).toHaveLength(1);
    expect(s.layers[0].crop).toEqual({ x: 200, y: 100, width: 200, height: 100 });
    expect(s.patches[0].fill).toBe("#00ff00");
    expect(s.past).toBe(1);
    const spot = await clientOf(page, 300, 150);
    // the layer sits on top of its own spot, so move it away and look at what was left behind
    await pickTool(page, "선택");
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down();
    await page.mouse.move(spot.x, spot.y + 150, { steps: 8 });
    await page.mouse.up();
    const left = await konvaPixel(page, spot.x, spot.y);
    expect(left.rgba.slice(0, 3)).toEqual([0, 255, 0]);
  });
});

test("an extraction smaller than a pixel (a click) does nothing", async ({ page }) => {
  await openApp(page);
  await uploadPng(page, pageWithCard());
  await pickTool(page, "영역 추출");
  const p = await clientOf(page, 500, 500);
  await page.mouse.click(p.x, p.y);
  expect(await editor(page)).toMatchObject({ layers: [], past: 0, pending: false });
});

test("no console errors during a normal session", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await openApp(page);
  await uploadPng(page, pageWithCard());
  await pickTool(page, "영역 추출");
  await dragImageRect(page, cardRect.from, cardRect.to);
  await exportPng(page);
  expect(errors).toEqual([]);
});

