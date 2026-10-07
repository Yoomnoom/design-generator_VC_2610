import { ImageCodec } from "./codec";
import { RawImage } from "./raw-image";

/** Browser implementation of ImageCodec. Browser-only: not covered by the Node unit tests. */
export const canvasCodec: ImageCodec = {
  async encode(raw) {
    const canvas = new OffscreenCanvas(raw.width, raw.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas is not available");
    ctx.putImageData(new ImageData(new Uint8ClampedArray(raw.data), raw.width, raw.height), 0, 0);
    return canvas.convertToBlob({ type: "image/png" });
  },

  async decode(blob): Promise<RawImage> {
    // 'from-image' applies EXIF rotation, so the size seen here is the size the user sees
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image", premultiplyAlpha: "none", colorSpaceConversion: "none" });
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("2D canvas is not available");
      ctx.drawImage(bitmap, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      return { width, height, data };
    } finally {
      bitmap.close();
    }
  },
};
