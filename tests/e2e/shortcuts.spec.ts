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
    expect((await editor(page)).layers).toHaveLength(1); // copying changes nothing
    await page.keyboard.press("Control+v");
    await page.keyboard.press("Control+v");
    const s = await editor(page);
    expect(s.layers.map((l) => l.transform.x).sort((a, b) => a - b)).toEqual([CARD.x, CARD.x + 16, CARD.x + 32]);
    expect(s.selected).toEqual([s.layers.find((l) => l.transform.x === CARD.x + 32)!.id]);
    expect(await panelNames(page)).toHaveLength(3);
  });

  test("copying a layer leaves the system clipboard exactly as it was: text stays text", async ({ page }) => {
    await withLayer(page);
    await page.evaluate(() => navigator.clipboard.writeText("keep me"));
    await page.keyboard.press("Control+c");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("keep me");
  });

  test("copying a layer leaves a picture on the system clipboard where it was", async ({ page }) => {
    await withLayer(page);
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })]);
    }, encodePng(blank(100, 100, [1, 2, 3, 255])).toString("base64"));
    await page.keyboard.press("Control+c");
    const still = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      return items.flatMap((i) => i.types);
    });
    expect(still).toContain("image/png");
  });

  test("pasting a layer does not touch the system clipboard either", async ({ page }) => {
    await withLayer(page);
    await page.evaluate(() => navigator.clipboard.writeText("keep me"));
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    expect((await editor(page)).layers).toHaveLength(2); // pasted as a layer, though the system clipboard holds only text
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("keep me");
  });

  test("after leaving the window the layer copy is forgotten, and Ctrl+V reads the system clipboard again", async ({ page }) => {
    await withLayer(page);
    await page.keyboard.press("Control+c");
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })]); // something else was copied meanwhile
      window.dispatchEvent(new Event("blur")); // the window was left
    }, encodePng(blank(100, 100, [1, 2, 3, 255])).toString("base64"));
    await page.keyboard.press("Control+v");
    await expect(page.getByRole("alertdialog")).toBeVisible(); // the picture is what got pasted (it asks before replacing)
    expect((await editor(page)).layers).toHaveLength(1);
  });

  test("a picture copied earlier does not win over the layer copied after it", async ({ page }) => {
    await withLayer(page);
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })]);
    }, encodePng(blank(100, 100, [1, 2, 3, 255])).toString("base64"));
    await page.keyboard.press("Control+c"); // copies the selected layer inside the app; the picture stays on the system clipboard
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
