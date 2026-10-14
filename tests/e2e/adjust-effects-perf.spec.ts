import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { blank, editor, encodePng, fill, openApp, upload, zoomTo } from "./helpers";

/* Measures (PW_PERF=1): a 3600 x 2700 bitmap layer on a 4000 x 3000 page. How long the editor is blocked (the longest frame) from the moment an image
 * adjustment or a layer effect is applied until the picture is settled. */
test.skip(process.env.PW_PERF !== "1", "measurement only: PW_PERF=1");
test.setTimeout(240_000);

const cases: [string, string][] = [
  ["colour (brightness, hue)", `s.setLayerAdjust(id, { brightness: 20, contrast: 0, saturation: 0, hue: 40, blur: 0, sharpen: 0 })`],
  ["blur 20", `s.setLayerAdjust(id, { brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 20, sharpen: 0 })`],
  ["drop shadow", `s.setLayerEffects(id, { shadow: { on: true, color: "#000000", opacity: 0.5, dx: 20, dy: 20, blur: 30 } })`],
];

test("adjustments and effects on a 3600 x 2700 layer: longest frame", async ({ page }) => {
  await openApp(page);
  const p = blank(4000, 3000, [240, 240, 240, 255]);
  fill(p, 200, 150, 3600, 2700, [30, 90, 200, 255]);
  fill(p, 200, 150, 400, 300, [255, 0, 0, 255]);
  await upload(page, { name: "big.png", mimeType: "image/png", buffer: encodePng(p) });
  await expect(page.getByTestId("screen-label")).toBeVisible();
  await zoomTo(page, 0.14, 2000, 1500);
  const made = await page.evaluate(() => (window as any).__slc.getState().beginExtraction({ x: 200, y: 150, width: 3600, height: 2700 }));
  expect(made.status).toBe("committed");
  const report: Record<string, unknown> = {};
  for (const [name, code] of cases) {
    await page.evaluate(() => {
      const s = (window as any).__slc.getState();
      const id = s.history.present.screens[0].layers[0].id;
      s.setLayerAdjust(id, null);
      s.setLayerEffects(id, null);
    });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const w = window as any;
      w.__frames = [];
      let last = performance.now();
      const tick = () => { const n = performance.now(); w.__frames.push(n - last); last = n; w.__raf = requestAnimationFrame(tick); };
      w.__raf = requestAnimationFrame(tick);
    });
    const t0 = Date.now();
    await page.evaluate((c) => { const s = (window as any).__slc.getState(); const id = s.history.present.screens[0].layers[0].id; new Function("s", "id", c)(s, id); }, code);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); // the first frames after the change
    const firstPaintMs = Date.now() - t0;
    await page.waitForTimeout(7000);
    const frames = await page.evaluate(() => { cancelAnimationFrame((window as any).__raf); return (window as any).__frames as number[]; });
    report[name] = { firstPaintAfterApplyMs: firstPaintMs, longestFrameMs: Math.round(Math.max(...frames)), framesOver100ms: frames.filter((d) => d > 100).length };
  }
  console.log("ADJUST-EFFECTS-PERF " + JSON.stringify(report));
  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync(`test-results/adjust-effects-perf-${process.env.PW_PROD === "1" ? "prod" : "dev"}.json`, JSON.stringify(report, null, 1));
  expect((await editor(page)).layers).toHaveLength(1);
});