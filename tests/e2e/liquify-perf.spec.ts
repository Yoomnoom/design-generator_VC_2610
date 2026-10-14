import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { blank, clientOf, editor, encodePng, fill, openApp, pickTool, upload, zoomTo } from "./helpers";

/* Measures (PW_PERF=1) the liquify tool on a 4000 x 3000 screen with a 3600 x 2700 layer:
 *  - frames while a stroke is being dragged (the picture is painted on a working copy; only the changed pixels are copied to the canvas);
 *  - what happens when the stroke is released (a new picture, one undo step);
 *  - the bytes the editor keeps for 100 strokes, against what keeping every version would take. */
test.skip(process.env.PW_PERF !== "1", "measurement only: PW_PERF=1");
test.setTimeout(300_000);

const cacheBytes = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const s = (window as any).__slc.getState();
    let total = 0;
    for (const v of s.images.values()) total += v.raw.data.byteLength;
    return { cacheBytes: total as number, images: s.images.size as number, undoSteps: s.history.past.length as number };
  });

test("liquify tool on a 4000 x 3000 layer: frames while dragging, release time, memory over 100 strokes", async ({ page }) => {
  await openApp(page);
  const p = blank(4000, 3000, [240, 240, 240, 255]);
  fill(p, 200, 150, 3600, 2700, [30, 90, 200, 255]);
  fill(p, 200, 150, 400, 300, [255, 0, 0, 255]);
  await upload(page, { name: "big.png", mimeType: "image/png", buffer: encodePng(p) });
  await expect(page.getByTestId("screen-label")).toBeVisible();
  await zoomTo(page, 0.14, 2000, 1500);
  const made = await page.evaluate(() => (window as any).__slc.getState().beginExtraction({ x: 200, y: 150, width: 3600, height: 2700 }));
  expect(made.status).toBe("committed");
  await pickTool(page, "유동화");
  await page.evaluate(() => (window as any).__slc.getState().setLiquifyStyle({ mode: "push", size: 200, strength: 80, softness: 50 }));

  await page.evaluate(() => {
    const w = window as any;
    w.__frames = [];
    let last = performance.now();
    const tick = () => { const n = performance.now(); w.__frames.push(n - last); last = n; w.__raf = requestAnimationFrame(tick); };
    w.__raf = requestAnimationFrame(tick);
  });
  const from = await clientOf(page, 300, 250);
  const to = await clientOf(page, 3200, 1800);
  await page.mouse.move(from.x, from.y);
  const t0 = Date.now();
  await page.mouse.down();
  const downMs = Date.now() - t0; // the working copy of the 3600 x 2700 picture is made here
  await page.evaluate(() => ((window as any).__frames = []));
  const STEPS = 80;
  for (let i = 1; i <= STEPS; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / STEPS, from.y + ((to.y - from.y) * i) / STEPS);
    await page.waitForTimeout(16);
  }
  const during = await page.evaluate(() => (window as any).__frames as number[]);
  const t1 = Date.now();
  await page.mouse.up();
  const releaseMs = Date.now() - t1;
  await page.evaluate(() => cancelAnimationFrame((window as any).__raf));
  const sorted = [...during].sort((a, b) => a - b);
  const stroke = { pointerDownMs: downMs, frames: during.length, medianMs: Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10, p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10, maxMs: Math.round(sorted.at(-1)! * 10) / 10, over33ms: during.filter((d) => d > 33).length, releaseMs };
  const afterOne = await cacheBytes(page);
  expect((await editor(page)).past).toBeGreaterThanOrEqual(2); // the stroke is one undo step on top of the extraction

  // 100 strokes' worth of new pictures, committed through the store (each is a full-size copy with a changed pixel)
  const memory = await page.evaluate(async () => {
    const s = () => (window as any).__slc.getState();
    const layerId = s().history.present.screens[0].layers[0].id;
    const sizes: number[] = [];
    let peakCache = 0, peakHeap = 0;
    const heap = () => ((performance as any).memory?.usedJSHeapSize ?? 0) as number;
    for (let i = 0; i < 100; i++) {
      const cur = s().images.get(s().history.present.screens[0].layers[0].imageId).raw;
      const raw = { width: cur.width, height: cur.height, data: new Uint8ClampedArray(cur.data) };
      raw.data[(i * 4001) % raw.data.length] ^= 1;
      if (!s().commitSmudge(layerId, raw)) throw new Error("commit refused");
      let total = 0;
      for (const v of s().images.values()) total += v.raw.data.byteLength;
      peakCache = Math.max(peakCache, total);
      peakHeap = Math.max(peakHeap, heap());
      if (i % 10 === 9) sizes.push(s().history.past.length);
      await new Promise((r) => setTimeout(r, 0));
    }
    return { peakCacheBytes: peakCache, peakJsHeapBytes: peakHeap, undoStepsEveryTen: sizes, undoStepsAtEnd: s().history.past.length, imagesAtEnd: s().images.size, oneBitmapBytes: 3600 * 2700 * 4 };
  });
  // every kept step must still undo to a picture that is there
  const undone = await page.evaluate(() => {
    const s = () => (window as any).__slc.getState();
    let n = 0;
    while (s().history.past.length > 0) {
      s().undo();
      const l = s().history.present.screens[0].layers[0];
      if (l && !s().images.has(l.imageId)) throw new Error("an undo step lost its picture");
      n++;
    }
    return n;
  });
  const report = { stroke, afterOneStrokeCacheMB: Math.round(afterOne.cacheBytes / 1048576), hundredStrokes: { ...memory, peakCacheMB: Math.round(memory.peakCacheBytes / 1048576), keepingEveryVersionWouldBeMB: Math.round((101 * memory.oneBitmapBytes) / 1048576), stepsUndoneBackToTheOldest: undone } };
  console.log("LIQUIFY-PERF " + JSON.stringify(report));
  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync(`test-results/liquify-perf-${process.env.PW_PROD === "1" ? "prod" : "dev"}.json`, JSON.stringify(report, null, 1));
  expect(memory.peakCacheBytes).toBeLessThan(700 * 1048576);
});