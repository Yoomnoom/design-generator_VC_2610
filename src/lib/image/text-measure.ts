import { TextContent } from "../project/schema";
import { Measure, fontOf, layoutText } from "./text-layout";

/* How wide a string is at a font size. In the browser this asks a canvas, the same engine that later draws the text, so a box measured
 * here holds the text drawn there. Where there is no canvas (the unit tests, which run in Node) it falls back to a fixed estimate: wide
 * characters (Korean, Chinese, Japanese, emoji) one font size wide, the rest 0.55 of it. The estimate is deterministic, so tests can
 * rely on it, but it is only an estimate; the layout tests inject their own measure. */

export type MeasureFor = (fontSize: number) => Measure;

const isWide = (cp: number) => (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x2e80 && cp <= 0xd7ff) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xffef) || cp >= 0x1f000;

/** the fixed estimate used without a canvas */
export const estimateMeasure: MeasureFor = (fontSize) => (text) => {
  let w = 0;
  for (const ch of text) w += (isWide(ch.codePointAt(0)!) ? 1 : 0.55) * fontSize;
  return Math.round(w * 100) / 100;
};

let shared: { measureText(t: string): { width: number }; font: string } | null | undefined;
const sharedContext = () => {
  if (shared !== undefined) return shared;
  try {
    if (typeof OffscreenCanvas !== "undefined") shared = new OffscreenCanvas(1, 1).getContext("2d");
    else if (typeof document !== "undefined") shared = document.createElement("canvas").getContext("2d");
    else shared = null;
  } catch {
    shared = null;
  }
  return shared;
};

/** the canvas's own measure when there is a canvas, else the estimate */
export const canvasMeasureFor: MeasureFor = (fontSize) => {
  const ctx = sharedContext();
  if (!ctx) return estimateMeasure(fontSize);
  return (text) => {
    ctx.font = fontOf(fontSize);
    return ctx.measureText(text).width;
  };
};

/** how tall a text box has to be for its words at its current width and font size */
export const fitHeight = (c: Pick<TextContent, "text" | "width" | "fontSize" | "align">, measureFor: MeasureFor): number => layoutText(c, measureFor(c.fontSize)).height;
