import { Rect } from "../project/schema";
import { Rgb, rgbToHex } from "./color";
import { RawImage } from "./raw-image";

export const DEFAULT_RING_WIDTH = 3; // px just outside the selection (the "near" ring), allowed 1–5
export const COLOR_TOLERANCE = 12; // largest channel difference still counted as "the same colour"
export const MAX_OUTLIER_RATIO = 0.2; // above this share of off-colour samples a ring is not one colour
export const MODE_MIN_SHARE = 0.5; // below this share the most frequent colour is not representative, use the median

/** The far ring, 12–24px outside the selection. A shadow or glow hugging the selection fades out before this. */
export const FAR_RING_FROM = 12;
export const FAR_RING_TO = 24;
/** If the near and far rings are each one colour but differ by more than this, the near ring is inside a shadow/gradient edge. */
export const NEAR_FAR_TOLERANCE = 8;
/** The band the picker's suggested colour is taken from: further out than a typical shadow reaches. */
export const SUGGEST_RING_FROM = 32;
export const SUGGEST_RING_TO = 48;
/** A band with fewer pixels than this (image edge, small image) is too thin to judge by. */
export const MIN_BAND_SAMPLES = 40;

export type SampleReason = "ok" | "mixed-ring" | "near-far-mismatch" | "no-samples";

export type BackgroundSample = {
  /** "needs-user-color": do not auto-fill, ask the user. */
  status: "ok" | "needs-user-color";
  reason: SampleReason;
  color: Rgb | null; // the near ring's colour; null only when the selection leaves no pixels around it
  hex: string | null;
  method: "mode" | "median" | null;
  outlierRatio: number; // of the near ring
  sampleCount: number; // of the near ring
  farHex: string | null; // the far ring's colour, when that ring was usable
  nearFarDistance: number | null; // how far apart the two rings are, when both were usable
  /** The colour to start the picker with: taken from outside the shadow when there is room, otherwise the near ring's. */
  suggestedHex: string | null;
};

type Representative = { color: Rgb; method: "mode" | "median"; outlierRatio: number; count: number };

/** the pixels whose distance outside `rect` is more than `from` and at most `to`, clipped to the image */
function bandSamples(img: RawImage, rect: Rect, from: number, to: number): Rgb[] {
  const outer = { x0: Math.max(rect.x - to, 0), x1: Math.min(rect.x + rect.width + to, img.width), y0: Math.max(rect.y - to, 0), y1: Math.min(rect.y + rect.height + to, img.height) };
  const inner = { x0: rect.x - from, x1: rect.x + rect.width + from, y0: rect.y - from, y1: rect.y + rect.height + from };
  const out: Rgb[] = [];
  const take = (y: number, xa: number, xb: number) => {
    for (let x = xa; x < xb; x++) {
      const i = (y * img.width + x) * 4;
      out.push({ r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] });
    }
  };
  for (let y = outer.y0; y < outer.y1; y++) {
    if (y < inner.y0 || y >= inner.y1) take(y, outer.x0, outer.x1);
    else {
      take(y, outer.x0, Math.min(outer.x1, inner.x0));
      take(y, Math.max(outer.x0, inner.x1), outer.x1);
    }
  }
  return out;
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
export const colorDistance = (a: Rgb, b: Rgb) => Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));

/** The one colour a set of samples stands for: the most frequent when it dominates, otherwise the median. */
function represent(samples: Rgb[]): Representative | null {
  if (samples.length === 0) return null;
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
  const outliers = samples.filter((s) => colorDistance(s, color) > COLOR_TOLERANCE).length;
  return { color, method: useMode ? "mode" : "median", outlierRatio: outliers / samples.length, count: samples.length };
}

export function sampleBackground(img: RawImage, rect: Rect, ringWidth = DEFAULT_RING_WIDTH): BackgroundSample {
  const ring = Math.min(Math.max(Math.round(ringWidth), 1), 5);
  const near = represent(bandSamples(img, rect, 0, ring));
  if (!near) return { status: "needs-user-color", reason: "no-samples", color: null, hex: null, method: null, outlierRatio: 1, sampleCount: 0, farHex: null, nearFarDistance: null, suggestedHex: null };

  const usable = (r: Representative | null) => (r && r.count >= MIN_BAND_SAMPLES ? r : null);
  const far = usable(represent(bandSamples(img, rect, FAR_RING_FROM, FAR_RING_TO)));
  // A far ring that is itself a mix (it crosses the edge of a card, say) says nothing about the background, so it is not used.
  const farOneColour = far && far.outlierRatio <= MAX_OUTLIER_RATIO ? far : null;
  const nearFarDistance = farOneColour ? colorDistance(near.color, farOneColour.color) : null;

  // The outermost band that is a single colour, so a neighbouring card or the header does not become the suggestion;
  // if none is, the outermost one there is.
  const outer = usable(represent(bandSamples(img, rect, SUGGEST_RING_FROM, SUGGEST_RING_TO)));
  const bands = [outer, far, near];
  const suggestion = bands.find((b) => b && b.outlierRatio <= MAX_OUTLIER_RATIO) ?? outer ?? far ?? near;

  const reason: SampleReason = near.outlierRatio > MAX_OUTLIER_RATIO ? "mixed-ring" : nearFarDistance !== null && nearFarDistance > NEAR_FAR_TOLERANCE ? "near-far-mismatch" : "ok";
  return {
    status: reason === "ok" ? "ok" : "needs-user-color",
    reason,
    color: near.color,
    hex: rgbToHex(near.color),
    method: near.method,
    outlierRatio: near.outlierRatio,
    sampleCount: near.count,
    farHex: farOneColour ? rgbToHex(farOneColour.color) : null,
    nearFarDistance,
    suggestedHex: rgbToHex(suggestion.color),
  };
}
