import fs from "node:fs";
import { Page, expect, test } from "@playwright/test";
import { findCandidates, iou } from "../../src/lib/image/candidates";
import { decodePng } from "../unit/png";
import { GRAY, BLUE, blank, clientOf, dragImageRect, editor, encodePng, fill, openApp, openProjectFile, pageWithCard, pickTool, reloadAndDiscard, saveProjectFile, uploadPng, zoomTo } from "./helpers";

const FIXTURE = "tests/fixtures/realistic-capture.png";
const truth: Record<string, { x: number; y: number; width: number; height: number }> = JSON.parse(fs.readFileSync("tests/fixtures/realistic-capture.rects.json", "utf8"));
const expected = findCandidates(decodePng(fs.readFileSync(FIXTURE))); // the same picture analysed on this thread

type Box = { x: number; y: number; width: number; height: number };
const centre = (r: Box) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const state = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__slc.getState();
    return {
      tool: s.activeTool as string,
      status: s.candidateStatus as string,
      count: (s.candidates?.list.length ?? null) as number | null,
      ms: (s.candidates?.ms ?? null) as number | null,
      imageId: (s.candidates?.imageId ?? null) as string | null,
      pick: s.candidatePick as { rect: Box; index: number; count: number } | null,
    };
  });
const ready = (page: Page) => expect(page.getByTestId("candidate-status")).toHaveAttribute("data-state", "ready", { timeout: 60_000 });

async function scene(page: Page, zoom = 1, at = { x: 380, y: 330 }) {
  await openApp(page);
  await page.getByTestId("file-input").setInputFiles(FIXTURE);
  await expect(page.getByTestId("screen-label")).toContainText("960 × 600");
  await zoomTo(page, zoom, at.x, at.y);
  await pickTool(page, "자동 후보");
  await ready(page);
}
const click = async (page: Page, p: { x: number; y: number }) => {
  const c = await clientOf(page, p.x, p.y);
  await page.mouse.click(c.x, c.y);
};
const layersOf = async (page: Page) => (await editor(page)).layers;
const inside = (inner: Box, outer: Box) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
/** click the same spot again and again (each click goes one candidate outwards) until the chosen box is the wanted one; how many clicks it took */
async function reach(page: Page, target: Box, spot = centre(target), want = 0.9) {
  for (let i = 1; i <= 10; i++) {
    await click(page, spot);
    const pick = (await state(page)).pick;
    if (!pick) break;
    if (iou(pick.rect, target) >= want) return i;
  }
  throw new Error(`the tool never offered a box like ${JSON.stringify(target)}`);
}

test.describe("the automatic-candidates tool", () => {
  test("choosing it analyses the picture in a worker and reports how many candidates it found; the worker finds what this thread finds", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("file-input").setInputFiles(FIXTURE);
    await expect(page.getByTestId("screen-label")).toContainText("960 × 600");
    expect((await state(page)).count).toBeNull(); // nothing is analysed until asked for
    await pickTool(page, "자동 후보");
    await ready(page);
    const s = await state(page);
    expect(s.count).toBe(expected.length);
    expect(s.count).toBeGreaterThan(10);
    await expect(page.getByTestId("candidate-status")).toContainText(`후보 ${expected.length}개`);
    const same = await page.evaluate((exp) => JSON.stringify((window as any).__slc.getState().candidates.list) === JSON.stringify(exp), expected);
    expect(same).toBe(true);
  });

  test("the candidates are dotted outlines on the canvas (dashes with gaps, not a solid line)", async ({ page }) => {
    await scene(page);
    await expect(page.getByTestId("candidate-overlay")).toHaveAttribute("data-drawn", "yes");
    const edge = await clientOf(page, truth.card1.x, truth.card1.y + 20);
    const pattern = await page.evaluate(
      ([cx, cy, len]) => {
        const canvas = document.querySelector('[data-testid="candidate-overlay"]') as HTMLCanvasElement;
        const box = canvas.getBoundingClientRect();
        const k = canvas.width / box.width;
        const g = canvas.getContext("2d")!;
        let best = { painted: 0, runs: 0, total: 0 };
        for (let dx = -2; dx <= 2; dx++) {
          const x = Math.round((cx - box.left) * k) + dx;
          const col = g.getImageData(x, Math.round((cy - box.top) * k), 1, Math.round(len * k)).data;
          let painted = 0;
          let runs = 0;
          let was = false;
          for (let i = 0; i < col.length; i += 4) {
            const on = col[i + 3] > 40;
            if (on) painted++;
            if (on && !was) runs++;
            was = on;
          }
          if (painted > best.painted) best = { painted, runs, total: col.length / 4 };
        }
        return best;
      },
      [edge.x, edge.y, truth.card1.height - 40] as const,
    );
    const share = pattern.painted / pattern.total;
    expect(share).toBeGreaterThan(0.3);
    expect(share).toBeLessThan(0.8); // gaps: it is dotted
    expect(pattern.runs).toBeGreaterThanOrEqual(8);
  });

  test("a click takes the smallest candidate under it; the same spot again goes outwards to the card, then on, then starts over", async ({ page }) => {
    await scene(page);
    const spot = centre(truth.button1);
    await click(page, spot);
    let s = await state(page);
    expect(s.pick).toMatchObject({ index: 0 });
    expect(inside(s.pick!.rect, truth.button1)).toBe(true); // the smallest thing under the click: the button's own label, not the button
    expect(s.pick!.rect.width * s.pick!.rect.height).toBeLessThan(truth.button1.width * truth.button1.height);
    await expect(page.getByTestId("candidate-pick")).toContainText(`1/${s.pick!.count} · ${s.pick!.rect.width} × ${s.pick!.rect.height} px`);
    const widths = [s.pick!.rect.width];
    for (let i = 0; i < s.pick!.count; i++) {
      await click(page, spot);
      s = await state(page);
      widths.push(s.pick!.rect.width);
    }
    expect(widths.at(-1)).toBe(widths[0]); // all the way round: back to the smallest
    expect(widths.slice(0, -1)).toEqual([...widths.slice(0, -1)].sort((a, b) => a - b)); // each click is not smaller than the one before
    expect(widths.some((w) => w === truth.button1.width)).toBe(true); // the button is among them
    expect(widths.some((w) => w === truth.card1.width)).toBe(true); // and the card that holds it
  });

  test("a click elsewhere starts again from the smallest there; a click on the bare page chooses nothing", async ({ page }) => {
    await scene(page);
    await click(page, centre(truth.button1));
    await click(page, centre(truth.button1));
    expect((await state(page)).pick!.index).toBe(1);
    await click(page, { x: truth.card1.x + 120, y: truth.card1.y + 200 }); // inside the card, beside its button: only the card is under this spot
    const s = await state(page);
    expect(s.pick).toMatchObject({ index: 0 });
    expect(iou(s.pick!.rect, truth.card1)).toBeGreaterThan(0.9);
  });

  test("a click on the bare page of a plain capture chooses nothing (the whole page is not offered), and drops an earlier choice", async ({ page }) => {
    await openApp(page);
    await uploadPng(page, pageWithCard());
    await zoomTo(page, 1, 420, 300);
    await pickTool(page, "자동 후보");
    await ready(page);
    await click(page, { x: 360, y: 260 }); // on the card
    expect((await state(page)).pick).not.toBeNull();
    await click(page, { x: 150, y: 120 }); // the page itself
    expect((await state(page)).pick).toBeNull();
    await expect(page.getByTestId("candidate-pick")).toHaveCount(0);
  });

  test("on a capture with a header, the page below it is a region of its own (89% of the picture) and can be offered; this is known and reported", async ({ page }) => {
    await scene(page);
    await click(page, { x: 100, y: 575 });
    const s = await state(page);
    expect(s.pick!.count).toBe(1);
    expect(s.pick!.rect).toEqual({ x: 0, y: 64, width: 960, height: 536 });
  });

  test("Enter (or the button) extracts the chosen box through the ordinary extraction: a layer cut from exactly that box, one undo step", async ({ page }) => {
    await scene(page);
    const before = (await editor(page)).past;
    await reach(page, truth.thumb0);
    const box = (await state(page)).pick!.rect;
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await layersOf(page)).length).toBe(1);
    const [layer] = await layersOf(page);
    expect(layer.crop).toEqual(box);
    expect((await editor(page)).patches).toHaveLength(1);
    expect((await editor(page)).patches[0].rect).toEqual(box);
    expect((await editor(page)).past).toBe(before + 1);
    expect((await editor(page)).selected).toEqual([layer.id]);
    expect((await state(page)).tool).toBe("select");
    await page.keyboard.press("Control+z");
    expect(await layersOf(page)).toHaveLength(0);
  });

  test("it is the same as dragging that rectangle by hand: same crop, same patch colour, same pixels", async ({ page }) => {
    await scene(page);
    await reach(page, truth.thumb0);
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await layersOf(page)).length).toBe(1);
    const grab = () =>
      page.evaluate(() => {
        const s = (window as any).__slc.getState();
        const screen = s.history.present.screens[0];
        const l = screen.layers[0];
        const raw = s.images.get(l.imageId).raw;
        let h = 2166136261;
        for (let i = 0; i < raw.data.length; i++) h = Math.imul(h ^ raw.data[i], 16777619) >>> 0;
        return { crop: l.crop, transform: l.transform, patch: screen.backgroundPatches[0], size: [raw.width, raw.height], hash: h };
      });
    const auto = await grab();
    await page.keyboard.press("Control+z");
    await pickTool(page, "영역 추출");
    await dragImageRect(page, { x: auto.crop.x, y: auto.crop.y }, { x: auto.crop.x + auto.crop.width, y: auto.crop.y + auto.crop.height });
    await expect.poll(async () => (await layersOf(page)).length).toBe(1);
    const manual = await grab();
    expect(manual.crop).toEqual(auto.crop);
    expect(manual.size).toEqual(auto.size);
    expect(manual.hash).toBe(auto.hash);
    expect(manual.patch.rect).toEqual(auto.patch.rect);
    expect(manual.patch.fill).toBe(auto.patch.fill);
    expect(manual.transform).toEqual(auto.transform);
  });

  test("Esc, the Clear button and leaving the tool drop the choice; the dots go with the tool", async ({ page }) => {
    await scene(page);
    await click(page, centre(truth.button1));
    await page.keyboard.press("Escape");
    expect((await state(page)).pick).toBeNull();
    await click(page, centre(truth.button1));
    await page.getByTestId("candidate-clear").click();
    expect((await state(page)).pick).toBeNull();
    await click(page, centre(truth.button1));
    await page.keyboard.press("v");
    expect((await state(page)).pick).toBeNull();
    await expect(page.getByTestId("candidate-overlay")).toHaveAttribute("data-drawn", "no");
    await expect(page.getByTestId("candidate-bar")).toHaveCount(0);
    await pickTool(page, "자동 후보"); // back: already analysed, so no waiting
    await expect(page.getByTestId("candidate-overlay")).toHaveAttribute("data-drawn", "yes");
    expect((await state(page)).count).toBe(expected.length);
  });

  test("Enter and Escape mean nothing when nothing is chosen (a page's Enter/Esc are left alone)", async ({ page }) => {
    await scene(page);
    const before = (await editor(page)).past;
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    expect((await editor(page)).past).toBe(before);
    expect(await layersOf(page)).toHaveLength(0);
  });

  test("while comparing: no dots, no choosing, no extracting", async ({ page }) => {
    await scene(page);
    await click(page, centre(truth.button1));
    await page.evaluate(() => (window as any).__slc.getState().setCompareMode("split"));
    await expect(page.getByTestId("candidate-overlay")).toHaveAttribute("data-drawn", "no");
    await expect(page.getByTestId("candidate-bar")).toHaveCount(0);
    await page.keyboard.press("Enter");
    expect(await layersOf(page)).toHaveLength(0);
    const picked = await page.evaluate(() => (window as any).__slc.getState().pickCandidateAt({ x: 100, y: 150 }));
    expect(picked).toBe(false);
    await page.evaluate(() => (window as any).__slc.getState().setCompareMode("off"));
    await expect(page.getByTestId("candidate-overlay")).toHaveAttribute("data-drawn", "yes");
  });

  test("a hidden or locked layer does not matter: candidates come from the original picture, not from what is on top of it", async ({ page }) => {
    await scene(page);
    await reach(page, truth.thumb0);
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await layersOf(page)).length).toBe(1);
    await page.getByRole("button", { name: /잠그기$/ }).click();
    await page.getByRole("button", { name: /숨기기$/ }).click();
    await pickTool(page, "자동 후보");
    await reach(page, truth.thumb0); // the picture was extracted, locked and hidden: it is still found, from the original
    const s = await state(page);
    expect(iou(s.pick!.rect, truth.thumb0)).toBeGreaterThan(0.9);
    expect(s.count).toBe(expected.length);
  });
});

for (const [dpr, zoom] of [[1, 2], [2, 1], [2, 2]] as const) {
  test.describe(`devicePixelRatio ${dpr}, zoom ${zoom * 100}%`, () => {
    test.use({ deviceScaleFactor: dpr });
    test("the same click spot gives the same candidates whatever the zoom and pixel ratio", async ({ page }) => {
      await scene(page, zoom, { x: 420, y: 300 });
      const picks: Box[] = [];
      const spot = centre(truth.button1);
      for (let i = 0; i < 3; i++) {
        await click(page, spot);
        picks.push((await state(page)).pick!.rect);
      }
      expect(inside(picks[0], truth.button1)).toBe(true);
      // the reference: the same clicks on the tool's own list, in image pixels
      const ref = await page.evaluate((p) => {
        const st = (window as any).__slc.getState();
        st.clearCandidatePick();
        const out: Box[] = [];
        for (let i = 0; i < 3; i++) {
          st.pickCandidateAt(p);
          out.push((window as any).__slc.getState().candidatePick.rect);
        }
        return out;
      }, spot);
      expect(picks).toEqual(ref);
    });
    test("extracting lands on the picture's own pixels: the layer's crop is the candidate box", async ({ page }) => {
      await scene(page, zoom, { x: 200, y: 200 }); // the thumbnail in the first card is in view at every zoom
      await reach(page, truth.thumb0);
      const box = (await state(page)).pick!.rect;
      await page.keyboard.press("Enter");
      await expect.poll(async () => (await layersOf(page)).length).toBe(1);
      expect((await layersOf(page))[0].crop).toEqual(box);
    });
  });
}

test.describe("saving and restoring", () => {
  test("a layer made from a candidate is saved and opened like any other, and the file knows nothing of candidates", async ({ page }) => {
    await scene(page);
    await reach(page, truth.thumb0);
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await layersOf(page)).length).toBe(1);
    const [layer] = await layersOf(page);
    const text = await saveProjectFile(page);
    expect(text).not.toMatch(/candidate/i);
    await reloadAndDiscard(page);
    await openProjectFile(page, text);
    await expect.poll(async () => (await layersOf(page)).length).toBe(1);
    expect((await layersOf(page))[0]).toMatchObject({ crop: layer.crop, transform: layer.transform });
    expect((await state(page)).count).toBeNull(); // the analysis is not kept: it is redone when asked for
    expect((await state(page)).pick).toBeNull();
  });

  test("opening another picture forgets the analysis; choosing the tool analyses the new one", async ({ page }) => {
    await scene(page);
    const first = (await state(page)).imageId;
    await uploadPng(page, pageWithCard());
    await expect.poll(async () => (await state(page)).count).toBeNull(); // the old analysis is gone with the old picture
    expect((await state(page)).tool).toBe("select");
    await pickTool(page, "자동 후보");
    await ready(page);
    const s = await state(page);
    expect(s.imageId).not.toBe(first);
    expect(s.count).not.toBe(expected.length);
    expect(s.count).toBeGreaterThanOrEqual(1); // the card on the plain page
  });
});

test.describe("accuracy (measurement; printed for the report)", () => {
  test("for each known element of the realistic capture: how good the first click is, and how many clicks reach it", async ({ page }) => {
    await scene(page);
    const rows = await page.evaluate(
      ({ truthMap }) => {
        const st = (window as any).__slc.getState();
        const out: { element: string; first: Box | null; clicks: number | null; best: Box | null }[] = [];
        const iouOf = (a: Box, b: Box) => {
          const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          if (w <= 0 || h <= 0) return 0;
          return (w * h) / (a.width * a.height + b.width * b.height - w * h);
        };
        for (const [name, r] of Object.entries(truthMap as Record<string, Box>)) {
          st.clearCandidatePick();
          const p = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          let first: Box | null = null;
          let hit: number | null = null;
          let best: Box | null = null;
          for (let i = 1; i <= 8; i++) {
            if (!(window as any).__slc.getState().pickCandidateAt(p)) break;
            const pick = (window as any).__slc.getState().candidatePick;
            if (i === 1) first = pick.rect;
            if (!best || iouOf(pick.rect, r) > iouOf(best, r)) best = pick.rect;
            if (hit === null && iouOf(pick.rect, r) >= 0.85) hit = i;
            if (pick.index === pick.count - 1) break; // the largest: next click would start over
          }
          out.push({ element: name, first, clicks: hit, best });
        }
        return out;
      },
      { truthMap: truth },
    );
    const table = rows.map((r) => ({
      element: r.element,
      "first-click IoU": r.first ? Number(iou(r.first, truth[r.element]).toFixed(3)) : 0,
      "clicks to IoU>=0.85": r.clicks ?? "not reached",
      "best IoU": r.best ? Number(iou(r.best, truth[r.element]).toFixed(3)) : 0,
    }));
    console.log(`ACCURACY realistic-capture.png via the tool (${expected.length} candidates in 960x600):`);
    console.table(table);
    for (const name of ["card0", "card1", "card2", "button0", "button1", "button2", "thumb0", "wide", "textbar0"]) {
      const row = rows.find((r) => r.element === name)!;
      expect(row.clicks, name).not.toBeNull();
      expect(row.clicks!, name).toBeLessThanOrEqual(3);
    }
  });
});

/** a busy-enough capture: a grid of cards each with a heading bar and a button, on a flat page */
function bigCapture(w: number, h: number) {
  const img = blank(w, h, GRAY);
  const cols = Math.floor((w - 100) / 380);
  const rows = Math.floor((h - 100) / 560);
  for (let i = 0; i < cols * rows; i++) {
    const x = 100 + (i % cols) * 380;
    const y = 100 + Math.floor(i / cols) * 560;
    fill(img, x, y, 320, 480, [255, 255, 255, 255]);
    fill(img, x + 20, y + 20, 280, 40, [200, 205, 215, 255]);
    fill(img, x + 20, y + 400, 120, 50, BLUE);
  }
  return { img, cards: cols * rows };
}

for (const [w, h] of [[4000, 3000], [8192, 4096]] as const) {
  test(`analysing a ${w} × ${h} capture happens in the worker: how long it takes, and whether the page stays responsive (measurement)`, async ({ page }) => {
    test.setTimeout(300_000);
    const { img, cards } = bigCapture(w, h);
    await openApp(page);
    await page.getByTestId("file-input").setInputFiles({ name: "big.png", mimeType: "image/png", buffer: encodePng(img) });
    await expect(page.getByTestId("screen-label")).toContainText(`${w} × ${h}`, { timeout: 120_000 });
    // a frame counter that runs while the analysis does: a long gap between frames would mean the page was blocked
    await page.evaluate(() => {
      const w = window as any;
      w.__gaps = [];
      let last = performance.now();
      const tick = () => {
        const now = performance.now();
        w.__gaps.push(now - last);
        last = now;
        w.__raf = requestAnimationFrame(tick);
      };
      w.__raf = requestAnimationFrame(tick);
    });
    const t0 = Date.now();
    await pickTool(page, "자동 후보");
    await ready(page);
    const wall = Date.now() - t0;
    const gaps = await page.evaluate(() => {
      const w = window as any;
      cancelAnimationFrame(w.__raf);
      const g = (w.__gaps as number[]).slice(1);
      return { max: Math.round(Math.max(...g)), frames: g.length, over100: g.filter((v) => v > 100).length };
    });
    const s = await state(page);
    expect(s.count).toBeGreaterThanOrEqual(cards * 3);
    console.log(`MEASURE candidates ${w}x${h} (${cards} cards, ${s.count} candidates): worker analysis ${s.ms} ms, ${wall} ms from choosing the tool to the dots; while it ran the page drew ${gaps.frames} frames, the longest gap ${gaps.max} ms, ${gaps.over100} gaps over 100 ms`);
    // and a click still works right away
    await page.evaluate(() => (window as any).__slc.getState().setView({ zoom: 0.2, panX: 20, panY: 20 }));
    await click(page, { x: 100 + 160, y: 100 + 240 });
    expect((await state(page)).pick).not.toBeNull();
  });
}

test("a picture that is all noise (too many colour changes to analyse) is explained, can be retried, and manual extraction still works", async ({ page }) => {
  test.setTimeout(240_000);
  const w = 3200;
  const h = 2000; // 6.4 million pixels, a run each: past the limit
  const img = blank(w, h, GRAY);
  let seed = 11;
  for (let i = 0; i < w * h; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    img.data[i * 4] = seed & 255;
    img.data[i * 4 + 1] = (seed >> 8) & 255;
    img.data[i * 4 + 2] = (seed >> 16) & 255;
  }
  await openApp(page);
  await page.getByTestId("file-input").setInputFiles({ name: "noise.png", mimeType: "image/png", buffer: encodePng(img) });
  await expect(page.getByTestId("screen-label")).toContainText(`${w} × ${h}`, { timeout: 120_000 });
  await pickTool(page, "자동 후보");
  await expect(page.getByTestId("candidate-status")).toHaveAttribute("data-state", "error", { timeout: 120_000 });
  await expect(page.getByTestId("candidate-status")).toContainText("복잡한 화면");
  await expect(page.getByRole("button", { name: "다시 분석" })).toBeVisible();
  expect((await state(page)).count).toBeNull();
  await expect(page.getByTestId("candidate-overlay")).toHaveAttribute("data-drawn", "no");
  // the manual way is untouched
  await pickTool(page, "영역 추출");
  await dragImageRect(page, { x: 100, y: 100 }, { x: 160, y: 140 });
  await expect(page.getByRole("dialog")).toBeVisible(); // noise has no single background colour: the usual question
});