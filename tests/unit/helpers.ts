import { RawImage, createRawImage } from "@/lib/image/raw-image";
import { BitmapLayer, Project } from "@/lib/project/schema";

export const solid = (w: number, h: number, rgba: [number, number, number, number]): RawImage => createRawImage(w, h, rgba);

export const setPixel = (img: RawImage, x: number, y: number, rgba: [number, number, number, number]) => img.data.set(rgba, (y * img.width + x) * 4);
export const getPixel = (img: RawImage, x: number, y: number) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

export const makeLayer = (id: string, zIndex: number, over: Partial<BitmapLayer> = {}): BitmapLayer => ({
  id,
  name: `레이어 ${id}`,
  crop: { x: 0, y: 0, width: 10, height: 10 },
  imageId: `img-${id}`,
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  zIndex,
  opacity: 1,
  visible: true,
  locked: false,
  ...over,
});

export const makeProject = (layers: BitmapLayer[] = []): Project => ({
  id: "p1",
  name: "테스트",
  version: 4,
  canvas: { zoom: 2, panX: -40, panY: -20 },
  screens: [
    {
      id: "s1",
      name: "화면 1",
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
      source: { imageId: "src-1", fileName: "capture.png" },
      backgroundPatches: [{ id: "bp1", rect: { x: 10, y: 10, width: 100, height: 50 }, fill: "#f7f8fb" }],
      layers,
    },
  ],
});
