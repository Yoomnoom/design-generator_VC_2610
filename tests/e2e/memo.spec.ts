import { Page, expect, test } from "@playwright/test";
import {
  PAGE, autosaveReady, blank, clientOf, editor, encodePng, exportPngBytes, openApp, openProjectFile, pageWithCard, pickTool, pngPixelAt, readPngSize, reloadAndDiscard, saveProjectFile, uploadPng, waitForAutosave, zoomTo,
} from "./helpers";

const AT = { x: 600, y: 450 };
const memos = (page: Page) => page.evaluate(() => ((window as any).__slc.getState().history?.present.screens[0].memos ?? []) as { id: string; x: number; y: number; text: string }[]);
const past = async (page: Page) => (await editor(page)).past;
const selectedMemo = (page: Page) => page.evaluate(() => (window as any).__slc.getState().selectedMemoId as string | null);

async function setupMemo(page: Page, zoom = 1) {
  await openApp(page);
  await uploadPng(page, pageWithCard());
  await zoomTo(page, zoom, AT.x, AT.y);
}

/** the memo tool: click a point of the picture */
async function pin(page: Page, at: { x: number; y: number }) {
  await pickTool(page, "메모");
  const c = await clientOf(page, at.x, at.y);
  await page.mouse.click(c.x, c.y);
}
const pinCentre = async (page: Page, index = 0) => {
  const b = (await page.getByTestId("memo-pin").nth(index).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
/** a memo with its words, left by Tab (the box is left, which commits), then the balloon is closed so it does not cover the next click */
async function memoWith(page: Page, at: { x: number; y: number }, words: string) {
  await pin(page, at);
  await expect(page.getByTestId("memo-text")).toBeFocused();
  await page.keyboard.type(words);
  await page.keyboard.press("Tab");
  await page.evaluate(() => (window as any).__slc.getState().selectMemo(null));
}

test.describe("the memo tool", () => {
  test("a click pins an empty memo on that pixel, selects it and opens its balloon, as one undo step; undo takes it away", async ({ page }) => {
    await setupMemo(page);
    const before = await past(page);
    await pin(page, AT);
    const [m] = await memos(page);
    expect(m).toMatchObject({ x: AT.x, y: AT.y, text: "" });
    expect(await past(page)).toBe(before + 1);
    expect(await selectedMemo(page)).toBe(m.id);
    await expect(page.getByTestId("memo-balloon")).toBeVisible();
    await expect(page.getByTestId("memo-text")).toBeFocused();
    await expect(page.getByTestId("memo-pin")).toHaveText("1");
    await expect(page.getByRole("button", { name: "선택", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("memo-text").press("Escape");
    await page.keyboard.press("Control+z");
    expect(await memos(page)).toHaveLength(0);
    await expect(page.getByTestId("memo-pin")).toHaveCount(0);
    await page.keyboard.press("Control+Shift+z");
    expect(await memos(page)).toHaveLength(1);
  });

  test("the words are one undo step, committed when the box is left; Esc takes typing back", async ({ page }) => {
    await setupMemo(page);
    await pin(page, AT);
    const afterAdd = await past(page);
    await page.keyboard.type("check this card\nand its shadow");
    expect((await memos(page))[0].text).toBe(""); // typing alone changes nothing
    await page.keyboard.press("Tab");
    expect((await memos(page))[0].text).toBe("check this card\nand its shadow");
    expect(await past(page)).toBe(afterAdd + 1);
    await expect(page.getByTestId("memo-pin")).toHaveAttribute("title", "check this card\nand its shadow");

    await page.getByTestId("memo-text").focus();
    await page.keyboard.type(" EXTRA");
    await page.keyboard.press("Escape");
    expect((await memos(page))[0].text).toBe("check this card\nand its shadow");
    await expect(page.getByTestId("memo-text")).toHaveValue("check this card\nand its shadow");
    expect(await past(page)).toBe(afterAdd + 1);

    await page.keyboard.press("Control+z");
    expect((await memos(page))[0].text).toBe("");
  });

  test("pins are numbered in the order they were made, also in the list", async ({ page }) => {
    await setupMemo(page);
    await memoWith(page, { x: AT.x - 100, y: AT.y }, "first");
    await memoWith(page, { x: AT.x + 100, y: AT.y }, "second");
    await memoWith(page, { x: AT.x, y: AT.y + 100 }, "");
    await expect(page.getByTestId("memo-pin")).toHaveText(["1", "2", "3"]);
    await expect(page.getByTestId("memo-count")).toHaveText("3");
    const items = await page.getByTestId("memo-item").allInnerTexts();
    expect(items.map((t) => t.replace(/\s+/g, " ").trim())).toEqual(["1 first", "2 second", "3 비어 있음"]);
  });

  test("a click on the list opens that memo's balloon; a click on empty canvas (select tool) closes it", async ({ page }) => {
    await setupMemo(page);
    await memoWith(page, { x: AT.x - 100, y: AT.y }, "first");
    await memoWith(page, { x: AT.x + 100, y: AT.y }, "second");
    await page.getByTestId("memo-item").first().click();
    expect(await selectedMemo(page)).toBe((await memos(page))[0].id);
    await expect(page.getByTestId("memo-text")).toHaveValue("first");
    await page.keyboard.press("Escape");
    const box = (await page.getByTestId("viewport").boundingBox())!;
    await page.mouse.click(box.x + 12, box.y + 12);
    expect(await selectedMemo(page)).toBeNull();
    await expect(page.getByTestId("memo-balloon")).toHaveCount(0);
    await expect(page.getByTestId("memo-pin")).toHaveCount(2);
  });
});

for (const zoom of [1, 2]) {
  test.describe(`at ${zoom * 100}%`, () => {
    test(`the pin is on its point of the picture, follows zoom and pan, and keeps its size`, async ({ page }) => {
      await setupMemo(page, zoom);
      await pin(page, AT);
      await page.keyboard.press("Escape");
      const want = await clientOf(page, AT.x, AT.y);
      const got = await pinCentre(page);
      expect(Math.abs(got.x - want.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(got.y - want.y)).toBeLessThanOrEqual(1);
      const size = (await page.getByTestId("memo-pin").boundingBox())!;
      expect(Math.round(size.width)).toBe(24);

      await page.evaluate(() => {
        const st = (window as any).__slc.getState();
        st.setView({ zoom: st.view.zoom * 1.5, panX: st.view.panX - 40, panY: st.view.panY + 25 });
      });
      const want2 = await clientOf(page, AT.x, AT.y);
      const got2 = await pinCentre(page);
      expect(Math.abs(got2.x - want2.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(got2.y - want2.y)).toBeLessThanOrEqual(1);
      expect(Math.round((await page.getByTestId("memo-pin").boundingBox())!.width)).toBe(24); // not scaled by the zoom
    });

    test(`dragging a pin moves it by image pixels (the screen distance over the zoom), as one undo step`, async ({ page }) => {
      await setupMemo(page, zoom);
      await pin(page, AT);
      await page.keyboard.press("Escape");
      const before = await past(page);
      const from = await pinCentre(page);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 40, from.y + 20, { steps: 5 });
      await page.mouse.move(from.x + 100, from.y + 60, { steps: 5 });
      expect((await memos(page))[0]).toMatchObject({ x: AT.x, y: AT.y }); // while dragging nothing is stored
      await page.mouse.up();
      const [m] = await memos(page);
      expect(m.x).toBeCloseTo(AT.x + 100 / zoom, 0);
      expect(m.y).toBeCloseTo(AT.y + 60 / zoom, 0);
      expect(await past(page)).toBe(before + 1);
      const want = await clientOf(page, m.x, m.y);
      const got = await pinCentre(page);
      expect(Math.abs(got.x - want.x)).toBeLessThanOrEqual(1);
      await page.keyboard.press("Control+z");
      expect((await memos(page))[0]).toMatchObject({ x: AT.x, y: AT.y });
    });
  });
}

test.describe("moving, clicking, deleting", () => {
  test("a click that barely moves is a click: it opens the balloon and changes nothing", async ({ page }) => {
    await setupMemo(page);
    await pin(page, AT);
    await page.keyboard.press("Escape");
    await page.getByTestId("memo-item").first().click(); // keep the memo selected, balloon open
    await page.keyboard.press("Escape");
    const before = await past(page);
    const c = await pinCentre(page);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 1, c.y + 1);
    await page.mouse.up();
    expect(await past(page)).toBe(before);
    expect((await memos(page))[0]).toMatchObject({ x: AT.x, y: AT.y });
    await expect(page.getByTestId("memo-balloon")).toBeVisible();
  });

  test("a pin dragged out of the picture stops at its edge", async ({ page }) => {
    await setupMemo(page);
    await zoomTo(page, 1, 200, 150);
    await pin(page, { x: 20, y: 20 });
    await page.keyboard.press("Escape");
    const c = await pinCentre(page);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x - 200, c.y - 200, { steps: 6 });
    await page.mouse.up();
    expect((await memos(page))[0]).toMatchObject({ x: 0, y: 0 });
  });

  test("the Delete button removes the memo as one step; undo brings it back with its words and place", async ({ page }) => {
    await setupMemo(page);
    await memoWith(page, AT, "remove me");
    await page.getByTestId("memo-pin").click();
    const before = await past(page);
    await page.getByTestId("memo-delete").click();
    expect(await memos(page)).toHaveLength(0);
    expect(await past(page)).toBe(before + 1);
    expect(await selectedMemo(page)).toBeNull();
    await expect(page.getByTestId("memo-balloon")).toHaveCount(0);
    await page.keyboard.press("Control+z");
    expect(await memos(page)).toMatchObject([{ x: AT.x, y: AT.y, text: "remove me" }]);
  });

  test("the Delete key removes the selected memo (when no layer is selected and no box has the focus)", async ({ page }) => {
    await setupMemo(page);
    await memoWith(page, AT, "gone by key");
    await page.getByTestId("memo-item").first().click(); // selected again, its balloon open
    await page.getByTestId("memo-text").focus();
    await page.keyboard.press("Delete"); // inside the box this is a text key
    expect(await memos(page)).toHaveLength(1);
    await page.keyboard.press("Escape");
    await page.getByTestId("memo-text").blur();
    await page.keyboard.press("Delete");
    expect(await memos(page)).toHaveLength(0);
  });

  test("undo and redo walk the memo edits in order: add, words, move, delete", async ({ page }) => {
    await setupMemo(page);
    await memoWith(page, AT, "walk");
    const c = await pinCentre(page);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 60, c.y, { steps: 5 });
    await page.mouse.up();
    await page.getByTestId("memo-delete").click();
    const states: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      states.push(JSON.stringify(await memos(page)));
      await page.keyboard.press("Control+z");
    }
    expect(JSON.stringify(await memos(page))).toBe("[]");
    for (let i = 0; i < 4; i++) await page.keyboard.press("Control+Shift+z");
    expect(JSON.stringify(await memos(page))).toBe("[]"); // all the way forward: deleted again
    expect(states[0]).toBe("[]");
    expect(JSON.parse(states[1] as string)[0].x).toBeGreaterThan(AT.x + 50);
  });
});

test.describe("compare view, layers, and the other tools", () => {
  test("while comparing, no pins are drawn, the memo tool pins nothing, and the memo list cannot be used", async ({ page }) => {
    await setupMemo(page);
    await memoWith(page, AT, "kept");
    await page.evaluate(() => (window as any).__slc.getState().setCompareMode("split"));
    await expect(page.getByTestId("memo-pin")).toHaveCount(0);
    await expect(page.getByTestId("memo-item").first()).toBeDisabled();
    await pickTool(page, "메모");
    const c = await clientOf(page, AT.x + 80, AT.y + 80);
    await page.mouse.click(c.x, c.y);
    await page.waitForTimeout(150);
    expect(await memos(page)).toHaveLength(1);
    await page.evaluate(() => (window as any).__slc.getState().setCompareMode("off"));
    await expect(page.getByTestId("memo-pin")).toHaveCount(1);
  });

  test("locking or hiding a layer does not stop memos (memos are not layers)", async ({ page }) => {
    await setupMemo(page);
    await pickTool(page, "영역 추출");
    const a = await clientOf(page, 300, 200);
    const b = await clientOf(page, 540, 320);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await page.getByRole("button", { name: /잠그기$/ }).click();
    await page.getByRole("button", { name: /숨기기$/ }).click();
    await memoWith(page, AT, "layer is locked and hidden");
    expect(await memos(page)).toHaveLength(1);
    expect((await editor(page)).layers).toHaveLength(1);
  });

  test("typing in a balloon does not trigger tool or layer shortcuts", async ({ page }) => {
    await setupMemo(page);
    await pin(page, AT);
    await page.keyboard.type("vbrmloeitn");
    expect(await page.evaluate(() => (window as any).__slc.getState().activeTool)).toBe("select");
    await page.keyboard.press("Tab");
    expect((await memos(page))[0].text).toBe("vbrmloeitn");
  });

  test("N is the memo tool's key", async ({ page }) => {
    await setupMemo(page);
    await page.keyboard.press("n");
    expect(await page.evaluate(() => (window as any).__slc.getState().activeTool)).toBe("memo");
  });
});

test.describe("export: memos are not in the PNG unless asked", () => {
  const pinFill = [229, 50, 45, 255]; // #e5322d
  const balloonFill = [255, 251, 230, 255]; // #fffbe6
  const near = (a: number[], b: number[]) => Math.max(...a.slice(0, 3).map((v, i) => Math.abs(v - b[i]))) <= 6;

  async function exportWith(page: Page, withMemos: boolean) {
    await page.getByRole("button", { name: "PNG 내보내기" }).click();
    const box = page.getByTestId("export-memos");
    if (withMemos) await box.check();
    const download = page.waitForEvent("download");
    await page.getByTestId("export-save").click();
    const bytes = (await import("node:fs")).readFileSync(await (await download).path());
    await page.getByRole("button", { name: "닫기" }).click();
    return bytes;
  }

  test("the choice is in the dialog, off by default, and off when there are no memos", async ({ page }) => {
    await setupMemo(page);
    await page.getByRole("button", { name: "PNG 내보내기" }).click();
    await expect(page.getByTestId("export-memos")).toBeDisabled();
    await expect(page.getByTestId("export-memos-note")).toHaveText("메모가 없습니다.");
    await page.getByRole("button", { name: "닫기" }).click();
    await memoWith(page, AT, "note");
    await page.getByRole("button", { name: "PNG 내보내기" }).click();
    await expect(page.getByTestId("export-memos")).toBeEnabled();
    await expect(page.getByTestId("export-memos")).not.toBeChecked();
    await expect(page.getByTestId("export-memos-note")).toContainText("들어가지 않습니다");
    await page.getByTestId("export-memos").check();
    await expect(page.getByTestId("export-memos-note")).toContainText("그려집니다");
  });

  test("off: the PNG is byte for byte the PNG of the same screen with no memos; on: the pin and the balloon are in it, and the size is unchanged", async ({ page }) => {
    await setupMemo(page);
    const plain = await exportPngBytes(page);
    await memoWith(page, AT, "balloon words here");
    const off = await exportWith(page, false);
    expect(off.equals(plain)).toBe(true);
    expect(await pngPixelAt(page, off, AT.x + 8, AT.y)).toEqual([240, 240, 240, 255]);

    const on = await exportWith(page, true);
    expect(on.equals(plain)).toBe(false);
    expect(readPngSize(on)).toMatchObject({ width: PAGE.width, height: PAGE.height });
    expect(near(await pngPixelAt(page, on, AT.x + 8, AT.y), pinFill)).toBe(true); // inside the pin, beside its number
    expect(near(await pngPixelAt(page, on, AT.x + 18 + 3, AT.y - 12 + 3), balloonFill)).toBe(true); // the balloon's corner
    expect(await pngPixelAt(page, on, 10, 10)).toEqual([240, 240, 240, 255]); // far from any memo nothing changed
  });

  test("the pin keeps the PNG's transparency elsewhere: a transparent capture stays transparent around the memo", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("file-input").setInputFiles({ name: "clear.png", mimeType: "image/png", buffer: encodePng(blank(600, 400, [0, 0, 0, 0])) });
    await expect(page.getByTestId("screen-label")).toContainText("600 × 400");
    await page.evaluate(() => {
      const st = (window as any).__slc.getState();
      st.addMemo(300, 200);
    });
    const on = await exportWith(page, true);
    expect((await pngPixelAt(page, on, 20, 20))[3]).toBe(0);
    expect(near(await pngPixelAt(page, on, 308, 200), pinFill)).toBe(true);
  });

  test("a memo near the corner of the picture is drawn whole inside the picture", async ({ page }) => {
    await setupMemo(page);
    await page.evaluate(([w, h]) => {
      const st = (window as any).__slc.getState();
      const id = st.addMemo(w - 2, h - 2);
      st.setMemoText(id, "pushed back inside the picture, never cut off");
    }, [PAGE.width, PAGE.height]);
    const on = await exportWith(page, true);
    expect(readPngSize(on)).toMatchObject({ width: PAGE.width, height: PAGE.height });
    expect(near(await pngPixelAt(page, on, PAGE.width - 2 - 8, PAGE.height - 2), pinFill)).toBe(true);
  });
});

test.describe("saved, restored, and old files", () => {
  test("memos (place, words, order) survive a project save and open, and the automatic save", async ({ page }) => {
    await setupMemo(page);
    await memoWith(page, { x: AT.x - 90, y: AT.y }, "first 한글");
    await memoWith(page, { x: AT.x + 90, y: AT.y + 40 }, "second\nline");
    const saved = await memos(page);
    expect(saved).toHaveLength(2);
    await autosaveReady(page);
    await waitForAutosave(page);
    const text = await saveProjectFile(page);
    expect(JSON.parse(text).project.version).toBe(6);
    expect(JSON.parse(text).project.screens[0].memos).toEqual(saved);

    await reloadAndDiscard(page);
    await openProjectFile(page, text);
    await expect.poll(async () => (await memos(page)).length).toBe(2);
    expect(await memos(page)).toEqual(saved);
    await expect(page.getByTestId("memo-pin")).toHaveText(["1", "2"]);

    await waitForAutosave(page);
    await page.reload();
    await expect(page.getByTestId("restore-dialog")).toBeVisible();
    await page.getByRole("button", { name: "복원", exact: true }).click();
    await expect.poll(async () => (await memos(page)).length).toBe(2);
    expect(await memos(page)).toEqual(saved);
  });

  test("a version 5 project (saved before memos existed) opens with no memos, and a memo can be added and saved", async ({ page }) => {
    const fs = await import("node:fs");
    await openApp(page);
    await openProjectFile(page, fs.readFileSync("tests/fixtures/project-v5.slc.json", "utf8"));
    await expect.poll(async () => (await editor(page)).layers.length).toBe(4);
    expect(await memos(page)).toEqual([]);
    await zoomTo(page, 1, AT.x, AT.y);
    await memoWith(page, AT, "added to an old file");
    const file = JSON.parse(await saveProjectFile(page));
    expect(file.project.version).toBe(6);
    expect(file.project.screens[0].memos).toHaveLength(1);
    expect(file.project.screens[0].layers).toHaveLength(4);
  });
});

for (const [w, h] of [[4000, 3000], [8000, 6000]] as const) {
  test(`memos on a ${w} × ${h} capture: a hundred pins, and exporting with them (measurement)`, async ({ page }) => {
    test.setTimeout(240_000);
    await openApp(page);
    await page.getByTestId("file-input").setInputFiles({ name: "big.png", mimeType: "image/png", buffer: encodePng(blank(w, h, [240, 240, 240, 255])) });
    await expect(page.getByTestId("screen-label")).toContainText(`${w} × ${h}`, { timeout: 120_000 });
    const t = await page.evaluate(([W, H]) => {
      const st = (window as any).__slc.getState();
      const t0 = performance.now();
      for (let i = 0; i < 100; i++) {
        const id = (window as any).__slc.getState().addMemo(100 + (i % 10) * (W / 11), 100 + Math.floor(i / 10) * (H / 11));
        (window as any).__slc.getState().setMemoText(id, `Memo ${i + 1}: 한글 and English, long enough to wrap in the balloon`);
      }
      return { add: performance.now() - t0, undo: (() => { const t1 = performance.now(); (window as any).__slc.getState().undo(); return performance.now() - t1; })(), W, H, st: !!st };
    }, [w, h]);
    await page.evaluate(() => (window as any).__slc.getState().redo());
    expect(await memos(page)).toHaveLength(100);
    const t0 = Date.now();
    const plainStart = Date.now();
    const off = await exportPngBytes(page);
    const offMs = Date.now() - plainStart;
    await page.getByRole("button", { name: "PNG 내보내기" }).click();
    await page.getByTestId("export-memos").check();
    const download = page.waitForEvent("download");
    const onStart = Date.now();
    await page.getByTestId("export-save").click();
    const on = (await import("node:fs")).readFileSync(await (await download).path());
    const onMs = Date.now() - onStart;
    await page.getByRole("button", { name: "닫기" }).click();
    expect(readPngSize(on)).toMatchObject({ width: w, height: h });
    expect(on.equals(off)).toBe(false);
    void t0;
    console.log(`MEASURE memos on ${w}x${h}: 100 memos (add + words) ${t.add.toFixed(0)} ms, one undo ${t.undo.toFixed(1)} ms; PNG export without memos ${offMs} ms, with 100 memos ${onMs} ms`);
  });
}

for (const dpr of [2]) {
  test.describe(`devicePixelRatio ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });
    test("at 200% zoom the pin is on its point and a drag still moves it by image pixels", async ({ page }) => {
      await setupMemo(page, 2);
      await pin(page, AT);
      await page.keyboard.press("Escape");
      const want = await clientOf(page, AT.x, AT.y);
      const got = await pinCentre(page);
      expect(Math.abs(got.x - want.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(got.y - want.y)).toBeLessThanOrEqual(1);
      await page.mouse.move(got.x, got.y);
      await page.mouse.down();
      await page.mouse.move(got.x + 80, got.y + 40, { steps: 6 });
      await page.mouse.up();
      const [m] = await memos(page);
      expect(m.x).toBeCloseTo(AT.x + 40, 0);
      expect(m.y).toBeCloseTo(AT.y + 20, 0);
    });
  });
}
