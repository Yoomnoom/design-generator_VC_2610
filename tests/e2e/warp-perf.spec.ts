import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { blank, editor, fill, openApp, pickTool, upload, encodePng, clientOf, zoomTo } from "./helpers";

/* Measures (PW_PERF=1): a 4000 x 3000 bitmap layer, warped by dragging a corner. While the pointer is down the picture is drawn at a lower
 * resolution; when it is released the full picture is drawn once. */
test.skip(process.env.PW_PERF !== "1", "measurement only: PW_PERF=1");
test.setTimeout(240_000);

test("warping a 4000 x 3000 layer: frames while dragging, time to the full picture after release", async ({ page }) => {
  await openApp(page);
  const p = blank(4000, 3000, [240, 240, 240, 255]);
  fill(p, 200, 150, 3600, 2700, [30, 90, 200, 255]);
  fill(p, 200, 150, 400, 300, [255, 0, 0, 255]);
  await upload(page, { name: "big.png", mimeType: "image/png", buffer: encodePng(p) });
  await expect(page.getByTestId("screen-label")).toBeVisible();
  await zoomTo(page, 0.14, 2000, 1500);
  // make a 3600 x 2700 layer straight from the store (the drag tool would do the same through beginExtraction)
  const made = await page.evaluate(() => (window as any).__slc.getState().beginExtraction({ x: 200, y: 150, width: 3600, height: 2700 }));
  expect(made.status).toBe("committed");
  // baseline: just moving this same layer with the select tool (what the canvas costs without any warping)
  const frames = () => page.evaluate(() => {
    const w = window as any;
    w.__frames = [];
    let last = performance.now();
    const tick = () => { const n = performance.now(); w.__frames.push(n - last); last = n; w.__raf = requestAnimationFrame(tick); };
    w.__raf = requestAnimationFrame(tick);
  });
  await frames();
  const mid = await clientOf(page, 2000, 1500);
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.evaluate(() => ((window as any).__frames = []));
  for (let i = 1; i <= 60; i++) {
    await page.mouse.move(mid.x + i * 0.6, mid.y + i * 0.45);
    await page.waitForTimeout(16);
  }
  const base = await page.evaluate(() => (window as any).__frames as number[]);
  await page.mouse.up();
  await page.evaluate(() => cancelAnimationFrame((window as any).__raf));
  await page.keyboard.press("Control+z");
  expect((await editor(page)).layers[0].transform.x).toBe(200);
  console.log("WARP-PERF baseline(move layer) " + JSON.stringify({ frames: base.length, over33ms: base.filter((d) => d > 33).length, maxMs: Math.round(Math.max(...base)) }));
  await pickTool(page, "변형");

  await page.evaluate(() => {
    const w = window as any;
    w.__frames = [];
    let last = performance.now();
    const tick = () => { const n = performance.now(); w.__frames.push(n - last); last = n; w.__raf = requestAnimationFrame(tick); };
    w.__raf = requestAnimationFrame(tick);
  });
  const from = await clientOf(page, 3800, 2850);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.evaluate(() => ((window as any).__frames = []));
  const STEPS = 60;
  for (let i = 1; i <= STEPS; i++) {
    await page.mouse.move(from.x + i * 0.6, from.y + i * 0.45);
    await page.waitForTimeout(16);
  }
  const during = await page.evaluate(() => (window as any).__frames as number[]);
  const t0 = Date.now();
  await page.mouse.up();
  const releaseMs = await page.evaluate(() => new Promise<number>((res) => { const t = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => res(performance.now() - t))); }));
  const wall = Date.now() - t0;
  const long = during.filter((d) => d > 33).length;
  const sorted = [...during].sort((a, b) => a - b);
  const report = { frames: during.length, medianMs: Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10, p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10, maxMs: Math.round(sorted.at(-1)! * 10) / 10, over33ms: long, releaseToPaintMs: Math.round(releaseMs), releaseWallMs: wall, layers: (await editor(page)).layers.length };
  console.log("WARP-PERF " + JSON.stringify(report));
  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync(`test-results/warp-perf-${process.env.PW_PROD === "1" ? "prod" : "dev"}.json`, JSON.stringify(report, null, 1));
  const warp = await page.evaluate(() => (window as any).__slc.getState().history.present.screens[0].layers[0].warp);
  console.log("WARP-PERF warp " + JSON.stringify(warp?.points?.[2]));
  expect(warp?.kind).toBe("quad"); // the drag really bent the layer
  expect(warp.points[2].x).toBeGreaterThan(3600 + 100);
  await page.screenshot({ path: "test-results/warp-perf-after.png" });
});