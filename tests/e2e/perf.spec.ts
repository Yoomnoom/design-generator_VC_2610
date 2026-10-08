import { expect, test } from "@playwright/test";
import { openApp, realisticCapture } from "./helpers";

/* Measurements, not pass/fail checks: run with PW_PERF=1.
 * PRD §13 targets: editable within 2 s of upload (1920×1080), dragging at 30 fps or better.
 * Numbers come from headless Chromium with software rendering, so they say little about a real GPU. */
test.skip(process.env.PW_PERF !== "1", "measurement only: set PW_PERF=1");
test.setTimeout(180_000);

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

test("1920×1080: time from choosing the file until the image is on screen and fitted", async ({ page }) => {
  await openApp(page);
  const { png } = await realisticCapture(page, 1920, 1080);
  const b64 = png.toString("base64");
  const times: number[] = [];

  for (let rep = 0; rep < 5; rep++) {
    await page.goto("/"); // a fresh page each time: cold, as a user would hit it
    await expect(page.getByTestId("viewport")).toBeVisible();
    await page.waitForTimeout(500);
    const ms = await page.evaluate(async (data) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const input = document.querySelector('[data-testid="file-input"]') as HTMLInputElement;
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], "perf.png", { type: "image/png" }));
      const t0 = performance.now();
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return new Promise<number>((resolve) => {
        const tick = () => {
          const s = (window as any).__slc.getState();
          const cv = document.querySelector(".konvajs-content canvas") as HTMLCanvasElement | null;
          if (s.history && !s.needsFit && cv) {
            const box = cv.getBoundingClientRect();
            const k = cv.width / box.width;
            const px = cv.getContext("2d")!.getImageData(Math.floor((box.width / 2) * k), Math.floor((box.height / 2) * k), 1, 1).data;
            if (px[3] > 0) return resolve(performance.now() - t0); // the frame is painted in the middle of the canvas
          }
          requestAnimationFrame(tick);
        };
        tick();
      });
    }, b64);
    times.push(Math.round(ms));
  }
  console.log(`PERF upload→editable (1920×1080 PNG ${(png.length / 1024).toFixed(0)} KB), 5 cold runs, ms: ${times.join(", ")}  median ${median(times)}  max ${Math.max(...times)}`);
  test.info().annotations.push({ type: "upload-to-editable-ms", description: times.join(",") });
});

test("1920×1080 with 5 layers: frame rate while dragging a layer", async ({ page }) => {
  await openApp(page);
  const { png, rects } = await realisticCapture(page, 1920, 1080);
  await page.getByTestId("file-input").setInputFiles({ name: "perf.png", mimeType: "image/png", buffer: png });
  await expect(page.getByTestId("screen-label")).toBeVisible();

  // five layers made through the store (the extraction itself is covered elsewhere); a colour question is answered with its suggestion
  const made = await page.evaluate((r) => {
    const st = (window as any).__slc.getState();
    for (const key of ["card0", "card1", "card2", "button0", "wide"]) {
      const res = st.beginExtraction(r[key]);
      if (res.status === "needs-color") st.confirmExtraction(res.suggestedHex ?? "#ffffff");
    }
    return (window as any).__slc.getState().history.present.screens[0].layers.length;
  }, rects);
  expect(made).toBe(5);

  const frames = await page.evaluate(async () => {
    const idle = await new Promise<number[]>((resolve) => {
      const ts: number[] = [];
      const t0 = performance.now();
      const tick = (t: number) => (ts.push(t), t - t0 < 1000 ? requestAnimationFrame(tick) : resolve(ts));
      requestAnimationFrame(tick);
    });
    (window as any).__idle = idle;
    return idle.length;
  });
  expect(frames).toBeGreaterThan(10);

  // grab the wide chart layer (the biggest) and drag it round for ~2 seconds
  const wide = rects.wide;
  const from = await page.evaluate(
    ([x, y]) => {
      const s = (window as any).__slc.getState();
      const box = document.querySelector('[data-testid="viewport"]')!.getBoundingClientRect();
      return { x: box.left + s.view.panX + x * s.view.zoom, y: box.top + s.view.panY + y * s.view.zoom };
    },
    [wide.x + wide.width / 2, wide.y + wide.height / 2],
  );
  await page.evaluate(() => {
    const rec = ((window as any).__rec = { t: [] as number[], run: true });
    const tick = (t: number) => (rec.t.push(t), rec.run && requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  let dragging = false;
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * Math.PI * 2;
    await page.mouse.move(from.x + Math.sin(a) * 80, from.y + (1 - Math.cos(a)) * 40);
    await page.waitForTimeout(8);
    if (i === 90) dragging = await page.evaluate(() => (window as any).__slc.getState().dragPreview !== null); // halfway round: a drag is under way
  }
  await page.mouse.up();
  const stats = await page.evaluate(() => {
    const rec = (window as any).__rec;
    rec.run = false;
    const gaps = rec.t.slice(1).map((t: number, i: number) => t - rec.t[i]).filter((g: number) => g > 0);
    const idle: number[] = (window as any).__idle;
    const idleGaps = idle.slice(1).map((t, i) => t - idle[i]);
    const sorted = [...gaps].sort((a, b) => a - b);
    const total = rec.t[rec.t.length - 1] - rec.t[0];
    return {
      frames: gaps.length,
      seconds: +(total / 1000).toFixed(2),
      fps: +(gaps.length / (total / 1000)).toFixed(1),
      p95ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
      maxMs: +sorted[sorted.length - 1].toFixed(1),
      over33: gaps.filter((g: number) => g > 33.4).length,
      idleFps: +(idleGaps.length / ((idle[idle.length - 1] - idle[0]) / 1000)).toFixed(1),
      history: (window as any).__slc.getState().history.past.length,
    };
  });
  console.log(`PERF drag, 5 layers on 1920×1080: ${JSON.stringify(stats)}`);
  test.info().annotations.push({ type: "drag-fps", description: JSON.stringify(stats) });
  expect(dragging).toBe(true);
  // 5 extractions, and the drag when it moved the layer: the path ends where it began, and with snapping on (the default, and what is measured) the
  // layer's own starting place is a line it is pulled back onto, so the drop may be a no-op that records nothing
  expect(stats.history).toBeGreaterThanOrEqual(5);
  expect(stats.history).toBeLessThanOrEqual(6);
});
