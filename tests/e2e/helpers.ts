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
      layers: (screen?.layers ?? []) as { id: string; name: string; crop: { x: number; y: number; width: number; height: number }; transform: { x: number; y: number }; zIndex: number }[],
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

export const pickTool = (page: Page, name: "선택" | "이동" | "영역 추출") => page.getByRole("button", { name, exact: true }).click();

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
