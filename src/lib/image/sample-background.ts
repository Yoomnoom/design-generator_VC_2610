import { Rect } from "../project/schema";
import { Rgb, rgbToHex } from "./color";
import { RawImage } from "./raw-image";

export const DEFAULT_RING_WIDTH = 3; // px outside the selection, allowed 1–5
export const COLOR_TOLERANCE = 12; // largest channel difference still counted as "the same colour"
export const MAX_OUTLIER_RATIO = 0.2; // above this share of off-colour samples the user must choose
export const MODE_MIN_SHARE = 0.5; // below this share the most frequent colour is not representative, use the median

export type BackgroundSample = {
  /** "needs-user-color": do not auto-fill, ask the user. `color` is still the best guess, to prefill the picker. */
  status: "ok" | "needs-user-color";
  color: Rgb | null; // null only when the selection leaves no pixels around it
  hex: string | null;
  method: "mode" | "median" | null;
  outlierRatio: number;
  sampleCount: number;
};

/** the pixels in a ring outside `rect`, clipped to the image, as four bands so cost follows the perimeter */
function ringSamples(img: RawImage, rect: Rect, ring: number): Rgb[] {
  const x0 = Math.max(rect.x - ring, 0), x1 = Math.min(rect.x + rect.width + ring, img.width);
  const y0 = Math.max(rect.y - ring, 0), y1 = Math.min(rect.y + rect.height + ring, img.height);
  const top = Math.max(rect.y, 0), bottom = Math.min(rect.y + rect.height, img.height);
  const bands: [number, number, number, number][] = [
    [x0, x1, y0, top], // above
    [x0, x1, bottom, y1], // below
    [x0, Math.max(rect.x, 0), top, bottom], // left
    [Math.min(rect.x + rect.width, img.width), x1, top, bottom], // right
  ];
  const out: Rgb[] = [];
  for (const [bx0, bx1, by0, by1] of bands)
    for (let y = by0; y < by1; y++)
      for (let x = bx0; x < bx1; x++) {
        const i = (y * img.width + x) * 4;
        out.push({ r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] });
      }
  return out;
}

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export function sampleBackground(img: RawImage, rect: Rect, ringWidth = DEFAULT_RING_WIDTH): BackgroundSample {
  const ring = Math.min(Math.max(Math.round(ringWidth), 1), 5);
  const samples = ringSamples(img, rect, ring);
  if (samples.length === 0) return { status: "needs-user-color", color: null, hex: null, method: null, outlierRatio: 1, sampleCount: 0 };

  const counts = new Map<number, number>();
  for (const s of samples) {
    const key = (s.r << 16) | (s.g << 8) | s.b;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let modeKey = 0, modeCount = 0;
  for (const [key, count] of counts) {
    if (count > modeCount) {
      modeKey = key;
      modeCount = count;
    }
  }

  const useMode = modeCount / samples.length >= MODE_MIN_SHARE;
  const color: Rgb = useMode
    ? { r: (modeKey >> 16) & 255, g: (modeKey >> 8) & 255, b: modeKey & 255 }
    : { r: median(samples.map((s) => s.r)), g: median(samples.map((s) => s.g)), b: median(samples.map((s) => s.b)) };

  const outliers = samples.filter((s) => Math.max(Math.abs(s.r - color.r), Math.abs(s.g - color.g), Math.abs(s.b - color.b)) > COLOR_TOLERANCE).length;
  const outlierRatio = outliers / samples.length;
  return {
    status: outlierRatio > MAX_OUTLIER_RATIO ? "needs-user-color" : "ok",
    color,
    hex: rgbToHex(color),
    method: useMode ? "mode" : "median",
    outlierRatio,
    sampleCount: samples.length,
  };
}
