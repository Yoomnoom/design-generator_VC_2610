import { expect, test } from "@playwright/test";
import { blank, encodePng, fill, openApp, upload, zoomTo } from "./helpers";

/* Measures (PW_PERF=1): the image adjustments of a 3600 x 2700 original, applied in a Web Worker. The longest frame while it runs says
 * whether the editor stays usable; the heap says what the kept uploaded picture and the new one cost. */
test.skip(process.env.PW_PERF !== "1", "measurement only: PW_PERF=1");
test.setTimeout(240_000);

test("original adjustments at 3600 x 2700: time, longest frame, memory", async ({ page }) => {
  await openApp(page);
  const p = blank(3600, 2700, [240, 240, 240, 255]);
  fill(p, 300, 200, 3000, 2200, [30, 90, 200, 255]);
  fill(p, 300, 200, 400, 300, [255, 0, 0, 255]);
  await upload(page, { name: "big.png", mimeType: "image/png", buffer: encodePng(p) });
  await expect(page.getByTestId("screen-label")).toBeVisible();
  await zoomTo(page, 0.15, 1800, 1350);
  await page.getByTestId("source-lock").click();
  await page.getByTestId("source-item").click();
  await page.getByTestId("source-adjust").locator("summary").click();
  const heap = () => page.evaluate(() => Math.round(((performance as any).memory?.usedJSHeapSize ?? 0) / 1048576));
  const report: Record<string, unknown> = { heapBeforeMB: await heap() };
  for (const [name, key, value] of [["colour (brightness 30)", "brightness", "30"], ["blur 20", "blur", "20"]] as const) {
    const t0 = Date.now();
    await page.getByTestId(`src-adj-${key}`).fill(value);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const previewMs = Date.now() - t0;
    await page.evaluate(() => {
      const w = window as any;
      w.__frames = [];
      let last = performance.now();
      const tick = () => { const n = performance.now(); w.__frames.push(n - last); last = n; w.__raf = requestAnimationFrame(tick); };
      w.__raf = requestAnimationFrame(tick);
    });
    const t1 = Date.now();
    await page.getByTestId("src-adj-apply").click();
    await expect(page.getByTestId("source-message")).toContainText("원본에 적용했습니다", { timeout: 120_000 });
    const applyMs = Date.now() - t1;
    const frames = await page.evaluate(() => { const w = window as any; cancelAnimationFrame(w.__raf); return w.__frames as number[]; });
    const slow = frames.filter((f) => f > 100).length;
    report[name] = { previewMs, applyMs, workerText: await page.getByTestId("source-message").innerText(), frames: frames.length, longestFrameMs: Math.round(Math.max(...frames)), framesOver100ms: slow, heapAfterMB: await heap() };
  }
  console.log("MEASURE source adjust 3600x2700", JSON.stringify(report));
  expect(report).toBeTruthy();
});
