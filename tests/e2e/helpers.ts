import { Page, expect } from "@playwright/test";
import zlib from "node:zlib";

/* ---- a small PNG encoder, so tests can upload real files of any size ---- */

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

export type Rgba = [number, number, number, number];
export type Pixels = { width: number; height: number; data: Uint8Array };

export function fill(p: Pixels, x: number, y: number, w: number, h: number, c: Rgba) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) p.data.set(c, (j * p.width + i) * 4);
}
export const blank = (width: number, height: number, c: Rgba): Pixels => {
  const p = { width, height, data: new Uint8Array(width * height * 4) };
  fill(p, 0, 0, width, height, c);
  return p;
};

export function encodePng({ width, height, data }: Pixels): Buffer {
  const rows = Buffer.alloc((width * 4 + 1) * height); // filter type 0 on every row
  for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

export const readPngSize = (png: Buffer) => ({ signature: Array.from(png.subarray(0, 8)), width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

/* ---- fixtures ---- */

export const GRAY: Rgba = [240, 240, 240, 255];
export const BLUE: Rgba = [0, 0, 255, 255];
export const RED: Rgba = [255, 0, 0, 255];
export const PAGE = { width: 1200, height: 800 };
export const CARD = { x: 300, y: 200, width: 240, height: 120 };

/** 1200×800 gray page, a blue card with a red marker in its top-left corner, and a transparent 10×10 corner */
export const pageWithCard = () => {
  const p = blank(PAGE.width, PAGE.height, GRAY);
  fill(p, CARD.x, CARD.y, CARD.width, CARD.height, BLUE);
  fill(p, CARD.x, CARD.y, 20, 20, RED);
  fill(p, 0, 0, 10, 10, [0, 0, 0, 0]);
  return p;
};

/** 600×400, red on the left half and blue on the right: a selection across the middle has no single background */
export const splitPage = () => {
  const p = blank(600, 400, RED);
  fill(p, 300, 0, 300, 400, BLUE);
  return p;
};

/* ---- driving the app ---- */

export async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("viewport")).toBeVisible();
}

export async function upload(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.getByTestId("file-input").setInputFiles(file);
}

export const uploadPng = async (page: Page, pixels: Pixels, name = "capture.png") => {
  await upload(page, { name, mimeType: "image/png", buffer: encodePng(pixels) });
  await expect(page.getByTestId("screen-label")).toBeVisible();
};

/** everything the tests need to know about the editor, read from the page's own store */
export const editor = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__slc.getState();
    const screen = s.history?.present.screens[0] ?? null;
    return {
      view: s.view as { zoom: number; panX: number; panY: number },
      screen: screen && { x: screen.x, y: screen.y, width: screen.width, height: screen.height },
      layers: (screen?.layers ?? []) as { id: string; name: string; crop: { x: number; y: number; width: number; height: number }; transform: { x: number; y: number; scaleX: number; scaleY: number; rotation: number }; zIndex: number; imageId?: string; visible: boolean; locked: boolean; content?: any }[],
      patches: (screen?.backgroundPatches ?? []) as { rect: { x: number; y: number; width: number; height: number }; fill: string }[],
      past: (s.history?.past.length ?? 0) as number,
      selected: s.selectedLayerIds as string[],
      pending: !!s.pendingExtraction,
    };
  });

/** where an original-image pixel is on screen right now (client coordinates), computed from the live view */
export const clientOf = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([ix, iy]) => {
      const s = (window as any).__slc.getState();
      const box = document.querySelector('[data-testid="viewport"]')!.getBoundingClientRect();
      const screen = s.history.present.screens[0];
      return { x: box.left + s.view.panX + (screen.x + ix) * s.view.zoom, y: box.top + s.view.panY + (screen.y + iy) * s.view.zoom };
    },
    [x, y],
  );

/** zoom and pan so that image point (cx, cy) is in the middle of the canvas */
export const zoomTo = (page: Page, zoom: number, cx: number, cy: number) =>
  page.evaluate(
    ([z, x, y]) => {
      const st = (window as any).__slc.getState();
      const box = document.querySelector('[data-testid="viewport"]')!.getBoundingClientRect();
      const screen = st.history.present.screens[0];
      st.setView({ zoom: z, panX: box.width / 2 - (screen.x + x) * z, panY: box.height / 2 - (screen.y + y) * z });
    },
    [zoom, cx, cy],
  );

export async function dragImageRect(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, opts: { release?: boolean } = {}) {
  const a = await clientOf(page, from.x, from.y);
  const b = await clientOf(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  if (opts.release !== false) await page.mouse.up();
}

export const pickTool = (page: Page, name: "선택" | "이동" | "영역 추출" | "배경 채움" | "선" | "사각형" | "원" | "스포이트" | "브러시" | "지우개" | "텍스트" | "메모" | "자동 후보") => page.getByRole("button", { name, exact: true }).click();

/** the colour of one CSS pixel of what Konva actually painted */
export const konvaPixel = (page: Page, clientX: number, clientY: number) =>
  page.evaluate(
    ([cx, cy]) => {
      const canvas = document.querySelector(".konvajs-content canvas") as HTMLCanvasElement;
      const box = canvas.getBoundingClientRect();
      const scale = canvas.width / box.width; // backing-store pixels per CSS pixel: 1, or 2 at devicePixelRatio 2
      const d = canvas.getContext("2d")!.getImageData(Math.round((cx - box.left) * scale), Math.round((cy - box.top) * scale), 1, 1).data;
      return { rgba: Array.from(d), scale, cssWidth: box.width, backingWidth: canvas.width };
    },
    [clientX, clientY],
  );

/* ---- 5-B helpers ---- */

export const GREEN: Rgba = [0, 160, 0, 255];
export const CARD2 = { x: 700, y: 200, width: 200, height: 100 };

/** pageWithCard plus a second, green card to the right: two distinguishable layers */
export const pageWithTwoCards = () => {
  const p = pageWithCard();
  fill(p, CARD2.x, CARD2.y, CARD2.width, CARD2.height, GREEN);
  return p;
};

/** clicks "프로젝트 저장" and returns the downloaded file's text */
export async function saveProjectFile(page: Page): Promise<string> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "프로젝트 저장" }).click();
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/\.slc\.json$/);
  return (await import("node:fs")).readFileSync(await d.path(), "utf8");
}

export const openProjectFile = (page: Page, text: string, name = "mockup.slc.json") =>
  page.getByTestId("project-input").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(text) });

/** layer names as listed in the panel, front-most first */
export const panelNames = (page: Page) => page.getByTestId("layer-item").allInnerTexts().then((t) => t.map((s) => s.trim()));

/** the keys currently in the page's IndexedDB blob store */
export const idbKeys = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open("screenshot-layer-canvas");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction("blobs").objectStore("blobs").getAllKeys();
          req.onsuccess = () => {
            db.close();
            resolve(req.result.map(String));
          };
        };
      }),
  );

/** drags the layer whose centre is at image point `from` by (dx, dy) original pixels, at the current zoom */
export async function dragLayerBy(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  const a = await clientOf(page, from.x, from.y);
  const b = await clientOf(page, from.x + dx, from.y + dy);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

export const pixelAt = async (page: Page, x: number, y: number) => {
  const c = await clientOf(page, x, y);
  return (await konvaPixel(page, c.x, c.y)).rgba;
};

/** Konva repaints a frame after the store changes, so a pixel is polled instead of read once. */
export const expectPixel = (page: Page, x: number, y: number, rgba: number[]) =>
  expect.poll(() => pixelAt(page, x, y), { timeout: 5000, message: `pixel at image (${x}, ${y})` }).toEqual(rgba);

/* ---- a screenshot that looks like a real web app: gradient page, shadowed cards, buttons, text bars ---- */

export type CaptureRects = Record<string, { x: number; y: number; width: number; height: number }>;

/** Draws the capture in the browser (gradients and blurred shadows are the point) and returns it as a PNG with the
 *  rectangles of its parts, in original pixels. Layout scales with the image so any size works. */
export async function realisticCapture(page: Page, W: number, H: number): Promise<{ png: Buffer; rects: CaptureRects }> {
  const out = await page.evaluate(
    async ([W, H]) => {
      const u = H / 600; // one design unit in pixels
      const ox = Math.round((W - 960 * u) / 2); // content is centred when the image is wider than 960:600
      const c = new OffscreenCanvas(W, H);
      const g = c.getContext("2d")!;
      const px = (n: number) => Math.round(n * u);
      const R = (x: number, y: number, w: number, h: number) => ({ x: ox + px(x), y: px(y), width: px(w), height: px(h) });

      const bg = g.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, "#f4f6ff");
      bg.addColorStop(1, "#d3def8");
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);

      const box = (r: { x: number; y: number; width: number; height: number }, radius: number, fill: string, shadow?: [number, number, string]) => {
        g.save();
        if (shadow) {
          g.shadowBlur = px(shadow[0]);
          g.shadowOffsetY = px(shadow[1]);
          g.shadowColor = shadow[2];
        }
        g.fillStyle = fill;
        g.beginPath();
        g.roundRect(r.x, r.y, r.width, r.height, px(radius));
        g.fill();
        g.restore();
      };
      const bar = (x: number, y: number, w: number, h: number, fill = "#d5d9e2") => box(R(x, y, w, h), 5, fill);

      const rects: Record<string, { x: number; y: number; width: number; height: number }> = {};
      rects.header = { x: 0, y: 0, width: W, height: px(64) };
      g.save();
      g.shadowBlur = px(12);
      g.shadowOffsetY = px(2);
      g.shadowColor = "rgba(20,30,60,0.14)";
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, W, px(64));
      g.restore();
      box(R(24, 18, 28, 28), 14, "#4f5bd5");
      bar(66, 26, 90, 12, "#c9ced9");
      for (const x of [200, 270, 340]) bar(x, 28, 48, 9);

      const thumbs = ["#cfe9ee", "#f4dcd3", "#e3e1f7"];
      for (let i = 0; i < 3; i++) {
        const x = 60 + i * 300;
        rects[`card${i}`] = R(x, 110, 240, 220);
        box(rects[`card${i}`], 14, "#ffffff", [28, 10, "rgba(30,40,90,0.22)"]);
        box(R(x + 16, 126, 208, 90), 8, thumbs[i]);
        bar(x + 16, 232, 170, 10);
        bar(x + 16, 252, 112, 10);
        rects[`button${i}`] = R(x + 16, 288, 96, 30);
        box(rects[`button${i}`], 8, "#4f5bd5");
        bar(x + 36, 299, 56, 8, "#ffffff");
      }
      rects.thumb0 = R(76, 126, 208, 90);
      rects.textbar0 = R(76, 232, 170, 10);
      rects.wide = R(60, 380, 840, 170);
      box(rects.wide, 14, "#ffffff", [28, 10, "rgba(30,40,90,0.22)"]);
      for (let i = 0; i < 12; i++) bar(90 + i * 60, 520 - (30 + ((i * 37) % 90)), 36, 30 + ((i * 37) % 90), i % 3 === 0 ? "#4f5bd5" : "#c4c9f0");

      const bytes = new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer());
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { base64: btoa(s), rects };
    },
    [W, H],
  );
  return { png: Buffer.from(out.base64, "base64"), rects: out.rects as CaptureRects };
}

/* ---- 1.5-B helpers: where the resize / rotate handles are, and exporting ---- */

export type Placement = { x: number; y: number; scaleX: number; scaleY: number; rotation: number };

/** the first layer's placement and bitmap size, from the store */
export const firstLayer = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__slc.getState();
    const l = s.history.present.screens[0].layers[0];
    const raw = l.imageId ? s.images.get(l.imageId).raw : null; // a vector layer has no bitmap: its size is its box
    return { transform: l.transform as { x: number; y: number; scaleX: number; scaleY: number; rotation: number }, width: (l.content ? l.content.width : raw.width) as number, height: (l.content ? l.content.height : raw.height) as number, name: l.name as string };
  });

/** a bitmap point (in the layer's own pixels) → image pixels, by the same rule the app documents: T · R · S */
export const layerPointToImage = (t: Placement, p: { x: number; y: number }) => {
  const r = (t.rotation * Math.PI) / 180;
  const sx = p.x * t.scaleX;
  const sy = p.y * t.scaleY;
  return { x: t.x + Math.cos(r) * sx - Math.sin(r) * sy, y: t.y + Math.sin(r) * sx + Math.cos(r) * sy };
};

/** client position of a handle of the first layer: its four corners, or the rotate handle above the top edge */
export async function handleAt(page: Page, which: "tl" | "tr" | "br" | "bl" | "rotate") {
  const { transform: t, width, height } = await firstLayer(page);
  const toClient = async (p: { x: number; y: number }) => clientOf(page, p.x, p.y);
  const corner = { tl: { x: 0, y: 0 }, tr: { x: width, y: 0 }, br: { x: width, y: height }, bl: { x: 0, y: height } };
  if (which !== "rotate") return toClient(layerPointToImage(t, corner[which]));
  const [tl, tr, bl] = await Promise.all([toClient(layerPointToImage(t, corner.tl)), toClient(layerPointToImage(t, corner.tr)), toClient(layerPointToImage(t, corner.bl))]);
  const up = { x: tl.x - bl.x, y: tl.y - bl.y };
  const len = Math.hypot(up.x, up.y);
  const OFFSET = 26; // the app's rotateAnchorOffset, in screen pixels whatever the zoom
  return { x: (tl.x + tr.x) / 2 + (up.x / len) * OFFSET, y: (tl.y + tr.y) / 2 + (up.y / len) * OFFSET };
}

export async function dragClient(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

/** exports through the dialog; returns the downloaded PNG bytes */
export async function exportPngBytes(page: Page): Promise<Buffer> {
  await page.getByRole("button", { name: "PNG 내보내기" }).click();
  const download = page.waitForEvent("download");
  await page.getByTestId("export-save").click();
  const bytes = (await import("node:fs")).readFileSync(await (await download).path());
  await page.getByRole("button", { name: "닫기" }).click();
  return bytes;
}

/** RGBA of one pixel of a PNG, decoded by the browser */
export const pngPixelAt = (page: Page, png: Buffer, x: number, y: number) =>
  page.evaluate(
    async ([b64, px, py]) => {
      const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0))]), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
      const g = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d")!;
      g.drawImage(bmp, 0, 0);
      return Array.from(g.getImageData(px as number, py as number, 1, 1).data);
    },
    [png.toString("base64"), Math.round(x), Math.round(y)] as const,
  );

/** many pixels of what Konva painted, read in one round trip (a loop of konvaPixel calls is slow enough to time out under load) */
export const konvaPixels = (page: Page, points: { x: number; y: number }[], floor = false) =>
  page.evaluate(([pts, useFloor]) => {
    const canvas = document.querySelector(".konvajs-content canvas") as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    const scale = canvas.width / box.width;
    const g = canvas.getContext("2d")!;
    const at = (v: number) => (useFloor ? Math.floor(v + 1e-6) : Math.round(v));
    return pts.map(({ x, y }) => Array.from(g.getImageData(at((x - box.left) * scale), at((y - box.top) * scale), 1, 1).data));
  }, [points, floor] as const);

/* ---- temporary save ---- */

export const autosaveStatus = (page: Page) => page.getByTestId("autosave-status");

/** waits until the app has settled whether there is a saved copy to offer */
export const autosaveReady = (page: Page) => expect(autosaveStatus(page)).toHaveAttribute("data-ready", "yes");

/** when the last temporary save finished (ms since 1970; 0 = none yet) */
export const savedAtOf = async (page: Page) => Number(await autosaveStatus(page).getAttribute("data-saved-at"));

/** waits for a temporary save that finished after `after` (pass the value of savedAtOf from before the edit) */
export const waitForAutosave = async (page: Page, after = 0) => {
  await expect.poll(() => savedAtOf(page), { timeout: 15000, message: "a temporary save" }).toBeGreaterThan(after);
  await expect(autosaveStatus(page)).toHaveAttribute("data-saving", "no");
};

/** the stored temporary copy and the blobs, read straight from IndexedDB */
export const idbRecord = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open("screenshot-layer-canvas");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction("autosave").objectStore("autosave").get("current");
          req.onsuccess = () => (db.close(), resolve(req.result));
        };
      }),
  );

/** change what IndexedDB holds, the way a crash or another program might */
export const idbDo = (page: Page, store: "autosave" | "blobs", action: "put" | "delete", key: string, value?: unknown) =>
  page.evaluate(
    ([s, a, k, v]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("screenshot-layer-canvas");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(s as string, "readwrite");
          if (a === "put") tx.objectStore(s as string).put(v, k as string);
          else tx.objectStore(s as string).delete(k as string);
          tx.oncomplete = () => (db.close(), resolve());
        };
      }),
    [store, action, key, value] as const,
  );

/** Reloads the page and answers the "restore earlier work?" question with "discard" if it is asked, so a test can start from an
 *  empty editor. (A test that wants to restore reloads by itself.) */
export async function reloadAndDiscard(page: Page) {
  await page.reload();
  await autosaveReady(page);
  if ((await autosaveStatus(page).getAttribute("data-candidate")) === "yes") {
    await page.getByRole("button", { name: "버리기" }).click();
    await expect(page.getByTestId("restore-dialog")).toHaveCount(0);
  }
}

/* ---- Phase 2: drawing ---- */

/** the drawing style the editor holds (stroke, fill, width, eyedropper target) */
export const drawStyleOf = (page: Page) => page.evaluate(() => (window as any).__slc.getState().drawStyle as { stroke: string; fill: string | null; strokeWidth: number; pickTarget: string });

/** drags out a shape with a tool picked by name, between two image points */
export async function drawShape(page: Page, tool: "선" | "사각형" | "원", from: { x: number; y: number }, to: { x: number; y: number }) {
  await pickTool(page, tool);
  await dragImageRect(page, from, to);
}

/** sets a native colour input the way the picker does: input events while dragging, then a change event when it settles */
export async function setColorInput(page: Page, testId: string, hex: string, opts: { settle?: boolean } = {}) {
  await page.getByTestId(testId).evaluate(
    (el: HTMLInputElement, [value, settle]) => {
      el.value = value as string;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      if (settle) el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    [hex, opts.settle ?? true] as const,
  );
}

/** the RGBA of the frame's pixel as Konva painted it on screen, found from image coordinates (any zoom, any devicePixelRatio) */
export async function screenPixel(page: Page, x: number, y: number) {
  const c = await clientOf(page, x + 0.5, y + 0.5); // the middle of that image pixel
  // the canvas pixel that CONTAINS the point (floor): konvaPixel rounds, which at a pixel centre picks the next one along
  return (await konvaPixels(page, [c], true))[0];
}

/* ---- brush ---- */

/** drags the pointer along a path of image points with the brush or the eraser (the tool is picked first) */
export async function drawStroke(page: Page, tool: "브러시" | "지우개", points: { x: number; y: number }[], opts: { pick?: boolean } = {}) {
  if (opts.pick !== false) await pickTool(page, tool);
  const cs = await Promise.all(points.map((p) => clientOf(page, p.x, p.y)));
  await page.mouse.move(cs[0].x, cs[0].y);
  await page.mouse.down();
  for (const c of cs.slice(1)) await page.mouse.move(c.x, c.y, { steps: 6 });
  await page.mouse.up();
}

/** what the store knows about the first brush layer: where it is, how big its bitmap is, its image id */
export const brushLayer = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__slc.getState();
    const l = s.history.present.screens[0].layers.find((x: any) => x.drawn);
    if (!l) return null;
    const raw = s.images.get(l.imageId).raw;
    return { id: l.id as string, name: l.name as string, imageId: l.imageId as string, x: l.transform.x as number, y: l.transform.y as number, width: raw.width as number, height: raw.height as number, locked: l.locked as boolean };
  });

/** a fingerprint of the capture's pixels in memory, to prove painting never changes it */
export const sourceHash = (page: Page) =>
  page.evaluate(async () => {
    const s = (window as any).__slc.getState();
    const raw = s.images.get(s.history.present.screens[0].source.imageId).raw;
    const digest = await crypto.subtle.digest("SHA-256", raw.data);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  });
