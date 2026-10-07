/** Pixel buffer shaped like ImageData, so the image logic runs without a canvas. RGBA, 8 bits, non-premultiplied. */
export type RawImage = { width: number; height: number; data: Uint8ClampedArray };

export const createRawImage = (width: number, height: number, rgba: [number, number, number, number] = [0, 0, 0, 0]): RawImage => {
  const data = new Uint8ClampedArray(width * height * 4);
  if (rgba.some((v) => v !== 0)) for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width, height, data };
};

export const pixelOffset = (img: RawImage, x: number, y: number) => (y * img.width + x) * 4;
