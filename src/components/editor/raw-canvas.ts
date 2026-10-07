import { RawImage } from "@/lib/image/raw-image";

const cache = new WeakMap<RawImage, HTMLCanvasElement>();

/** A canvas holding the image at 1:1, for Konva to draw. Display only; export never reads these. */
export function rawToCanvas(raw: RawImage): HTMLCanvasElement {
  let canvas = cache.get(raw);
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = raw.width;
    canvas.height = raw.height;
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(raw.data), raw.width, raw.height), 0, 0);
    cache.set(raw, canvas);
  }
  return canvas;
}
