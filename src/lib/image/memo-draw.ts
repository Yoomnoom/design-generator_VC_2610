import { Memo, Rect } from "../project/schema";
import { RawImage } from "./raw-image";
import { Measure, TEXT_FONT_FAMILY, wrapText } from "./text-layout";
import { DrawCtx } from "./vector";

/* How a memo looks in an exported PNG: a numbered red pin on its point, and, when it has words, a balloon beside it. Sizes are in image
 * pixels (a memo is a mark on the picture, not something that scales with the editor's zoom). The editor shows memos with HTML; this is
 * only for the export. All of it is plain geometry plus one drawing function, so it can be tested without a canvas. */

export const PIN_RADIUS = 12;
export const BALLOON_MAX_WIDTH = 220;
export const BALLOON_PADDING = 8;
export const BALLOON_FONT_SIZE = 14;
export const BALLOON_LINE_HEIGHT = 18;
export const PIN_COLOR = "#e5322d";
export const BALLOON_FILL = "#fffbe6";
export const BALLOON_TEXT = "#222222";
const BORDER = 2;

export const balloonFont = `${BALLOON_FONT_SIZE}px ${TEXT_FONT_FAMILY}`;
const pinFont = `bold 13px ${TEXT_FONT_FAMILY}`;

export type MemoLayout = {
  /** the whole thing, whole pixels, inside the frame: the pin and the balloon */
  bounds: Rect;
  balloon: (Rect & { lines: string[] }) | null;
};

/** Where a memo's pin and balloon go in a frame. The balloon sits to the right of the pin, or is pushed back inside the frame. */
export function layoutMemo(memo: Memo, frame: { width: number; height: number }, measure: Measure): MemoLayout {
  const pin = { x: memo.x - PIN_RADIUS - BORDER, y: memo.y - PIN_RADIUS - BORDER, width: 2 * (PIN_RADIUS + BORDER), height: 2 * (PIN_RADIUS + BORDER) };
  let balloon: MemoLayout["balloon"] = null;
  if (memo.text.trim() !== "") {
    const lines = wrapText(memo.text, BALLOON_MAX_WIDTH - 2 * BALLOON_PADDING, measure);
    const width = Math.min(BALLOON_MAX_WIDTH, Math.ceil(Math.max(...lines.map(measure))) + 2 * BALLOON_PADDING);
    const height = lines.length * BALLOON_LINE_HEIGHT + 2 * BALLOON_PADDING;
    const x = Math.round(Math.min(Math.max(memo.x + PIN_RADIUS + 6, 0), Math.max(0, frame.width - width)));
    const y = Math.round(Math.min(Math.max(memo.y - PIN_RADIUS, 0), Math.max(0, frame.height - height)));
    balloon = { x, y, width, height, lines };
  }
  const parts = balloon ? [pin, balloon] : [pin];
  const x0 = Math.max(0, Math.floor(Math.min(...parts.map((r) => r.x))));
  const y0 = Math.max(0, Math.floor(Math.min(...parts.map((r) => r.y))));
  const x1 = Math.min(frame.width, Math.ceil(Math.max(...parts.map((r) => r.x + r.width))) + BORDER);
  const y1 = Math.min(frame.height, Math.ceil(Math.max(...parts.map((r) => r.y + r.height))) + BORDER);
  return { bounds: { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) }, balloon };
}

/** Draws one memo; (ox, oy) is the frame point that sits at the context's origin (the top-left of the memo's own small bitmap). */
export function drawMemo(ctx: DrawCtx, memo: Memo, index: number, layout: MemoLayout, ox: number, oy: number): void {
  if (layout.balloon) {
    const b = layout.balloon;
    ctx.beginPath();
    ctx.rect(b.x - ox, b.y - oy, b.width, b.height);
    ctx.fillStyle = BALLOON_FILL;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = PIN_COLOR;
    ctx.stroke();
    ctx.font = balloonFont;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = BALLOON_TEXT;
    b.lines.forEach((line, i) => {
      if (line !== "") ctx.fillText(line, b.x - ox + BALLOON_PADDING, b.y - oy + BALLOON_PADDING + i * BALLOON_LINE_HEIGHT + (BALLOON_LINE_HEIGHT - BALLOON_FONT_SIZE) / 2);
    });
  }
  ctx.beginPath();
  ctx.ellipse(memo.x - ox, memo.y - oy, PIN_RADIUS, PIN_RADIUS, 0, 0, Math.PI * 2);
  ctx.fillStyle = PIN_COLOR;
  ctx.fill();
  ctx.lineWidth = BORDER;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.font = pinFont;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(String(index + 1), memo.x - ox, memo.y - oy + 0.5);
}

/** `src` laid over `dst` at (ox, oy), the usual "source over" for straight (not premultiplied) RGBA. Changes `dst`. */
export function compositeOver(dst: RawImage, src: RawImage, ox: number, oy: number): void {
  for (let y = 0; y < src.height; y++) {
    const dy = y + oy;
    if (dy < 0 || dy >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const dx = x + ox;
      if (dx < 0 || dx >= dst.width) continue;
      const s = (y * src.width + x) * 4;
      const sa = src.data[s + 3] / 255;
      if (sa === 0) continue;
      const d = (dy * dst.width + dx) * 4;
      const da = dst.data[d + 3] / 255;
      const a = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) dst.data[d + c] = Math.round((src.data[s + c] * sa + dst.data[d + c] * da * (1 - sa)) / a);
      dst.data[d + 3] = Math.round(a * 255);
    }
  }
}
