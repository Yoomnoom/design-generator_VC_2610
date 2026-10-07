import { BrowserContext, Page, expect, test } from "@playwright/test";
import { CARD, CARD2, PAGE, autosaveReady, autosaveStatus, blank, dragImageRect, dragLayerBy, editor, encodePng, exportPngBytes, idbDo, idbKeys, idbRecord, openApp, openProjectFile, pageWithCard, pageWithTwoCards, panelNames, pickTool, saveProjectFile, savedAtOf, uploadPng, waitForAutosave, zoomTo } from "./helpers";

const snapshot = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as any).__slc.getState().snapshotProject())));

/** the whole flow in one project: two layers (one moved and turned, one renamed, hidden and locked), reordered, a patch recoloured, zoomed */
async function richProject(page: Page) {
  await openApp(page);
  await uploadPng(page, pageWithTwoCards(), "rich.png");
  await zoomTo(page, 1, 600, 300);
  await pickTool(page, "영역 추출");
  await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
  await pickTool(page, "영역 추출");
  await dragImageRect(page, { x: CARD2.x, y: CARD2.y }, { x: CARD2.x + CARD2.width, y: CARD2.y + CARD2.height });
  await pickTool(page, "선택");
  await zoomTo(page, 1.5, 500, 280); // the view that should come back
  // the rest through the store: they are the same actions the buttons run
  await page.evaluate(() => {
    const st = (window as any).__slc.getState();
    const [blue, green] = st.history.present.screens[0].layers.map((l: any) => l.id);
    st.previewLayerDrag(blue, 330, 240);
    st.commitLayerDrag();
    st.transformLayer(blue, { x: 330, y: 240, scaleX: 1.5, scaleY: 1.25, rotation: 20 });
    st.reorderLayer(green, -1);
    st.setPatchColor(st.history.present.screens[0].backgroundPatches[0].id, "#336699");
    st.renameLayer(green, "Green card");
    st.setLayerVisible(green, false);
    st.setLayerLocked(green, true); // the last edit
  });
  await savedLatest(page); // the project is now fully saved: whatever a test does next starts from that
}
/** the "discard your current work?" banner only appears when there are unsaved edits: answer it if it is there */
const confirmReplace = async (p: Page) => {
  await p.waitForTimeout(400);
  const button = p.getByRole("button", { name: "새로 불러오기" });
  if (await button.isVisible()) await button.click();
};
/** Waits until the stored copy IS the current project. "A save has happened" is not enough: under load an earlier, half-finished
 *  state can be saved first, and the test would then be looking at the wrong copy. */
const savedLatest = async (page: Page) => {
  await expect
    .poll(
      async () => {
        const rec = (await idbRecord(page)) as { project?: unknown } | undefined;
        return !!rec && JSON.stringify(rec.project) === JSON.stringify(await snapshot(page));
      },
      { timeout: 20000, message: "the temporary copy to catch up with the project" },
    )
    .toBe(true);
  await expect(autosaveStatus(page)).toHaveAttribute("data-saving", "no");
};
const savedAfterEdit = async (page: Page) => {
  await waitForAutosave(page);
  return savedAtOf(page);
};

test.describe("saving as you go", () => {
  test("nothing is saved, and nothing is offered, in a fresh browser", async ({ page }) => {
    await openApp(page);
    await autosaveReady(page);
    expect(await autosaveStatus(page).getAttribute("data-ownership")).toBe("owner");
    expect(await autosaveStatus(page).getAttribute("data-candidate")).toBe("no");
    await expect(page.getByTestId("restore-dialog")).toHaveCount(0);
    await expect(autosaveStatus(page)).toHaveText("");
    expect(await idbRecord(page)).toBeUndefined();
  });

  test("a moment after an edit the footer says so, with the time; the stored copy holds the project and the images", async ({ page }) => {
    await richProject(page);
    await waitForAutosave(page);
    await expect(autosaveStatus(page)).toContainText(/자동 저장됨 \d{1,2}시 \d{1,2}분 \d{1,2}초/); // the time, in Korean
    const rec = (await idbRecord(page)) as { format: string; version: number; savedAt: number; project: { screens: { layers: unknown[] }[] } };
    expect(rec).toMatchObject({ format: "screenshot-layer-canvas-autosave", version: 1 });
    expect(rec.project.screens[0].layers).toHaveLength(2);
    const text = JSON.stringify(rec);
    expect(text).not.toMatch(/blob:|data:|base64/i); // no Blob URL, no embedded image data
    const referenced = await page.evaluate(() => {
      const p = (window as any).__slc.getState().snapshotProject();
      const s = p.screens[0];
      return [s.source.imageId, ...s.layers.map((l: any) => l.imageId)];
    });
    expect((await idbKeys(page)).sort()).toEqual([...new Set(referenced)].sort()); // the images are Blobs in the blob store
  });

  test("it follows later edits", async ({ page }) => {
    await richProject(page);
    const first = await savedAfterEdit(page);
    await page.getByTestId("layer-item").first().click();
    await page.getByRole("button", { name: "복제" }).click();
    await waitForAutosave(page, first);
    expect(((await idbRecord(page)) as { project: { screens: { layers: unknown[] }[] } }).project.screens[0].layers).toHaveLength(3);
  });
});

test.describe("a save that fails", () => {
  test("is shown, with the reason, in the footer and in a warning strip; it is not swallowed", async ({ page }) => {
    await page.addInitScript(`
      const realPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === "autosave") throw new DOMException("the disk is full", "QuotaExceededError");
        return realPut.apply(this, args);
      };
    `);
    await openApp(page);
    await uploadPng(page, pageWithCard());
    await expect(page.getByTestId("autosave-error")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("autosave-error")).toContainText("자동 저장에 실패했습니다");
    await expect(page.getByTestId("autosave-error")).toContainText("the disk is full");
    await expect(page.getByTestId("autosave-error")).toContainText("프로젝트 저장"); // and tells what to do instead
    await expect(autosaveStatus(page)).toContainText("자동 저장 실패");
    expect(await idbRecord(page)).toBeUndefined(); // and nothing half-written was left as if it were a save
  });
});

test.describe("restoring", () => {
  test("edit, reload, restore: positions, order, patches, lock, hide, names, size, rotation and view come back; the PNG is identical", async ({ page }) => {
    await richProject(page);
    await waitForAutosave(page);
    const before = await snapshot(page);
    const pngBefore = await exportPngBytes(page);
    const namesBefore = await panelNames(page);
    expect(namesBefore).toEqual(["레이어 1", "Green card"].reverse().reverse()); // front first: the blue one, then the sent-back green one

    await page.reload();
    await autosaveReady(page);
    const dialog = page.getByRole("dialog", { name: "이전 작업을 복원할까요?" });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("restore-summary")).toContainText("rich");
    await expect(page.getByTestId("restore-summary")).toContainText(`${PAGE.width} × ${PAGE.height} px`);
    await expect(page.getByTestId("restore-summary")).toContainText("레이어 2");
    expect((await editor(page)).screen).toBeNull(); // nothing is loaded until the user answers

    await page.getByRole("button", { name: "복원" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("screen-label")).toContainText(`${PAGE.width} × ${PAGE.height} px`);

    expect(await snapshot(page)).toEqual(before); // every position, the order, patches, lock, hide, names, scale, rotation and the view
    const after = await editor(page);
    expect(after.past).toBe(0); // a restored project starts with an empty history
    expect(await panelNames(page)).toEqual(namesBefore);
    const green = after.layers.find((l) => l.name === "Green card")!;
    expect(green).toBeDefined();
    expect((await exportPngBytes(page)).equals(pngBefore)).toBe(true); // drawn from the restored bitmaps, byte for byte
    await expect(page.getByRole("button", { name: /잠금 해제/ })).toBeVisible();
  });

  test("restoring prunes the blob store: what the project no longer uses is removed, and only then", async ({ page }) => {
    await richProject(page);
    await waitForAutosave(page);
    await idbDo(page, "blobs", "put", "left-over", new Blob(["x"]));
    expect(await idbKeys(page)).toContain("left-over");
    await page.reload();
    await autosaveReady(page);
    expect(await idbKeys(page)).toContain("left-over"); // the question alone prunes nothing
    await page.getByRole("button", { name: "복원" }).click();
    await expect(page.getByTestId("screen-label")).toBeVisible();
    expect(await idbKeys(page)).not.toContain("left-over");
    const referenced = await page.evaluate(() => {
      const s = (window as any).__slc.getState().snapshotProject().screens[0];
      return [s.source.imageId, ...s.layers.map((l: any) => l.imageId)];
    });
    expect((await idbKeys(page)).sort()).toEqual([...new Set(referenced)].sort());
  });

  test("after restoring, editing is undoable from there and saving carries on", async ({ page }) => {
    await richProject(page);
    await waitForAutosave(page);
    await page.reload();
    await autosaveReady(page);
    await page.getByRole("button", { name: "복원" }).click();
    await expect(page.getByTestId("screen-label")).toBeVisible();
    const was = await savedAtOf(page);
    await page.getByTestId("layer-item").first().click();
    await page.getByTestId("prop-name").fill("renamed after restore");
    await page.getByTestId("prop-name").press("Enter");
    await waitForAutosave(page, was);
    expect(JSON.stringify(await idbRecord(page))).toContain("renamed after restore");
    await page.keyboard.press("Control+z");
    expect(await panelNames(page)).not.toContain("renamed after restore");
    await page.keyboard.press("Control+z"); // nothing earlier than the restore to go back to
    expect((await editor(page)).layers).toHaveLength(2);
  });

  test("the question is a dialog that has to be answered, and the editor's keys stay out of the way meanwhile", async ({ page }) => {
    await richProject(page);
    await waitForAutosave(page);
    await page.reload();
    await autosaveReady(page);
    await expect(page.getByTestId("restore-dialog")).toBeVisible();
    await page.keyboard.press("r");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("restore-dialog")).toBeVisible(); // Escape does not dismiss it
    await expect(page.getByRole("button", { name: "영역 추출", exact: true })).toBeDisabled(); // and there is no project to work on yet
  });

  test("until the question is answered the stored copy is not overwritten, whatever happens in the page", async ({ page }) => {
    await richProject(page);
    await waitForAutosave(page);
    const before = JSON.stringify(await idbRecord(page));
    await page.reload();
    await autosaveReady(page);
    await expect(page.getByTestId("restore-dialog")).toBeVisible();
    await page.evaluate(() => {
      const st = (window as any).__slc.getState();
      st.newProject({ fileName: "intruder.png", raw: { width: 20, height: 20, data: new Uint8ClampedArray(20 * 20 * 4).fill(255) } });
    });
    await page.waitForTimeout(2000); // well past the save delay
    expect(JSON.stringify(await idbRecord(page))).toBe(before);
    await page.getByRole("button", { name: "버리기" }).click();
  });
});

test.describe("discarding", () => {
  test("discard leaves an empty editor, removes the stored copy and its images, and is not asked again", async ({ page }) => {
    await richProject(page);
    await waitForAutosave(page);
    await page.reload();
    await autosaveReady(page);
    await page.getByRole("button", { name: "버리기" }).click();
    await expect(page.getByTestId("restore-dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "화면 캡처를 올려주세요" })).toBeVisible();
    expect((await editor(page)).screen).toBeNull();
    expect(await idbRecord(page)).toBeUndefined();
    expect(await idbKeys(page)).toEqual([]);

    await page.reload();
    await autosaveReady(page);
    expect(await autosaveStatus(page).getAttribute("data-candidate")).toBe("no");
    await expect(page.getByTestId("restore-dialog")).toHaveCount(0);
  });

  test("after discarding, new work is saved on its own", async ({ page }) => {
    await richProject(page);
    await waitForAutosave(page);
    await page.reload();
    await autosaveReady(page);
    await page.getByRole("button", { name: "버리기" }).click();
    await uploadPng(page, blank(50, 40, [9, 8, 7, 255]), "fresh.png");
    await waitForAutosave(page);
    expect(JSON.stringify(await idbRecord(page))).toContain("fresh");
  });
});

test.describe("a damaged stored copy", () => {
  const expectCleanStart = async (page: Page) => {
    await autosaveReady(page);
    await expect(page.getByTestId("restore-dialog")).toHaveCount(0);
    await expect(page.getByTestId("notice")).toContainText("손상");
    await expect(page.getByRole("heading", { name: "화면 캡처를 올려주세요" })).toBeVisible();
    expect((await editor(page)).screen).toBeNull();
    expect(await idbRecord(page)).toBeUndefined(); // the damaged copy is gone
    await page.reload();
    await autosaveReady(page);
    expect(await autosaveStatus(page).getAttribute("data-candidate")).toBe("no"); // so it does not come back
    await expect(page.getByTestId("notice")).toHaveCount(0);
  };

  test("garbage in the record: the user is told, nothing is offered, the editor starts empty", async ({ page }) => {
    await richProject(page);
    await waitForAutosave(page);
    await idbDo(page, "autosave", "put", "current", "this is not a saved project");
    await page.reload();
    await expectCleanStart(page);
  });

  test("a record that is not a valid project", async ({ page }) => {
    await richProject(page);
    await waitForAutosave(page);
    const rec = (await idbRecord(page)) as { project: { screens: unknown[] } };
    rec.project.screens = [];
    await idbDo(page, "autosave", "put", "current", rec);
    await page.reload();
    await expectCleanStart(page);
  });

  test("a record whose image has gone missing", async ({ page }) => {
    await richProject(page);
    await waitForAutosave(page);
    await idbDo(page, "blobs", "delete", (await idbKeys(page))[0]);
    await page.reload();
    await expectCleanStart(page);
  });

  test("an image that is there but is not a picture: restoring fails cleanly, with a message, and the editor stays usable", async ({ page }) => {
    await richProject(page);
    await waitForAutosave(page);
    await idbDo(page, "blobs", "put", (await idbKeys(page))[0], new Blob([new Uint8Array([1, 2, 3])]));
    await page.reload();
    await autosaveReady(page);
    await expect(page.getByTestId("restore-dialog")).toBeVisible(); // it looks fine until it is opened
    await page.getByRole("button", { name: "복원" }).click();
    await expect(page.getByTestId("restore-dialog")).toHaveCount(0);
    await expect(page.getByTestId("notice")).toContainText("복원하지 못했습니다");
    expect((await editor(page)).screen).toBeNull();
    expect(await idbRecord(page)).toBeUndefined();
    await uploadPng(page, pageWithCard()); // and it works
    await waitForAutosave(page);
  });
});

test.describe("what starting something new does to the stored copy", () => {
  test("a new image replaces it: the last project is the one that is kept", async ({ page }) => {
    await richProject(page);
    await waitForAutosave(page);
    await page.reload();
    await autosaveReady(page);
    await page.getByRole("button", { name: "복원" }).click();
    await expect(page.getByTestId("screen-label")).toBeVisible();
    const was = await savedAtOf(page);
    await uploadPng(page, blank(333, 222, [20, 30, 40, 255]), "brand-new.png"); // nothing unsaved, so no question
    await waitForAutosave(page, was);
    await page.reload();
    await autosaveReady(page);
    await expect(page.getByTestId("restore-summary")).toContainText("brand-new");
    await expect(page.getByTestId("restore-summary")).toContainText("333 × 222 px");
    await page.getByRole("button", { name: "버리기" }).click();
  });

  test("opening a project file replaces it too", async ({ page }) => {
    await richProject(page);
    const fileText = await saveProjectFile(page);
    await waitForAutosave(page);
    await uploadPng(page, blank(120, 90, [1, 1, 1, 255]), "other.png");
    await confirmReplace(page);
    await waitForAutosave(page);
    await openProjectFile(page, fileText, "from-file.slc.json");
    await confirmReplace(page);
    await expect(page.getByTestId("screen-label")).toContainText(`${PAGE.width} × ${PAGE.height}`);
    const was = await savedAtOf(page);
    await page.getByTestId("layer-item").first().click();
    await page.getByRole("button", { name: "복제" }).click();
    await waitForAutosave(page, was);
    await page.reload();
    await autosaveReady(page);
    await expect(page.getByTestId("restore-summary")).toContainText("rich"); // the opened project, not the one before it
    await expect(page.getByTestId("restore-summary")).toContainText("레이어 3");
    await page.getByRole("button", { name: "버리기" }).click();
  });
});

test.describe("more than one tab", () => {
  /** a second tab on the same site, the same browser profile */
  const secondTab = async (context: BrowserContext) => {
    const p = await context.newPage();
    await openApp(p);
    return p;
  };

  test("the second tab is told it does not save, shows no offer, and never writes", async ({ page, context }) => {
    await richProject(page);
    await waitForAutosave(page);
    const stored = JSON.stringify(await idbRecord(page));

    const other = await secondTab(context);
    await expect(autosaveStatus(other)).toHaveAttribute("data-ownership", "other-tab");
    await expect(other.getByTestId("autosave-banner")).toBeVisible();
    await expect(other.getByTestId("autosave-banner")).toContainText("자동 저장하지 않습니다");
    await expect(autosaveStatus(other)).toContainText("자동 저장 꺼짐");
    await expect(other.getByTestId("restore-dialog")).toHaveCount(0); // the offer belongs to the owning tab
    await expect(autosaveStatus(page)).toHaveAttribute("data-ownership", "owner");

    await uploadPng(other, blank(77, 55, [5, 5, 5, 255]), "second-tab.png");
    await other.waitForTimeout(2000);
    expect(JSON.stringify(await idbRecord(other))).toBe(stored); // the first tab's saved copy is untouched
    expect(await idbKeys(other)).toEqual(await idbKeys(page));
  });

  test("what the second tab does with files and projects cannot delete the first tab's saved images", async ({ page, context }) => {
    await richProject(page);
    await waitForAutosave(page);
    const keys = await idbKeys(page);
    const fileText = await saveProjectFile(page);

    const other = await secondTab(context);
    await expect(autosaveStatus(other)).toHaveAttribute("data-ownership", "other-tab");
    await uploadPng(other, pageWithCard(), "other.png");
    await openProjectFile(other, fileText, "mine.slc.json"); // opening clears and prunes the blob store, wherever it is
    await confirmReplace(other);
    await expect(other.getByTestId("screen-label")).toBeVisible();
    await saveProjectFile(other);
    await other.waitForTimeout(1500);
    expect(await idbKeys(other)).toEqual(keys); // every one of the first tab's images is still there

    // and the first tab's work can still be restored from them
    await other.close();
    await page.reload();
    await autosaveReady(page);
    await expect(page.getByTestId("restore-dialog")).toBeVisible();
    await page.getByRole("button", { name: "복원" }).click();
    await expect(page.getByTestId("screen-label")).toContainText(`${PAGE.width} × ${PAGE.height}`);
    expect((await editor(page)).layers).toHaveLength(2);
  });

  test("when the first tab closes the second takes over, is offered that work, and saves once it has answered", async ({ page, context }) => {
    await richProject(page);
    await waitForAutosave(page);
    const other = await secondTab(context);
    await expect(autosaveStatus(other)).toHaveAttribute("data-ownership", "other-tab");
    await uploadPng(other, blank(90, 60, [7, 7, 7, 255]), "waiting.png");

    await page.close();
    await expect(autosaveStatus(other)).toHaveAttribute("data-ownership", "owner", { timeout: 15000 });
    await expect(other.getByTestId("autosave-banner")).toHaveCount(0);
    await expect(other.getByTestId("restore-dialog")).toBeVisible(); // the closed tab's work is on offer
    await expect(other.getByTestId("restore-dialog")).toContainText("복원하면 지금 열려 있는 화면은 대체됩니다");

    const stored = JSON.stringify(await idbRecord(other));
    await other.waitForTimeout(1500);
    expect(JSON.stringify(await idbRecord(other))).toBe(stored); // not overwritten while the question is open

    await other.getByRole("button", { name: "복원" }).click();
    await expect(other.getByTestId("screen-label")).toContainText(`${PAGE.width} × ${PAGE.height}`);
    const was = await savedAtOf(other);
    await other.getByTestId("layer-item").first().click();
    await other.getByRole("button", { name: "복제" }).click();
    await waitForAutosave(other, was);
  });

  test("a second tab that has just become the owner and declines the offer keeps its own work, saved", async ({ page, context }) => {
    await richProject(page);
    await waitForAutosave(page);
    const other = await secondTab(context);
    await expect(autosaveStatus(other)).toHaveAttribute("data-ownership", "other-tab");
    await uploadPng(other, blank(90, 60, [7, 7, 7, 255]), "mine.png");
    await page.close();
    await expect(other.getByTestId("restore-dialog")).toBeVisible({ timeout: 15000 });
    await other.getByRole("button", { name: "버리기" }).click();
    await waitForAutosave(other);
    expect(JSON.stringify(await idbRecord(other))).toContain("mine");
  });
});
