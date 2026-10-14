import { Page, expect, test } from "@playwright/test";
import fs from "node:fs";
import { CARD, dragImageRect, editor, exportPngBytes, openApp, pageWithCard, pickTool, uploadPng, zoomTo } from "./helpers";

/* How closely the canvas and the exported PNG agree for a warped layer. Both draw the layer with the same function (rasterizeWarped); what
 * is compared here is everything around it: the placement on whole pixels, Konva's scaling at 100% and 200% and at devicePixelRatio 1 and 2. */

const quad = { kind: "quad", points: [{ x: 15, y: 6 }, { x: 236, y: 0 }, { x: 224, y: 118 }, { x: 0, y: 104 }] };
const mesh = (() => {
  const points: { x: number; y: number }[] = [];
  for (let j = 0; j <= 3; j++) for (let i = 0; i <= 3; i++) points.push({ x: (i * CARD.width) / 3, y: (j * CARD.height) / 3 });
  points[5] = { x: 92, y: 52 };
  points[6] = { x: 150, y: 30 };
  points[10] = { x: 160, y: 80 };
  return { kind: "mesh", cols: 3, rows: 3, points };
})();

type Stats = { pixels: number; max: number; mean: number; over2: number };

async function measure(page: Page, zoom: number, warp: unknown, rotation: number): Promise<Stats> {
  await openApp(page);
  await uploadPng(page, pageWithCard());
  await zoomTo(page, 1, 600, 300);
  await pickTool(page, "영역 추출");
  await dragImageRect(page, { x: CARD.x, y: CARD.y }, { x: CARD.x + CARD.width, y: CARD.y + CARD.height });
  await expect.poll(async () => (await editor(page)).layers.length).toBe(1);
  await page.evaluate(([w, rot, x, y]) => {
    const s = (window as any).__slc.getState();
    const id = s.selectedLayerIds[0];
    s.setLayerWarp(id, w);
    s.transformLayer(id, { x, y, scaleX: 1, scaleY: 1, rotation: rot });
    s.selectLayer(null);
    // whole-number pan, so a frame pixel is a whole number of screen pixels
    s.setView({ zoom: 1, panX: 0, panY: 0 });
  }, [warp, rotation, CARD.x, CARD.y] as const);
  const png = await exportPngBytes(page);
  const stats = await page.evaluate(async ([b64, z]) => {
    const st = (window as any).__slc.getState();
    const screen = st.history.present.screens[0];
    const layer = screen.layers[0];
    const box = document.querySelector('[data-testid="viewport"]')!.getBoundingClientRect();
    // the region to compare: the layer's bounding box in the frame, padded
    const t = layer.transform, r = (t.rotation * Math.PI) / 180;
    const pts = (layer.warp.kind === "quad" ? layer.warp.points : [layer.warp.points[0], layer.warp.points[3], layer.warp.points[15], layer.warp.points[12]]).map((p: any) => ({ x: t.x + Math.cos(r) * p.x * t.scaleX - Math.sin(r) * p.y * t.scaleY, y: t.y + Math.sin(r) * p.x * t.scaleX + Math.cos(r) * p.y * t.scaleY }));
    const x0 = Math.floor(Math.min(...pts.map((p: any) => p.x))) - 6, x1 = Math.ceil(Math.max(...pts.map((p: any) => p.x))) + 6;
    const y0 = Math.floor(Math.min(...pts.map((p: any) => p.y))) - 6, y1 = Math.ceil(Math.max(...pts.map((p: any) => p.y))) + 6;
    // put the region's corner 8 screen pixels in from the canvas corner
    st.setView({ zoom: z, panX: 8 - x0 * (z as number), panY: 8 - y0 * (z as number) });
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    await new Promise((res) => setTimeout(res, 200));
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0))]), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
    const pg = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d")!;
    pg.drawImage(bmp, 0, 0);
    const exp = pg.getImageData(0, 0, bmp.width, bmp.height).data;
    const canvas = document.querySelector(".konvajs-content canvas") as HTMLCanvasElement;
    const cbox = canvas.getBoundingClientRect();
    const scale = canvas.width / cbox.width;
    const shot = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    let max = 0, sum = 0, over2 = 0, n = 0;
    const zz = z as number;
    const view = (window as any).__slc.getState().view; // read again: setView changed it
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const cx = box.left + view.panX + (screen.x + x + 0.5) * zz, cy = box.top + view.panY + (screen.y + y + 0.5) * zz;
        const bx = Math.floor((cx - cbox.left) * scale), by = Math.floor((cy - cbox.top) * scale);
        if (bx < 0 || by < 0 || bx >= canvas.width || by >= canvas.height) continue;
        for (let k = 0; k < 3; k++) {
          const d = Math.abs(shot.data[(by * canvas.width + bx) * 4 + k] - exp[(y * bmp.width + x) * 4 + k]);
          max = Math.max(max, d);
          sum += d;
          if (d > 2) over2++;
          n++;
        }
      }
    }
    return { pixels: n / 3, max, mean: sum / n, over2 };
  }, [png.toString("base64"), zoom] as const);
  return stats;
}

const results: Record<string, Stats> = {};
test.afterAll(() => {
  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync(`test-results/warp-parity-${process.env.PW_PROD === "1" ? "prod" : "dev"}-${results.__dpr ?? ""}.json`, JSON.stringify(results, null, 1));
});

for (const dpr of [1, 2]) {
  test.describe(`screen vs PNG, devicePixelRatio ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });
    for (const zoom of [1, 2]) {
      for (const rotation of [0, 30]) {
        for (const [name, warp] of [["quad", quad], ["mesh", mesh]] as const) {
          test(`${name} warp, zoom ${zoom * 100}%, rotation ${rotation}°`, async ({ page }) => {
            const s = await measure(page, zoom, warp, rotation);
            results[`dpr${dpr} zoom${zoom * 100} rot${rotation} ${name}`] = s;
            console.log(`PARITY dpr${dpr} zoom${zoom * 100} rot${rotation} ${name}: ${JSON.stringify(s)}`);
            expect(s.pixels).toBeGreaterThan(20000);
            expect(s.max).toBeLessThanOrEqual(2);
          });
        }
      }
    }
  });
}