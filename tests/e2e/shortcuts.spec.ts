import { Page, expect, test } from "@playwright/test";
import { CARD, CARD2, PAGE, blank, clientOf, dragImageRect, dragLayerBy, editor, encodePng, openApp, pageWithCard, pageWithTwoCards, panelNames, pickTool, uploadPng, zoomTo } from "./helpers";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const cardCenter = { x: CARD.x + CARD.width / 2, y: CARD.y + CARD.height / 2 };
const tool = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** a layer for the card, selected, with the page focused on something that is not a text control */
async function withLayer(page: Page, two = false) {
  await openApp(page);
  await uploadPng(page, two ? pageWithTwoCards() : pageWithCard());
  await zoomTo(page, 1, 600, 300);
  await pickTool(page, "영역 추출");
  await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
  if (two) {
    await pickTool(page, "영역 추출");
    await dragImageRect(page, { x: CARD2.x, y: CARD2.y }, { x: CARD2.x + CARD2.width, y: CARD2.y + CARD2.height });
  }
  await pickTool(page, "선택");
}

test.describe("undo and redo keys", () => {
  test("Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y walk the history", async ({ page }) => {
    await withLayer(page);
    await dragLayerBy(page, cardCenter, 60, 40);
    expect((await editor(page)).past).toBe(2);

    await page.keyboard.press("Control+z");
    expect((await editor(page)).layers[0].transform).toMatchObject({ x: CARD.x, y: CARD.y });
    await page.keyboard.press("Control+z");
    expect(await editor(page)).toMatchObject({ layers: [], patches: [], past: 0 });

    await page.keyboard.press("Control+Shift+Z");
    expect((await editor(page)).layers).toHaveLength(1);
    await page.keyboard.press("Control+y");
    expect((await editor(page)).layers[0].transform).toMatchObject({ x: CARD.x + 60, y: CARD.y + 40 });
    expect((await editor(page)).past).toBe(2);
  });

  test("with nothing to undo the key does nothing", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    await page.keyboard.press("Control+z");
    expect(await editor(page)).toMatchObject({ past: 0 });
  });
});

test.describe("delete, duplicate", () => {
  test("Delete removes the selected layer, as one undoable step", async ({ page }) => {
    await withLayer(page);
    await page.keyboard.press("Delete");
    expect(await editor(page)).toMatchObject({ layers: [], past: 2 });
    await page.keyboard.press("Control+z");
    expect((await editor(page)).layers).toHaveLength(1);
  });

  test("Delete with nothing selected does nothing", async ({ page }) => {
    await withLayer(page);
    const off = await clientOf(page, 850, 520);
    await page.mouse.click(off.x, off.y);
    await page.keyboard.press("Delete");
    expect((await editor(page)).layers).toHaveLength(1);
  });

  test("Ctrl+D duplicates 16px right and down, and the browser's own Ctrl+D does not run", async ({ page }) => {
    await withLayer(page);
    await page.evaluate(() => {
      (window as any).__seen = null;
      // the Control key press fires its own keydown first; only the D one matters
      window.addEventListener("keydown", (e) => e.key === "d" && queueMicrotask(() => ((window as any).__seen = e.defaultPrevented)));
    });
    await page.keyboard.press("Control+d");
    expect(await page.evaluate(() => (window as any).__seen)).toBe(true);
    const s = await editor(page);
    expect(s.layers).toHaveLength(2);
    expect(s.layers.find((l) => l.name === "레이어 1 복사")!.transform).toMatchObject({ x: CARD.x + 16, y: CARD.y + 16 });
  });
});

test.describe("copy and paste a layer (Ctrl+C / Ctrl+V)", () => {
  test("Ctrl+C then Ctrl+V pastes a layer 16px along; again pastes 32px along", async ({ page }) => {
    await withLayer(page);
    await page.keyboard.press("Control+c");
    await copied(page); // copying is asynchronous: the picture goes to the clipboard first
    expect((await editor(page)).layers).toHaveLength(1); // copying changes nothing
    await page.keyboard.press("Control+v");
    await expect.poll(async () => (await editor(page)).layers.length).toBe(2); // each paste is asynchronous too
    await page.keyboard.press("Control+v");
    await expect.poll(async () => (await editor(page)).layers.length).toBe(3);
    const s = await editor(page);
    expect(s.layers.map((l) => l.transform.x).sort((a, b) => a - b)).toEqual([CARD.x, CARD.x + 16, CARD.x + 32]);
    expect(s.selected).toEqual([s.layers.find((l) => l.transform.x === CARD.x + 32)!.id]);
    expect(await panelNames(page)).toHaveLength(3);
  });

  /** copying is asynchronous (encode, hash, clipboard write): wait until the app has remembered the copy */
  const copied = (page: Page) => expect.poll(() => page.evaluate(() => !!(window as any).__slc.getState().layerClipboard?.hash)).toBe(true);

  /** [width, height] of every picture on the real system clipboard */
  const clipboardPictures = (page: Page) =>
    page.evaluate(async () => {
      const out: number[][] = [];
      for (const item of await navigator.clipboard.read())
        for (const type of item.types)
          if (type === "image/png") {
            const bmp = await createImageBitmap(await item.getType(type));
            out.push([bmp.width, bmp.height]);
          }
      return out;
    });

  /** what another application copying a different picture looks like */
  const copyOtherPicture = (page: Page) =>
    page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })]);
    }, encodePng(blank(100, 100, [1, 2, 3, 255])).toString("base64"));

  test("working on the canvas leaves no stray text selected, so Ctrl+C always means the layer", async ({ page }) => {
    await withLayer(page, true); // several drags across the canvas and its controls
    await dragImageRect(page, { x: 100, y: 100 }, { x: 900, y: 650 }); // a long sweep over the canvas
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
  });

  test("Ctrl+C puts the layer's own picture on the system clipboard", async ({ page }) => {
    await withLayer(page);
    await page.keyboard.press("Control+c");
    await copied(page);
    expect(await clipboardPictures(page)).toEqual([[CARD.width, CARD.height]]); // the layer's bitmap, not the whole page
    expect((await editor(page)).layers).toHaveLength(1); // and copying changed nothing in the project
  });

  test("copy, leave the window and come back, paste: it is still the layer", async ({ page }) => {
    await withLayer(page);
    await page.keyboard.press("Control+c");
    await copied(page);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await page.keyboard.press("Control+v");
    await expect.poll(async () => (await editor(page)).layers.length).toBe(2);
    expect((await editor(page)).layers.map((l) => l.transform.x).sort((a, b) => a - b)).toEqual([CARD.x, CARD.x + 16]);
    await expect(page.getByRole("alertdialog")).toHaveCount(0); // not taken for a new image
    await expect(page.getByTestId("screen-label")).toContainText(`${PAGE.width} × ${PAGE.height}`);
  });

  test("a picture copied somewhere else after the layer is pasted as a new image, not as the layer", async ({ page }) => {
    await withLayer(page);
    await page.keyboard.press("Control+c");
    await copied(page);
    await copyOtherPicture(page);
    await page.keyboard.press("Control+v");
    await expect(page.getByRole("alertdialog")).toBeVisible(); // a new image: it asks before replacing the unsaved work
    expect((await editor(page)).layers).toHaveLength(1);
  });

  test("text copied somewhere else after the layer: nothing is pasted, although the layer is still remembered", async ({ page }) => {
    await withLayer(page);
    await page.keyboard.press("Control+c");
    await copied(page);
    await page.evaluate(() => navigator.clipboard.writeText("something else"));
    await page.keyboard.press("Control+v");
    await page.waitForTimeout(400);
    expect((await editor(page)).layers).toHaveLength(1);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(await page.evaluate(() => !!(window as any).__slc.getState().layerClipboard)).toBe(true);
  });

  test("copying a different layer replaces the earlier copy", async ({ page }) => {
    await withLayer(page, true);
    await page.getByTestId("layer-item").filter({ hasText: "레이어 1" }).click();
    await page.keyboard.press("Control+c");
    await copied(page);
    await page.getByTestId("layer-item").filter({ hasText: "레이어 2" }).click();
    await page.keyboard.press("Control+c");
    await expect.poll(() => page.evaluate(() => (window as any).__slc.getState().layerClipboard?.layer.name)).toBe("레이어 2");
    await page.keyboard.press("Control+v");
    await expect.poll(async () => (await editor(page)).layers.length).toBe(3);
    expect((await editor(page)).layers.find((l) => l.name === "레이어 2 복사")).toBeDefined();
  });

  test("the system clipboard is the same one other applications use: what the app copied is on it for them", async ({ page }) => {
    await withLayer(page);
    await page.keyboard.press("Control+c");
    await copied(page);
    const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((i) => i.types));
    expect(types).toContain("image/png");
  });

  test("a picture on the clipboard from before is replaced by the layer copied after it", async ({ page }) => {
    await withLayer(page);
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })]);
    }, encodePng(blank(100, 100, [1, 2, 3, 255])).toString("base64"));
    await page.keyboard.press("Control+c"); // the layer's picture replaces the one on the system clipboard
    await expect.poll(() => page.evaluate(() => !!(window as any).__slc.getState().layerClipboard?.hash)).toBe(true);
    await page.keyboard.press("Control+v");
    expect((await editor(page)).layers).toHaveLength(2); // a layer was pasted...
    await expect(page.getByTestId("screen-label")).toContainText(`${PAGE.width} × ${PAGE.height}`); // ...and the picture did not replace the project
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });

  test("with a picture on the clipboard and no layer copied, Ctrl+V loads the picture, not a layer", async ({ page }) => {
    await withLayer(page);
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })]);
    }, encodePng(blank(100, 100, [1, 2, 3, 255])).toString("base64"));
    await page.keyboard.press("Control+v");
    await expect(page.getByRole("alertdialog")).toBeVisible(); // unsaved edits: asks before replacing
    expect((await editor(page)).layers).toHaveLength(1);
  });

  test("Ctrl+V with nothing copied does nothing", async ({ page }) => {
    await withLayer(page);
    await page.keyboard.press("Control+v");
    expect((await editor(page)).layers).toHaveLength(1);
  });
});

test.describe("tool keys", () => {
  test("V, H and R switch tools", async ({ page }) => {
    await withLayer(page);
    await page.keyboard.press("h");
    await expect(tool(page, "이동")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("r");
    await expect(tool(page, "영역 추출")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("v");
    await expect(tool(page, "선택")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("H"); // upper case (Caps Lock) too
    await expect(tool(page, "이동")).toHaveAttribute("aria-pressed", "true");
  });

  test("R then a drag extracts, with no click on the tool rail", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    await zoomTo(page, 1, 600, 300);
    await page.keyboard.press("r");
    await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
    expect((await editor(page)).layers).toHaveLength(1);
  });

  test("with no project the keys do nothing", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("r");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Delete");
    expect(await editor(page)).toMatchObject({ screen: null });
  });
});

test.describe("when the keys must stay out of the way", () => {
  test("while a text control has focus, no shortcut acts", async ({ page }) => {
    await withLayer(page);
    await pickTool(page, "배경 채움");
    const spot = await clientOf(page, CARD.x + 30, CARD.y + 60);
    await page.mouse.click(spot.x, spot.y); // selects the patch: its colour input appears
    const input = page.getByTestId("patch-color");
    await input.focus();
    await page.keyboard.press("h");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Delete");
    await expect(tool(page, "배경 채움")).toHaveAttribute("aria-pressed", "true"); // H did not switch the tool
    expect((await editor(page)).layers).toHaveLength(1); // Ctrl+Z did not undo the extraction
    expect((await editor(page)).past).toBe(1);

    await page.locator("body").click({ position: { x: 5, y: 5 } }); // focus leaves the input: keys work again
    await page.keyboard.press("h");
    await expect(tool(page, "이동")).toHaveAttribute("aria-pressed", "true");
  });

  test("a pasted picture is ignored while typing too (the paste handler stays out of text controls)", async ({ page }) => {
    await withLayer(page);
    await pickTool(page, "배경 채움");
    const spot = await clientOf(page, CARD.x + 30, CARD.y + 60);
    await page.mouse.click(spot.x, spot.y);
    await page.getByTestId("patch-color").focus();
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([1])], "x.png", { type: "image/png" }));
      document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(200);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.locator("aside").first().getByRole("alert")).toHaveCount(0);
  });

  test("while a dialog is open the editor behind it does not react", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    await zoomTo(page, 1, 600, 300);
    await page.getByRole("button", { name: "PNG 내보내기" }).click();
    await expect(page.getByRole("dialog", { name: "목업 내보내기" })).toBeVisible();
    await page.keyboard.press("r");
    await expect(tool(page, "영역 추출")).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.keyboard.press("r");
    await expect(tool(page, "영역 추출")).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("when the browser will not let the app copy", () => {
  /** each case breaks one thing the copy depends on, before the page's own scripts run */
  const cases: [string, string, RegExp][] = [
    ["the browser refuses the write (no permission)", `navigator.clipboard.write = () => Promise.reject(new DOMException("denied", "NotAllowedError"));`, /허용/],
    ["there is no clipboard API (an insecure page)", `Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });`, /보안 연결/],
    ["the browser cannot put a picture on the clipboard", `window.ClipboardItem = undefined;`, /지원하지 않습니다/],
    ["the write fails for some other reason", `navigator.clipboard.write = () => Promise.reject(new Error("disk full"));`, /disk full/],
  ];

  for (const [name, breakIt, reason] of cases) {
    test(`${name}: the user is told why, and nothing is pretended`, async ({ page }) => {
      await page.addInitScript(breakIt);
      await withLayer(page);
      await page.keyboard.press("Control+c");
      const notice = page.getByTestId("notice");
      await expect(notice).toBeVisible();
      await expect(notice).toContainText(reason);
      await expect(notice).toContainText("복사"); // it says what failed, not just why
      // no copy is remembered, so a paste has nothing to match and does nothing
      expect(await page.evaluate(() => (window as any).__slc.getState().layerClipboard)).toBeNull();
      await page.keyboard.press("Control+v");
      await page.waitForTimeout(300);
      expect((await editor(page)).layers).toHaveLength(1);
    });
  }

  test("the notice can be dismissed, and a copy that then works clears it", async ({ page }) => {
    await page.addInitScript(`window.__failCopy = true; const real = navigator.clipboard.write.bind(navigator.clipboard); navigator.clipboard.write = (items) => (window.__failCopy ? Promise.reject(new DOMException("denied", "NotAllowedError")) : real(items));`);
    await withLayer(page);
    await page.keyboard.press("Control+c");
    await expect(page.getByTestId("notice")).toBeVisible();
    await page.getByTestId("notice").getByRole("button", { name: "닫기" }).click();
    await expect(page.getByTestId("notice")).toHaveCount(0);

    await page.keyboard.press("Control+c");
    await expect(page.getByTestId("notice")).toBeVisible(); // fails again, tells again
    await page.evaluate(() => ((window as any).__failCopy = false));
    await page.keyboard.press("Control+c");
    await expect(page.getByTestId("notice")).toHaveCount(0); // success clears the old complaint
    await expect.poll(() => page.evaluate(() => !!(window as any).__slc.getState().layerClipboard?.hash)).toBe(true);
  });

  test("a failed copy after a good one forgets the good one: the clipboard no longer holds it", async ({ page }) => {
    await page.addInitScript(`window.__failCopy = false; const real = navigator.clipboard.write.bind(navigator.clipboard); navigator.clipboard.write = (items) => (window.__failCopy ? Promise.reject(new DOMException("denied", "NotAllowedError")) : real(items));`);
    await withLayer(page);
    await page.keyboard.press("Control+c");
    await expect.poll(() => page.evaluate(() => !!(window as any).__slc.getState().layerClipboard?.hash)).toBe(true);
    await page.evaluate(() => ((window as any).__failCopy = true));
    await page.keyboard.press("Control+c");
    await expect(page.getByTestId("notice")).toBeVisible();
    expect(await page.evaluate(() => (window as any).__slc.getState().layerClipboard)).toBeNull();
  });

  test("the notice is a strip above the work area: it covers neither the canvas nor the panels", async ({ page }) => {
    await page.addInitScript(`navigator.clipboard.write = () => Promise.reject(new DOMException("denied", "NotAllowedError"));`);
    await withLayer(page);
    await page.keyboard.press("Control+c");
    const notice = (await page.getByTestId("notice").boundingBox())!;
    const viewport = (await page.getByTestId("viewport").boundingBox())!;
    const header = (await page.getByRole("banner").boundingBox())!;
    expect(notice.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
    expect(notice.y + notice.height).toBeLessThanOrEqual(viewport.y + 1);
  });
});

test.describe("the shell keeps its layout", () => {
  /** header 54px on top, footer 28px at the bottom, the work area takes everything between (minus any notice strip) */
  async function expectShellFillsWindow(page: Page) {
    const win = page.viewportSize()!;
    const header = (await page.getByRole("banner").boundingBox())!;
    const main = (await page.locator("main").boundingBox())!;
    const footer = (await page.locator("footer").boundingBox())!;
    const notices = await page.getByTestId("notices").boundingBox();
    expect(header).toMatchObject({ y: 0, height: 54 });
    expect(footer.height).toBe(28);
    expect(footer.y + footer.height).toBe(win.height);
    expect(main.y).toBeCloseTo(54 + (notices?.height ?? 0), 0);
    expect(main.y + main.height).toBeCloseTo(footer.y, 0); // nothing in between: no gap, no overlap
  }

  test("with no notice the work area is everything between the header and the footer", async ({ page }) => {
    await openApp(page);
    await expectShellFillsWindow(page);
    await uploadPng(page, pageWithCard());
    await expectShellFillsWindow(page);
    const vp = (await page.getByTestId("viewport").boundingBox())!;
    expect(vp.height).toBe(720 - 54 - 28);
  });

  test("with a notice showing, the strip sits between the header and the work area, which gives up exactly its height", async ({ page }) => {
    await page.addInitScript(`navigator.clipboard.write = () => Promise.reject(new DOMException("denied", "NotAllowedError"));`);
    await withLayer(page);
    await page.keyboard.press("Control+c");
    await expect(page.getByTestId("notice")).toBeVisible();
    await expectShellFillsWindow(page);
    await page.getByTestId("notice").getByRole("button", { name: "닫기" }).click();
    await expectShellFillsWindow(page); // and takes it back when dismissed
    expect((await page.getByTestId("viewport").boundingBox())!.height).toBe(720 - 54 - 28);
  });

  test("a second layer can be extracted at the first-run view (the canvas controls do not sit over the work)", async ({ page }) => {
    await withLayer(page, true);
    expect((await editor(page)).layers).toHaveLength(2);
  });
});
