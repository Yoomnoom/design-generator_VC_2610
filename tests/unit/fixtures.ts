import { ImageCodec } from "@/lib/image/codec";
import { RawImage } from "@/lib/image/raw-image";
import { createEditorStore } from "@/store/editor-store";
import { setPixel, solid } from "./helpers";

/** Stand-in for the browser codec: a 8-byte size header followed by the raw RGBA bytes. Lossless, so tests can compare pixels. */
export const fakeCodec = (): ImageCodec & { encodeCalls: number } => ({
  encodeCalls: 0,
  async encode(raw) {
    this.encodeCalls++;
    const bytes = new Uint8Array(8 + raw.data.length);
    new DataView(bytes.buffer).setUint32(0, raw.width);
    new DataView(bytes.buffer).setUint32(4, raw.height);
    bytes.set(raw.data, 8);
    return new Blob([bytes], { type: "image/png" });
  },
  async decode(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length < 8) throw new Error("not an image");
    const view = new DataView(bytes.buffer);
    const [width, height] = [view.getUint32(0), view.getUint32(4)];
    if (bytes.length !== 8 + width * height * 4) throw new Error("corrupt image");
    return { width, height, data: new Uint8ClampedArray(bytes.slice(8)) };
  },
});

export const sequentialIds = () => {
  let n = 0;
  return () => `id${++n}`;
};

export const GRAY: [number, number, number, number] = [240, 240, 240, 255];
export const BLUE: [number, number, number, number] = [0, 0, 255, 255];

/** 60×40 flat gray page with a blue "card" at (10,10) sized 20×10 */
export const pageWithCard = (): RawImage => {
  const img = solid(60, 40, GRAY);
  for (let y = 10; y < 20; y++) for (let x = 10; x < 30; x++) setPixel(img, x, y, BLUE);
  return img;
};

/** 40×30 image split red | blue down the middle: any selection across the seam has no single background */
export const splitPage = (): RawImage => {
  const img = solid(40, 30, [255, 0, 0, 255]);
  for (let y = 0; y < 30; y++) for (let x = 20; x < 40; x++) setPixel(img, x, y, BLUE);
  return img;
};

export const CARD = { x: 10, y: 10, width: 20, height: 10 };

export function storeWith(raw: RawImage = pageWithCard(), fileName = "capture.png") {
  const store = createEditorStore({ genId: sequentialIds() });
  store.getState().newProject({ fileName, raw });
  return { store, get: () => store.getState(), layers: () => store.getState().history!.present.screens[0].layers, patches: () => store.getState().history!.present.screens[0].backgroundPatches };
}

export const committedId = (r: { status: string; layerId?: string }) => {
  if (r.status !== "committed" || !r.layerId) throw new Error(`expected a committed extraction, got ${r.status}`);
  return r.layerId;
};
